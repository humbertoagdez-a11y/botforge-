/**
 * Encuesta de satisfacción a los clientes finales del negocio.
 *
 * El número solo no sirve de mucho: lo valioso es el comentario, o sea POR QUÉ
 * el cliente puntuó así. Por eso el flujo tiene dos pasos, y la repregunta
 * cambia según el score.
 *
 * El parseo de la respuesta es 100% determinista: regex y listas de palabras,
 * nunca una llamada al modelo. Interpretar un número del 1 al 5 con IA sería
 * pagar tokens en cada encuesta sin ganar nada.
 *
 * Los mensajes de esta encuesta NO cuentan para el cupo del plan del dueño:
 * son de la plataforma, no respuestas del bot.
 */
import { v4 as uuidv4 } from 'uuid';
import type { NpsSentiment } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { LIMITS, effectivePlan } from '../middleware/planLimits';
import { sendEmail } from './email';

/** No se le vuelve a preguntar al mismo cliente antes de este plazo */
const COOLDOWN_DIAS = 30;
/** Mínimo de mensajes en la conversación: preguntar tras un "hola" da basura */
const MIN_MENSAJES = 4;
/** Silencio mínimo del cliente antes de considerar cerrada la conversación */
const MIN_SILENCIO_MS = 3 * 60 * 1000;
/** Ventana para asociar un mensaje entrante a la encuesta en curso */
export const VENTANA_RESPUESTA_MS = 60 * 60 * 1000;

// ─── Clasificación ────────────────────────────────────────────────────────────

export function classifySentiment(score: number): NpsSentiment {
  if (score >= 5) return 'PROMOTOR';
  if (score === 4) return 'PASIVO';
  return 'DETRACTOR';
}

// ─── Parseo determinista de la respuesta ──────────────────────────────────────

const PALABRA_A_SCORE: Record<string, number> = {
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  pesimo: 1, pésimo: 1, terrible: 1, horrible: 1, malisimo: 1, malísimo: 1,
  mal: 2, malo: 2, feo: 2,
  regular: 3, 'mas o menos': 3, 'más o menos': 3, masomenos: 3, ahi: 3, normal: 3, zafa: 3,
  bien: 4, bueno: 4, 'muy bien': 4, bastante: 4,
  excelente: 5, buenisimo: 5, buenísimo: 5, perfecto: 5, genial: 5, barbaro: 5,
  bárbaro: 5, increible: 5, increíble: 5, 'muy bueno': 5, diez: 5,
};

/** Caritas y símbolos que la gente manda en vez de un número */
const EMOJI_A_SCORE: Array<[RegExp, number]> = [
  [/[😡🤬😠]/u, 1],
  [/[😞😔☹️🙁👎]/u, 2],
  [/[😐😑🤷]/u, 3],
  [/[🙂😌👌]/u, 4],
  [/[😀😁😃😄😍🤩👍💯🔥]/u, 5],
];

/**
 * Solo se intenta interpretar mensajes CORTOS. Es la protección contra falsos
 * positivos: "cuanto sale el sillon de 3 cuerpos?" contiene un 3, pero no es
 * una puntuación. Ante la duda se devuelve null y la conversación sigue normal.
 */
const MAX_LARGO_PARSEABLE = 30;

