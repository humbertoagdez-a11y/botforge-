/**
 * Pipeline de mensajes entrantes de WhatsApp, compartido por el webhook de
 * Twilio y el de Meta Cloud API.
 *
 * Vive aca todo lo que NO depende del canal: verificacion del codigo BF-,
 * limites del plan, conversacion e historial, derivacion a humano, RAG y el
 * loop del agente tenant. Cada webhook se ocupa solo de lo suyo: identificar
 * al bot, bajar el media y entregar la respuesta.
 */
import { v4 as uuidv4 } from 'uuid';
import type { Bot } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { assertMessageLimit, incrementMessageUsage } from '../middleware/planLimits';
import { getRelevantChunks } from './rag';
import { buildTenantSystemBlocks, runTenantAgentLoop, type TenantAgentContext } from './tenantAgent';
import { sendEmail } from './email';

// ─── Notificación "el cliente pide un humano" ─────────────────────────────────

const HUMAN_KEYWORDS = [
  'hablar con una persona',
  'hablar con alguien',
  'quiero hablar con alguien',
  'hablar con un humano',
  'con un humano',
  'persona real',
  'un agente',
  'atencion humana',
  'atención humana',
  'no sos una persona',
  'sos un robot',
];

export function wantsHuman(message: string): boolean {
  const lower = message.toLowerCase();
  return HUMAN_KEYWORDS.some((k) => lower.includes(k));
}

export async function notifyHumanRequested(
  bot: { id: string; name: string },
  clientNumber: string,
  message: string,
): Promise<void> {
  try {
    const config = await prisma.notificationConfig.findUnique({
      where: { botId_event: { botId: bot.id, event: 'human_requested' } },
    });
    if (!config?.isActive) return;

    const preview = message.length > 200 ? `${message.slice(0, 200)}...` : message;
    await sendEmail(
      config.email,
      'Tu bot necesita ayuda humana',
      `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:20px;font-weight:bold;color:#7C3AED;margin:0 0 20px;">BotForge</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
        Un cliente pidió hablar con una persona en el bot <strong>${bot.name}</strong>.
      </p>
      <p style="font-size:14px;color:#333;margin:0 0 4px;">Número del cliente: <strong>${clientNumber}</strong></p>
      <p style="font-size:14px;color:#333;margin:0 0 20px;">Mensaje: "${preview}"</p>
      <a href="${env.FRONTEND_URL}/dashboard/conversations"
         style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:10px 24px;border-radius:8px;">
        Ver la conversación
      </a>
    </div>
  </body>
</html>`,
    );
  } catch (err) {
    console.error('[whatsapp] Error al notificar pedido de humano:', err);
  }
}

// ─── Código de verificación BF-XXXXXX ─────────────────────────────────────────

export const VERIFICATION_CODE_RE = /^BF-\d{6}$/i;

/**
 * Que se vincula al bot cuando el codigo se valida. Twilio rutea por el numero
 * del cliente; Meta rutea por el id del numero de negocio que recibio el
 * mensaje. Son claves distintas y se guardan en columnas distintas.
 */
export type LinkTarget =
  | { channel: 'twilio'; whatsappNumber: string }
  | { channel: 'meta'; phoneNumberId: string };

/**
 * Valida el codigo y vincula el bot. Devuelve el texto a responderle al
 * cliente. Nunca lanza: cualquier fallo se traduce en un mensaje al usuario.
 */
export async function handleVerificationCode(
  rawCode: string,
  fromNumber: string,
  target: LinkTarget,
): Promise<string> {
  const code = rawCode.toUpperCase();
  try {
    const conn = await prisma.whatsAppConnection.findUnique({
      where: { verificationCode: code },
    });

    if (!conn || conn.status !== 'PENDING') {
      return 'Código inválido o ya utilizado. Generá uno nuevo desde el panel de BotForge.';
    }
    if (new Date() > conn.expiresAt) {
      await prisma.whatsAppConnection.update({ where: { id: conn.id }, data: { status: 'EXPIRED' } });
      return 'El código expiró ⏱ Generá uno nuevo desde el panel de BotForge.';
    }
    if (conn.phoneNumber !== fromNumber) {
      return 'Este código fue generado para otro número. Asegurate de enviar desde el número que registraste.';
    }

    // El numero de negocio de Meta es unico por bot: avisar en vez de reventar
    // con una violacion de constraint si ya esta tomado por otro bot.
    if (target.channel === 'meta') {
      const taken = await prisma.bot.findUnique({
        where: { metaPhoneNumberId: target.phoneNumberId },
      });
      if (taken && taken.id !== conn.botId) {
        return 'Este número de WhatsApp ya está conectado a otro bot. Desconectalo primero desde el panel de BotForge.';
      }
    }

    const botData =
      target.channel === 'twilio'
        ? { whatsappNumber: target.whatsappNumber }
        : { metaPhoneNumberId: target.phoneNumberId };

    await prisma.$transaction([
      prisma.whatsAppConnection.update({ where: { id: conn.id }, data: { status: 'ACTIVE' } }),
      prisma.bot.update({ where: { id: conn.botId }, data: botData }),
    ]);

    return '✅ ¡WhatsApp conectado exitosamente a tu bot de BotForge! Podés probarlo enviando cualquier mensaje.';
  } catch (err) {
    console.error('[webhook] Error en verificación:', err);
    return 'Hubo un error al verificar el código. Intentá de nuevo.';
  }
}

