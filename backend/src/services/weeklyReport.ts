/**
 * Informe semanal de actividad de un bot.
 *
 * TODO el contenido sale de queries y agregaciones sobre la base. No se llama
 * al modelo de IA en ningun punto, ni siquiera para el resumen ejecutivo en
 * prosa: ese se arma con reglas en weeklyReportSummary.ts. Los numeros tienen
 * que ser reales y el costo por informe tiene que ser cero, porque son un
 * informe por bot por semana y eso escala con la base de clientes.
 */
import { v4 as uuidv4 } from 'uuid';
import type { Plan } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { esNoRespuesta } from '../lib/frasesBot';
import { LIMITS, effectivePlan } from '../middleware/planLimits';
import { construirResumen, type ResumenEjecutivo } from './weeklyReportSummary';

/** Paraguay es UTC-4; mismo criterio que dailySummary y el cupo del asistente */
const PY_OFFSET_MS = -4 * 60 * 60 * 1000;
const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;
/** Tope de mensajes que se leen por bot, para acotar el trabajo por corrida */
const MAX_MENSAJES = 5000;
const TOP_N = 5;
/** Semanas que se grafican en la evolución del PDF y del panel */
export const SEMANAS_HISTORIAL = 8;

export interface WeeklyReportContent {
  totalConversations: number;
  totalMessages: number;
  /** Respuestas del bot. Es el denominador de la tasa de "no supo responder". */
  botMessages: number;
  topQuestions: Array<{ pregunta: string; cantidad: number }>;
  unansweredQuestions: Array<{ pregunta: string; veces: number }>;
  humanRequestedCount: number;
  humanRequestedReasons: Array<{ motivo: string; cantidad: number }>;
  peakHours: Array<{ hora: number; cantidad: number }>;
  /** Escala 1 a 5, igual que en el resto del producto (ver nps.ts) */
  npsAverage: number | null;
  npsResponseCount: number;
  npsPreviousAverage: number | null;
  /** Semana anterior, para las tendencias. null si es el primer informe. */
  prevConversations: number | null;
  prevMessages: number | null;
  /** Prosa armada con reglas sobre estos mismos números, nunca con IA */
  resumen: ResumenEjecutivo;
}

/** Un punto de la línea de evolución */
export interface PuntoHistorial {
  weekStart: string;
  conversations: number;
  messages: number;
  nps: number | null;
}

// ─── Semanas ──────────────────────────────────────────────────────────────────

/**
 * Lunes 00:00 hora Paraguay de la semana que YA terminó, expresado en UTC.
 * Corriendo un lunes, devuelve el lunes anterior.
 */
export function semanaAnterior(ahora = new Date()): { weekStart: Date; weekEnd: Date } {
  const py = new Date(ahora.getTime() + PY_OFFSET_MS);
  // getUTCDay sobre la fecha ya desplazada da el día paraguayo. Domingo = 0,
  // así que se corrige para que la semana arranque el lunes.
  const diaSemana = (py.getUTCDay() + 6) % 7;
  const lunesEstaSemanaPy = Date.UTC(py.getUTCFullYear(), py.getUTCMonth(), py.getUTCDate() - diaSemana);
  const weekEnd = new Date(lunesEstaSemanaPy - PY_OFFSET_MS);
  return { weekStart: new Date(weekEnd.getTime() - SEMANA_MS), weekEnd };
}

// ─── Agrupación de preguntas ──────────────────────────────────────────────────