export function parseNpsReply(texto: string | null | undefined): number | null {
  if (typeof texto !== 'string') return null;
  const limpio = texto.trim();
  if (!limpio) return null;

  // Estrellas: se cuentan, con tope en 5
  const estrellas = (limpio.match(/[⭐🌟★]/gu) ?? []).length;
  if (estrellas > 0 && limpio.length <= MAX_LARGO_PARSEABLE) {
    return Math.min(estrellas, 5);
  }

  for (const [re, score] of EMOJI_A_SCORE) {
    if (re.test(limpio)) return score;
  }

  if (limpio.length > MAX_LARGO_PARSEABLE) return null;

  const normalizado = limpio
    .toLowerCase()
    .replace(/[!¡.,;:¿?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Un número suelto, opcionalmente con adorno tipo "5/5" o "un 4"
  const soloNumero = normalizado.match(/^(?:un[a]?\s+)?([1-5])(?:\s*\/\s*5)?$/);
  if (soloNumero) return Number(soloNumero[1]);

  // Fuera de rango pero claramente una puntuación: se acota en vez de ignorar
  const numeroSuelto = normalizado.match(/^(?:un[a]?\s+)?(\d{1,2})(?:\s*\/\s*(?:5|10))?$/);
  if (numeroSuelto) {
    const n = Number(numeroSuelto[1]);
    if (n === 0) return 1;
    if (n > 5 && n <= 10) return 5; // pensó en escala de 10
    if (n > 10) return null;
    return n;
  }

  // Frases de dos palabras antes que las de una: "muy bien" no es "bien"
  const claves = Object.keys(PALABRA_A_SCORE).sort((a, b) => b.length - a.length);
  for (const clave of claves) {
    const re = new RegExp(`(^|\\s)${clave.replace(/ /g, '\\s+')}($|\\s)`, 'u');
    if (re.test(normalizado)) return PALABRA_A_SCORE[clave];
  }

  return null;
}

// ─── Textos de la encuesta ────────────────────────────────────────────────────

export function npsQuestion(): string {
  return 'Antes de que te vayas, del 1 al 5, ¿qué tan bien te atendí? Con un número alcanza.';
}

export function npsFollowUp(score: number): string {
  if (score <= 3) return 'Perdón si algo no salió bien. ¿Qué fue lo que te faltó? Me sirve para mejorar.';
  if (score === 4) return '¡Gracias! ¿Qué le faltó para ser un 5?';
  return '¡Gracias! Si querés contarme qué te resultó útil, te leo.';
}

// ─── ¿Corresponde preguntar? ──────────────────────────────────────────────────

/**
 * Las reglas se evalúan en orden y cortan a la primera que falla. El orden
 * importa por costo: primero lo que se resuelve sin tocar la base.
 */
export async function shouldAskNps(botId: string, clientId: string): Promise<boolean> {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: {
      npsEnabled: true,
      isActive: true,
      user: { select: { plan: true, planExpiresAt: true } },
    },
  });

  // 1. La encuesta está activada en el bot
  if (!bot || !bot.npsEnabled || !bot.isActive) return false;

  // 2. El plan la incluye. effectivePlan aplica el vencimiento: un PRO vencido
  //    vale FREE y por lo tanto pierde NPS
  if (!LIMITS[effectivePlan(bot.user)].nps) return false;

  // 3. No se le preguntó en los últimos 30 días
  const desde = new Date(Date.now() - COOLDOWN_DIAS * 24 * 60 * 60 * 1000);
  const previo = await prisma.npsPrompt.findUnique({
    where: { botId_clientId: { botId, clientId } },
  });
  if (previo && previo.askedAt > desde) return false;

  return true;
}

/** ¿La conversación da para encuestar? (ida y vuelta real + silencio) */
export function conversationIsRipe(
  messages: Array<{ role: 'USER' | 'ASSISTANT'; createdAt: Date }>,
): boolean {
  if (messages.length < MIN_MENSAJES) return false;

  const delCliente = messages.filter((m) => m.role === 'USER').length;
  const delBot = messages.filter((m) => m.role === 'ASSISTANT').length;
  if (delCliente < 2 || delBot < 2) return false;

  // 5. Silencio desde el último mensaje DEL CLIENTE
  const ultimoCliente = [...messages].reverse().find((m) => m.role === 'USER');
  if (!ultimoCliente) return false;
  return Date.now() - ultimoCliente.createdAt.getTime() >= MIN_SILENCIO_MS;
}

// ─── Registro ─────────────────────────────────────────────────────────────────

/** Deja constancia de que se preguntó, aunque el cliente nunca conteste */
export async function markAsked(botId: string, clientId: string): Promise<void> {
  await prisma.npsPrompt.upsert({
    where: { botId_clientId: { botId, clientId } },
    create: { id: uuidv4(), botId, clientId },
    update: { askedAt: new Date() },
  });
}

export interface NpsState {
  /** Se preguntó y todavía no llegó el número */
  esperandoScore: boolean;
  /** Llegó el número y se está esperando el comentario */
  esperandoComentario: { responseId: string; score: number } | null;
}

/**
 * En qué punto de la encuesta está este cliente. Se deduce del estado en base
 * en vez de guardar una máquina de estados aparte: el prompt marca que se
 * preguntó, y una respuesta sin comment marca que falta la repregunta.
 */