// ─── Pipeline principal ───────────────────────────────────────────────────────

export interface PendingImage {
  imageBase64: string;
  mimeType: string;
  fileName: string;
}

export interface InboundResult {
  /** Texto a enviarle al cliente */
  text: string;
  /** Imagen de Drive que el agente quiere adjuntar, si la hubo */
  pendingImage?: PendingImage;
  /** true si es un aviso del sistema (no paso por el agente) */
  isNotice: boolean;
}

export interface InboundParams {
  bot: Bot;
  /** Numero del cliente en formato +595... (para logs y notificaciones) */
  clientNumber: string;
  /** Clave estable de la conversacion, p.ej. whatsapp:+595... */
  channelId: string;
  /** Texto del cliente, ya transcripto si vino como audio */
  text: string;
  /** Descripcion de la imagen adjunta segun Vision, si la hubo */
  imageContext?: string;
}

/**
 * Corre el flujo completo de una consulta entrante y devuelve que responder.
 * Persiste los mensajes y actualiza el contador del plan.
 */
export async function processInboundMessage(params: InboundParams): Promise<InboundResult> {
  const { bot, clientNumber, channelId, text, imageContext } = params;

  const readyDocs = await prisma.document.count({ where: { botId: bot.id, status: 'READY' } });
  if (readyDocs === 0) {
    return { text: 'El bot aún no tiene documentos listos. Intenta más tarde.', isNotice: true };
  }

  // Limite mensual del plan del dueño del bot
  try {
    await assertMessageLimit(bot.userId);
  } catch (limitErr) {
    if (limitErr instanceof AppError && limitErr.statusCode === 429) {
      return {
        text: 'Este bot alcanzó el límite mensual de mensajes de su plan. El negocio ya fue notificado.',
        isNotice: true,
      };
    }
    throw limitErr;
  }

  let conversation = await prisma.conversation.findUnique({
    where: { botId_channelId: { botId: bot.id, channelId } },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { id: uuidv4(), botId: bot.id, channelId, channel: 'whatsapp' },
    });
  }

  const recentMsgs = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // El contexto de la imagen (si hubo) enriquece el mensaje para el RAG
  const finalMessage = imageContext ? `${imageContext}\n\nMensaje del cliente: ${text}` : text;

  await prisma.message.create({
    data: { id: uuidv4(), conversationId: conversation.id, role: 'USER', content: finalMessage },
  });

  // Notificacion por email si el cliente pide hablar con una persona
  if (wantsHuman(text)) {
    void notifyHumanRequested(bot, clientNumber, text);
  }

  const history = recentMsgs
    .reverse()
    .map((m) => ({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content }));

  // Agente Tipo B: RAG como contexto inicial + loop de tools nativo
  // (buscar_en_documentos, buscar_archivos_drive, derivar_a_humano)
  const chunks = await getRelevantChunks(bot.id, finalMessage);
  // Bloques partidos: las reglas y la personalidad se cachean, el RAG no
  const systemPrompt = buildTenantSystemBlocks(
    bot.name, bot.personality, bot.language, chunks.join('\n\n'),
  );
  const agentContext: TenantAgentContext = {
    botId: bot.id,
    botName: bot.name,
    clientId: clientNumber,
    channel: 'whatsapp',
  };
  const { content, tokensUsed } = await runTenantAgentLoop(
    systemPrompt, history, finalMessage, agentContext,
  );

  await prisma.message.create({
    data: { id: uuidv4(), conversationId: conversation.id, role: 'ASSISTANT', content, tokensUsed },
  });

  await incrementMessageUsage(bot.userId);

  return { text: content, pendingImage: agentContext.pendingImage, isNotice: false };
}