/**
 * Normaliza para poder agrupar repeticiones: minúsculas, sin tildes, sin
 * signos y con los espacios colapsados.
 *
 * LIMITACIÓN CONOCIDA: agrupa por texto casi exacto, no por significado.
 * "cuanto sale el sillon" y "que precio tiene el sillon" cuentan como dos
 * preguntas distintas. Agrupar por similitud semántica requeriría embeddings
 * por mensaje, que es caro y lento para un informe semanal. Esta versión
 * simple ya sirve para ver lo que la gente pregunta literalmente igual, que
 * es el caso mayoritario en WhatsApp.
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Agrupa por texto normalizado y devuelve los N más repetidos */
function contarRepetidos(textos: string[], n: number): Array<{ texto: string; cantidad: number }> {
  const grupos = new Map<string, { original: string; cantidad: number }>();
  for (const t of textos) {
    const clave = normalizar(t);
    // Se ignoran los saludos sueltos: no dicen nada de lo que la gente busca
    if (clave.length < 8) continue;
    const previo = grupos.get(clave);
    if (previo) previo.cantidad += 1;
    else grupos.set(clave, { original: t.trim().slice(0, 160), cantidad: 1 });
  }
  return [...grupos.values()]
    .filter((g) => g.cantidad > 1 || grupos.size <= n)
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, n)
    .map((g) => ({ texto: g.original, cantidad: g.cantidad }));
}

const promedioNps = (xs: Array<{ score: number }>): number | null =>
  xs.length > 0 ? Number((xs.reduce((a, r) => a + r.score, 0) / xs.length).toFixed(2)) : null;

// ─── Generación ───────────────────────────────────────────────────────────────

export async function generateWeeklyReport(
  botId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<WeeklyReportContent> {
  const rango = { gte: weekStart, lt: weekEnd };
  const semanaPrevia = { gte: new Date(weekStart.getTime() - SEMANA_MS), lt: weekStart };

  const [totalConversations, mensajes, npsSemana, npsPrevia, prevConversations, prevMessages] =
    await Promise.all([
      prisma.conversation.count({ where: { botId, createdAt: rango } }),
      prisma.message.findMany({
        where: { conversation: { botId }, createdAt: rango },
        orderBy: { createdAt: 'asc' },
        take: MAX_MENSAJES,
        select: { role: true, content: true, createdAt: true, conversationId: true },
      }),
      prisma.npsResponse.findMany({ where: { botId, createdAt: rango }, select: { score: true } }),
      prisma.npsResponse.findMany({ where: { botId, createdAt: semanaPrevia }, select: { score: true } }),
      prisma.conversation.count({ where: { botId, createdAt: semanaPrevia } }),
      prisma.message.count({ where: { conversation: { botId }, createdAt: semanaPrevia } }),
    ]);

  const delCliente = mensajes.filter((m) => m.role === 'USER');
  const delBot = mensajes.filter((m) => m.role === 'ASSISTANT');

  // Top preguntas: lo que los clientes escribieron, agrupado por repetición
  const topQuestions = contarRepetidos(delCliente.map((m) => m.content), TOP_N)
    .map((g) => ({ pregunta: g.texto, cantidad: g.cantidad }));

  // Sin responder: el mensaje del cliente ANTERIOR a cada respuesta en la que
  // el bot admitió no saber. Se busca dentro de la misma conversación.
  const sinResponder: string[] = [];
  for (let i = 0; i < mensajes.length; i++) {
    const m = mensajes[i];
    if (m.role !== 'ASSISTANT' || !esNoRespuesta(m.content)) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (mensajes[j].conversationId !== m.conversationId) break;
      if (mensajes[j].role === 'USER') {
        sinResponder.push(mensajes[j].content);
        break;
      }
    }
  }
  const unansweredQuestions = contarRepetidos(sinResponder, TOP_N)
    .map((g) => ({ pregunta: g.texto, veces: g.cantidad }));

  // Pedidos de humano: se cuentan por las mismas frases del bot, que es el
  // rastro que queda. No hay una tabla de derivaciones todavía.
  const humanRequestedCount = delBot.filter((m) => esNoRespuesta(m.content)).length;
  const humanRequestedReasons = contarRepetidos(sinResponder, 3)
    .map((g) => ({ motivo: g.texto, cantidad: g.cantidad }));

  // Horas pico en hora local paraguaya, que es la que le sirve al dueño
  const porHora = new Map<number, number>();
  for (const m of delCliente) {
    const hora = new Date(m.createdAt.getTime() + PY_OFFSET_MS).getUTCHours();
    porHora.set(hora, (porHora.get(hora) ?? 0) + 1);
  }
  const peakHours = [...porHora.entries()]
    .map(([hora, cantidad]) => ({ hora, cantidad }))
    .sort((a, b) => a.hora - b.hora);

  const npsAverage = promedioNps(npsSemana);
  const npsPreviousAverage = promedioNps(npsPrevia);

  // Sin semana previa registrada no se inventa un 0: null significa "no hay
  // con qué comparar", y el resumen lo trata distinto de "cayó a cero".
  const huboSemanaPrevia = prevConversations > 0 || prevMessages > 0 || npsPrevia.length > 0;

  const resumen = construirResumen({
    conversaciones: totalConversations,
    mensajes: mensajes.length,
    conversacionesPrevias: huboSemanaPrevia ? prevConversations : null,
    nps: npsAverage,
    npsRespuestas: npsSemana.length,
    npsPrevio: npsPreviousAverage,
    sinResponder: humanRequestedCount,
    respuestasBot: delBot.length,
    preguntasSinResponder: unansweredQuestions.length,
  });

  return {
    totalConversations,
    totalMessages: mensajes.length,
    botMessages: delBot.length,
    topQuestions,
    unansweredQuestions,
    humanRequestedCount,
    humanRequestedReasons,
    peakHours,
    npsAverage,
    npsResponseCount: npsSemana.length,
    npsPreviousAverage,
    prevConversations: huboSemanaPrevia ? prevConversations : null,
    prevMessages: huboSemanaPrevia ? prevMessages : null,
    resumen,
  };
}

