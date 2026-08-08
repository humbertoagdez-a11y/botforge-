/**
 * Reporte semanal de actividad del bot.
 *
 * TODO el contenido sale de queries y agregaciones sobre la base. No se llama
 * al modelo de IA en ningun punto: los numeros tienen que ser reales, y un
 * reporte por bot por semana llamando a Anthropic seria un costo recurrente
 * evitable. Si algun dia se quiere un resumen en prosa, va como paso aparte
 * y opcional, nunca como base del reporte.
 */
import { v4 as uuidv4 } from 'uuid';
import type { Plan } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { esNoRespuesta } from '../lib/frasesBot';
import { LIMITS, botsConReporte, effectivePlan } from '../middleware/planLimits';

/** Paraguay es UTC-4; mismo criterio que dailySummary y el cupo del asistente */
const PY_OFFSET_MS = -4 * 60 * 60 * 1000;
const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;
/** Tope de mensajes que se leen por bot, para acotar el trabajo por corrida */
const MAX_MENSAJES = 5000;
const TOP_N = 5;

export interface WeeklyReportContent {
  totalConversations: number;
  totalMessages: number;
  topQuestions: Array<{ pregunta: string; cantidad: number }>;
  unansweredQuestions: Array<{ pregunta: string; veces: number }>;
  humanRequestedCount: number;
  humanRequestedReasons: Array<{ motivo: string; cantidad: number }>;
  peakHours: Array<{ hora: number; cantidad: number }>;
  npsAverage: number | null;
  npsResponseCount: number;
  npsPreviousAverage: number | null;
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
 * por mensaje, que es caro y lento para un reporte semanal. Esta versión
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

// ─── Generación ───────────────────────────────────────────────────────────────

export async function generateWeeklyReport(
  botId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<WeeklyReportContent> {
  const rango = { gte: weekStart, lt: weekEnd };

  const [totalConversations, mensajes, npsSemana, npsPrevia] = await Promise.all([
    prisma.conversation.count({ where: { botId, createdAt: rango } }),
    prisma.message.findMany({
      where: { conversation: { botId }, createdAt: rango },
      orderBy: { createdAt: 'asc' },
      take: MAX_MENSAJES,
      select: { role: true, content: true, createdAt: true, conversationId: true },
    }),
    prisma.npsResponse.findMany({
      where: { botId, createdAt: rango },
      select: { score: true },
    }),
    prisma.npsResponse.findMany({
      where: {
        botId,
        createdAt: { gte: new Date(weekStart.getTime() - SEMANA_MS), lt: weekStart },
      },
      select: { score: true },
    }),
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

  const promedio = (xs: Array<{ score: number }>) =>
    xs.length > 0 ? Number((xs.reduce((a, r) => a + r.score, 0) / xs.length).toFixed(2)) : null;

  return {
    totalConversations,
    totalMessages: mensajes.length,
    topQuestions,
    unansweredQuestions,
    humanRequestedCount,
    humanRequestedReasons,
    peakHours,
    npsAverage: promedio(npsSemana),
    npsResponseCount: npsSemana.length,
    npsPreviousAverage: promedio(npsPrevia),
  };
}

// ─── Qué bots corresponden según el plan ──────────────────────────────────────

/**
 * Bots del usuario que reciben reporte. PRO solo el primero creado (su bot
 * principal); AGENCY todos. Aplica el vencimiento de plan: un PRO vencido
 * vale FREE y por lo tanto no recibe nada.
 */
export async function botsElegibles(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
  if (!user) return [];

  const cupo = botsConReporte(effectivePlan(user));
  if (cupo === 0) return [];

  const bots = await prisma.bot.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    ...(Number.isFinite(cupo) ? { take: cupo } : {}),
  });
  return bots.map((b) => b.id);
}

/** ¿El plan de este usuario incluye reportes? (con vencimiento aplicado) */
export function planIncluyeReportes(user: { plan: Plan; planExpiresAt: Date | null }): boolean {
  return LIMITS[effectivePlan(user)].weeklyReports;
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
