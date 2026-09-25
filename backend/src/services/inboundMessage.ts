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
import {
  assertMessageLimit,
  effectivePlan,
  incrementMessageUsage,
  LIMITS,
} from '../middleware/planLimits';
import { runTenantTurn, type PendingImage } from './tenantAgent';
import { escaparHtml, sendEmail } from './email';
import { getNpsState, npsFollowUp, parseNpsReply, saveComment, saveScore } from './nps';

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
        Un cliente pidió hablar con una persona en el bot <strong>${escaparHtml(bot.name)}</strong>.
      </p>
      <p style="font-size:14px;color:#333;margin:0 0 4px;">Número del cliente: <strong>${escaparHtml(clientNumber)}</strong></p>
      <p style="font-size:14px;color:#333;margin:0 0 20px;">Mensaje: "${escaparHtml(preview)}"</p>
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

// El tipo vive en tenantAgent (que es quien la produce); se re-exporta para
// que los webhooks no tengan que importar de dos lados
export type { PendingImage } from './tenantAgent';

export interface InboundResult {
  /** Texto a enviarle al cliente */
  text: string;
  /** Imagen de Drive que el agente quiere adjuntar, si la hubo */
  pendingImage?: PendingImage;
  /** true si es un aviso del sistema (no paso por el agente) */
  isNotice: boolean;
  /**
   * Id del mensaje ASSISTANT ya persistido, cuando lo hubo. El canal lo usa
   * para confirmar la entrega o marcarla como fallida: el cupo se cobra recien
   * cuando Meta confirma que el mensaje salio.
   */
  messageId?: string;
}

/**
 * Intercepta el mensaje si el cliente está en medio de la encuesta.
 *
 * Corre ANTES del agente a propósito: así no gasta tokens ni cupo del plan.
 * Devuelve null cuando el mensaje no es parte de la encuesta, y ahí sigue el
 * flujo normal.
 */
async function handleNpsReply(
  botId: string,
  clientId: string,
  conversationId: string | null,
  text: string,
): Promise<string | null> {
  const state = await getNpsState(botId, clientId);

  // Paso B: se está esperando el comentario. Lo que escriba se guarda tal cual
  if (state.esperandoComentario) {
    await saveComment(state.esperandoComentario.responseId, text);
    return 'Gracias por tomarte el momento. Lo tomo en cuenta.';
  }

  // Paso A: se está esperando el número
  if (state.esperandoScore) {
    const score = parseNpsReply(text);
    // No se pudo interpretar: NO se insiste, la conversación sigue normal.
    // El prompt ya quedó registrado, así que tampoco se le vuelve a preguntar.
    if (score === null) return null;

    await saveScore(botId, clientId, score, conversationId);
    return npsFollowUp(score);
  }

  return null;
}

/**
 * Anuncio Click-to-WhatsApp del que salio la conversacion.
 *
 * Meta lo manda solo en el primer mensaje, asi que si no se guarda ahi se
 * pierde. Sin esto, pautar es tirar plata a ciegas: llegan conversaciones y no
 * hay forma de saber cual anuncio las trajo.
 */
export interface AnuncioDeOrigen {
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  ctwaClid: string | null;
}

/** Lo que hay que saber de una nota de voz, cuando el mensaje vino como audio. */
export interface NotaDeVoz {
  /** true si el cliente la grabo; false si adjunto un archivo de audio */
  esNota: boolean;
  /** Duracion real, o null si no se pudo leer del contenedor */
  segundos: number | null;
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
  /** Presente solo cuando el mensaje entro como audio */
  audio?: NotaDeVoz;
  /** Presente solo en el PRIMER mensaje de una conversacion que vino de un anuncio */
  anuncio?: AnuncioDeOrigen;
}

/**
 * Corre el flujo completo de una consulta entrante y devuelve que responder.
 * Persiste los mensajes y actualiza el contador del plan.
 */