// ─── Historial para el gráfico de evolución ───────────────────────────────────

/**
 * Últimas semanas ya calculadas de un bot, incluida la que se pasa, de la más
 * vieja a la más nueva. Sale de los informes guardados: no recalcula nada.
 */
export async function getTrendHistory(
  botId: string,
  hastaWeekStart: Date,
  semanas = SEMANAS_HISTORIAL,
): Promise<PuntoHistorial[]> {
  const previos = await prisma.weeklyReport.findMany({
    where: { botId, weekStart: { lte: hastaWeekStart } },
    orderBy: { weekStart: 'desc' },
    take: semanas,
    select: { weekStart: true, content: true },
  });

  return previos
    .reverse()
    .map((r) => {
      const c = r.content as unknown as Partial<WeeklyReportContent>;
      return {
        weekStart: r.weekStart.toISOString(),
        conversations: c.totalConversations ?? 0,
        messages: c.totalMessages ?? 0,
        nps: c.npsAverage ?? null,
      };
    });
}

// ─── Qué bots reciben informe ─────────────────────────────────────────────────

/**
 * TODOS los bots activos del usuario, si su plan vigente incluye informes.
 *
 * Ya no hay tope por cantidad: limitar a un bot en Profesional generaba
 * clientes que pagaban por tres bots y recibían el informe de uno solo. El
 * plan se diferencia por profundidad (el consolidado de Agencia), no por
 * cuántos bots se miden.
 */
export async function botsElegibles(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
  if (!user || !planIncluyeReportes(user)) return [];

  const bots = await prisma.bot.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return bots.map((b) => b.id);
}

/** ¿El plan vigente incluye el informe semanal de cada bot? */
export function planIncluyeReportes(user: { plan: Plan; planExpiresAt: Date | null }): boolean {
  return LIMITS[effectivePlan(user)].weeklyReports;
}

/** ¿El plan vigente incluye el informe consolidado entre bots? Solo Agencia. */
export function planIncluyeConsolidado(user: { plan: Plan; planExpiresAt: Date | null }): boolean {
  return LIMITS[effectivePlan(user)].consolidatedReports;
}

// ─── Persistencia ─────────────────────────────────────────────────────────────

/** Genera y guarda. Si ya existía el de esa semana, lo reemplaza. */
export async function generarYGuardar(
  botId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<{ id: string; content: WeeklyReportContent }> {
  const content = await generateWeeklyReport(botId, weekStart, weekEnd);
  const guardado = await prisma.weeklyReport.upsert({
    where: { botId_weekStart: { botId, weekStart } },
    create: {
      id: uuidv4(),
      botId,
      weekStart,
      weekEnd,
      content: content as unknown as object,
    },
    update: { content: content as unknown as object, generatedAt: new Date() },
  });
  return { id: guardado.id, content };
}
