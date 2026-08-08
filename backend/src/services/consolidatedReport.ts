/**
 * Informe consolidado del plan Agencia: compara todos los bots del usuario
 * entre si en una sola vista.
 *
 * Se arma SOBRE los informes individuales ya calculados de esa semana, no
 * volviendo a la base. Dos razones: los numeros del consolidado y los del
 * individual no pueden diferir nunca (si el ranking dice 40 conversaciones y
 * el informe del bot dice 38, el cliente deja de creer en los dos), y
 * releer todos los mensajes de todos los bots por segunda vez seria trabajo
 * duplicado en la misma corrida.
 *
 * Igual que el individual: cero llamadas a IA.
 */
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { construirResumenConsolidado, type ResumenEjecutivo } from './weeklyReportSummary';
import type { WeeklyReportContent } from './weeklyReport';

export interface FilaConsolidada {
  botId: string;
  botName: string;
  conversations: number;
  messages: number;
  /** Escala 1 a 5. null si nadie calificó a ese bot esa semana. */
  nps: number | null;
  npsResponses: number;
  /** Respuestas en las que el bot admitió no saber */
  unanswered: number;
  /** Preguntas distintas sin responder */
  unansweredQuestions: number;
  /** Variación de conversaciones contra la semana anterior, en tanto por uno */
  deltaConversations: number | null;
}

export interface ConsolidatedContent {
  totalBots: number;
  totalConversations: number;
  totalMessages: number;
  totalUnanswered: number;
  /** Promedio ponderado por cantidad de respuestas, no promedio de promedios */
  npsAverage: number | null;
  npsResponseCount: number;
  prevConversations: number | null;
  /** Una fila por bot, ordenada por volumen descendente */
  bots: FilaConsolidada[];
  /** Las preguntas sin responder más repetidas, de toda la cartera */
  topUnanswered: Array<{ pregunta: string; veces: number; botName: string }>;
  resumen: ResumenEjecutivo;
}

/**
 * Arma el consolidado leyendo los WeeklyReport de esa semana. Devuelve null si
 * el usuario no tiene ningún informe individual: sin insumo no hay comparación.
 */
export async function generateConsolidatedReport(
  userId: string,
  weekStart: Date,
): Promise<ConsolidatedContent | null> {
  const reportes = await prisma.weeklyReport.findMany({
    where: { weekStart, bot: { userId } },
    select: { botId: true, content: true, bot: { select: { name: true } } },
  });
  if (reportes.length === 0) return null;

  const filas: FilaConsolidada[] = reportes.map((r) => {
    const c = r.content as unknown as Partial<WeeklyReportContent>;
    const conversations = c.totalConversations ?? 0;
    const prev = c.prevConversations ?? null;
    return {
      botId: r.botId,
      botName: r.bot.name,
      conversations,
      messages: c.totalMessages ?? 0,
      nps: c.npsAverage ?? null,
      npsResponses: c.npsResponseCount ?? 0,
      unanswered: c.humanRequestedCount ?? 0,
      unansweredQuestions: c.unansweredQuestions?.length ?? 0,
      deltaConversations:
        prev === null ? null : prev === 0 ? (conversations > 0 ? 1 : 0) : (conversations - prev) / prev,
    };
  });
  filas.sort((a, b) => b.conversations - a.conversations);

  const totalConversations = filas.reduce((a, f) => a + f.conversations, 0);
  const totalMessages = filas.reduce((a, f) => a + f.messages, 0);
  const totalUnanswered = filas.reduce((a, f) => a + f.unanswered, 0);

  // Ponderado por respuestas: un bot con 40 calificaciones no puede pesar lo
  // mismo que uno con 1 sola en el promedio de la cartera
  const npsResponseCount = filas.reduce((a, f) => a + f.npsResponses, 0);
  const npsAverage =
    npsResponseCount > 0
      ? Number(
          (
            filas.reduce((a, f) => a + (f.nps ?? 0) * f.npsResponses, 0) / npsResponseCount
          ).toFixed(2),
        )
      : null;

  const prevPorBot = reportes.map((r) => (r.content as unknown as Partial<WeeklyReportContent>).prevConversations);
  const hayPrevias = prevPorBot.some((p) => p !== null && p !== undefined);
  const prevConversations = hayPrevias
    ? prevPorBot.reduce<number>((a, p) => a + (p ?? 0), 0)
    : null;

  // Deuda de conocimiento de toda la cartera, con el bot al que pertenece
  const preguntas: Array<{ pregunta: string; veces: number; botName: string }> = [];
  for (const r of reportes) {
    const c = r.content as unknown as Partial<WeeklyReportContent>;
    for (const q of c.unansweredQuestions ?? []) {
      preguntas.push({ pregunta: q.pregunta, veces: q.veces, botName: r.bot.name });
    }
  }
  const topUnanswered = preguntas.sort((a, b) => b.veces - a.veces).slice(0, 8);

  const conNps = filas.filter((f) => f.nps !== null && f.npsResponses > 0);
  const mejorBot =
    conNps.length > 0
      ? conNps.reduce((a, b) => (b.nps! > a.nps! ? b : a))
      : null;
  const masDescuidado =
    filas.filter((f) => f.unanswered > 0).sort((a, b) => b.unanswered - a.unanswered)[0] ?? null;

  const resumen = construirResumenConsolidado({
    bots: filas.length,
    conversaciones: totalConversations,
    conversacionesPrevias: prevConversations,
    mensajes: totalMessages,
    nps: npsAverage,
    sinResponder: totalUnanswered,
    mejorBot: mejorBot ? { nombre: mejorBot.botName, nps: mejorBot.nps! } : null,
    masActivo:
      filas[0] && filas[0].conversations > 0
        ? { nombre: filas[0].botName, conversaciones: filas[0].conversations }
        : null,
    masDescuidado: masDescuidado
      ? { nombre: masDescuidado.botName, sinResponder: masDescuidado.unanswered }
      : null,
    inactivos: filas.filter((f) => f.conversations === 0).map((f) => f.botName),
  });

  return {
    totalBots: filas.length,
    totalConversations,
    totalMessages,
    totalUnanswered,
    npsAverage,
    npsResponseCount,
    prevConversations,
    bots: filas,
    topUnanswered,
    resumen,
  };
}

/** Genera y guarda el consolidado. Devuelve null si no había informes que consolidar. */
export async function generarYGuardarConsolidado(
  userId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<{ id: string; content: ConsolidatedContent } | null> {
  const content = await generateConsolidatedReport(userId, weekStart);
  if (!content) return null;

  const guardado = await prisma.consolidatedReport.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    create: {
      id: uuidv4(),
      userId,
      weekStart,
      weekEnd,
      content: content as unknown as object,
    },
    update: { content: content as unknown as object, generatedAt: new Date() },
  });
  return { id: guardado.id, content };
}