export async function processInboundMessage(params: InboundParams): Promise<InboundResult> {
  const { bot, clientNumber, channelId, text, imageContext, audio, anuncio } = params;

  // La encuesta se atiende antes que nada: no pasa por el agente, no gasta
  // tokens y no cuenta contra el cupo mensual del dueño
  const conversacionPrevia = await prisma.conversation.findUnique({
    where: { botId_channelId: { botId: bot.id, channelId } },
    select: { id: true },
  });
  const npsReply = await handleNpsReply(bot.id, clientNumber, conversacionPrevia?.id ?? null, text);
  if (npsReply) return { text: npsReply, isNotice: true };

  // WhatsApp segun el plan VIGENTE, no segun el que tenia al conectar.
  //
  // checkWhatsAppAccess solo corre al conectar el numero. Una vez conectado, un
  // plan vencido caia a FREE (que no tiene WhatsApp) y el bot seguia
  // atendiendo igual, con los 100 mensajes de Free, para siempre. Era pagar un
  // mes de Basico y quedarse con WhatsApp gratis.
  const dueño = await prisma.user.findUniqueOrThrow({
    where: { id: bot.userId },
    select: { plan: true, planExpiresAt: true },
  });
  if (!LIMITS[effectivePlan(dueño)].whatsapp) {
    return {
      text: 'Este WhatsApp no está disponible en este momento. Escribinos más tarde.',
      isNotice: true,
    };
  }

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

  // El anuncio de origen solo viaja en el primer mensaje, asi que se escribe
  // al crear la conversacion. Si el cliente vuelve a escribir meses despues por
  // otro anuncio, la conversacion ya existe y se actualiza: vale el ultimo
  // anuncio que lo trajo de vuelta, que es el que esta pagando por ese contacto.
  const datosDelAnuncio = anuncio
    ? {
        adSourceId: anuncio.sourceId,
        adSourceType: anuncio.sourceType,
        adSourceUrl: anuncio.sourceUrl,
        adHeadline: anuncio.headline,
        adBody: anuncio.body,
        ctwaClid: anuncio.ctwaClid,
      }
    : {};

  let conversation = await prisma.conversation.findUnique({
    where: { botId_channelId: { botId: bot.id, channelId } },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { id: uuidv4(), botId: bot.id, channelId, channel: 'whatsapp', ...datosDelAnuncio },
    });
    if (anuncio) {
      console.log(
        `[anuncio] conversacion ${conversation.id} llego del anuncio ` +
          `${anuncio.sourceId ?? 'sin id'} — "${anuncio.headline ?? 'sin titular'}"`,
      );
    }
  } else if (anuncio) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: datosDelAnuncio,
    });
    console.log(`[anuncio] conversacion ${conversation.id} vuelve por el anuncio ${anuncio.sourceId ?? 'sin id'}`);
  }

  const recentMsgs = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // El contexto de la imagen (si hubo) enriquece el mensaje para el RAG
  const finalMessage = imageContext ? `${imageContext}\n\nMensaje del cliente: ${text}` : text;

  // Al agente se le avisa que el texto salio de un audio.
  //
  // Importa porque una transcripcion puede traer una palabra mal y el bot
  // tiene que poder repreguntar en vez de contestar cualquier cosa con
  // seguridad. La marca va SOLO al agente: lo que se guarda en la base es la
  // transcripcion limpia, que es lo que el dueño quiere leer en el panel.
  const mensajeParaElAgente = audio
    ? `[El cliente mandó una nota de voz. Esto es la transcripción automática, ` +
      `puede tener palabras mal. Si algo no se entiende o cambia el sentido de lo ` +
      `que pide, preguntale amablemente en vez de suponer.]\n\n${finalMessage}`
    : finalMessage;

  await prisma.message.create({
    data: {
      id: uuidv4(),
      conversationId: conversation.id,
      role: 'USER',
      content: finalMessage,
      esNotaDeVoz: audio?.esNota ?? false,
      audioSegundos: audio?.segundos != null ? Math.round(audio.segundos) : null,
    },
  });

  // Notificacion por email si el cliente pide hablar con una persona
  if (wantsHuman(text)) {
    void notifyHumanRequested(bot, clientNumber, text);
  }

  const history = recentMsgs
    .reverse()
    .map((m) => ({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content }));

  // Agente Tipo B: RAG como contexto inicial + loop de tools nativo. Mismo
  // motor que el Chat de prueba del panel y que el widget publico.
  const { content, tokensUsed, pendingImage } = await runTenantTurn({
    bot,
    history,
    message: mensajeParaElAgente,
    clientId: clientNumber,
    channel: 'whatsapp',
  });

  const mensaje = await prisma.message.create({
    data: { id: uuidv4(), conversationId: conversation.id, role: 'ASSISTANT', content, tokensUsed },
  });

  // El cupo NO se incrementa aca: el mensaje todavia no salio. Lo cobra el
  // canal con confirmarEntrega(), recien cuando Meta confirma el envio. Antes
  // se cobraba en este punto, asi que un fallo de Meta dejaba al cliente sin
  // respuesta y al dueño con el mensaje descontado igual.
  return { text: content, pendingImage, isNotice: false, messageId: mensaje.id };
}

/**
 * La respuesta salio: recien ahora cuenta contra el cupo del mes.
 */
export async function confirmarEntrega(userId: string): Promise<void> {
  await incrementMessageUsage(userId);
}

/**
 * El envio fallo despues de reintentar. No se cobra el cupo y el mensaje queda
 * marcado, para que el panel no muestre como enviada una respuesta que el
 * cliente nunca recibio.
 */
export async function marcarNoEntregado(messageId: string): Promise<void> {
  try {
    await prisma.message.update({ where: { id: messageId }, data: { entregado: false } });
  } catch (err) {
    console.error('[inbound] no se pudo marcar el mensaje como no entregado:', err);
  }
}