export async function getNpsState(botId: string, clientId: string): Promise<NpsState> {
  const desde = new Date(Date.now() - VENTANA_RESPUESTA_MS);

  const [prompt, ultima] = await Promise.all([
    prisma.npsPrompt.findUnique({ where: { botId_clientId: { botId, clientId } } }),
    prisma.npsResponse.findFirst({
      where: { botId, clientId, createdAt: { gte: desde } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  if (ultima && ultima.comment === null) {
    return { esperandoScore: false, esperandoComentario: { responseId: ultima.id, score: ultima.score } };
  }
  // Preguntado hace poco y sin respuesta posterior: falta el número
  const esperandoScore = Boolean(prompt && prompt.askedAt >= desde && !ultima);
  return { esperandoScore, esperandoComentario: null };
}

// ─── Guardado ─────────────────────────────────────────────────────────────────

export async function saveScore(
  botId: string,
  clientId: string,
  score: number,
  conversationId: string | null,
): Promise<{ id: string; sentiment: NpsSentiment }> {
  const sentiment = classifySentiment(score);
  const created = await prisma.npsResponse.create({
    data: { id: uuidv4(), botId, clientId, score, sentiment, conversationId },
  });
  console.log(`[nps] bot ${botId} — score ${score} (${sentiment}) de ${clientId}`);
  return { id: created.id, sentiment };
}

/** Guarda el comentario y, si es una queja grave, avisa al dueño */
export async function saveComment(responseId: string, comment: string): Promise<void> {
  const updated = await prisma.npsResponse.update({
    where: { id: responseId },
    data: { comment: comment.slice(0, 2000) },
    include: { bot: { select: { id: true, name: true, userId: true } } },
  });

  // Solo 1 y 2 con comentario: es lo que amerita reaccionar el mismo día
  if (updated.score <= 2 && updated.comment) {
    void notifyDetractor(updated.bot, updated.score, updated.comment);
  }
}

async function notifyDetractor(
  bot: { id: string; name: string; userId: string },
  score: number,
  comment: string,
): Promise<void> {
  try {
    // Respeta la preferencia de notificaciones que ya existe. Si no configuró
    // nada, se le avisa igual al email de la cuenta: una queja grave no puede
    // quedar solo en el panel.
    const [config, user] = await Promise.all([
      prisma.notificationConfig.findUnique({
        where: { botId_event: { botId: bot.id, event: 'human_requested' } },
      }),
      prisma.user.findUnique({ where: { id: bot.userId }, select: { email: true, name: true } }),
    ]);
    if (config && !config.isActive) return;

    const destino = config?.email ?? user?.email;
    if (!destino) return;

    await sendEmail(
      destino,
      `Un cliente calificó con ${score} a ${bot.name}`,
      detractorEmailHtml(user?.name ?? '', bot.name, score, comment),
    );
  } catch (err) {
    // Un fallo de email nunca debe impedir que la respuesta quede guardada
    console.error('[nps] Error avisando del detractor:', err);
  }
}

function detractorEmailHtml(nombre: string, botName: string, score: number, comment: string): string {
  const statsUrl = `${env.FRONTEND_URL}/dashboard/stats`;
  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:22px;font-weight:bold;color:#7C3AED;margin:0 0 24px;">BotForge</p>
      ${nombre ? `<p style="font-size:16px;margin:0 0 12px;">Hola ${nombre},</p>` : ''}
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
        Un cliente calificó la atención de <strong>${botName}</strong> con
        <strong style="color:#DC2626;">${score} de 5</strong> y dejó este comentario:
      </p>
      <div style="border-left:3px solid #FECACA;background:#FEF2F2;padding:14px 16px;margin:0 0 24px;font-size:14px;line-height:1.6;color:#333333;white-space:pre-wrap;">${comment}</div>
      <a href="${statsUrl}"
         style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:8px;margin:0 0 28px;">
        Ver todas las opiniones
      </a>
      <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 16px;" />
      <p style="font-size:12px;color:#888888;margin:0;">
        Recibís este aviso porque tenés activada la encuesta de satisfacción en este bot.
      </p>
    </div>
  </body>
</html>`;
}
