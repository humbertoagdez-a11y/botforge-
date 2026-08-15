import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from './errorHandler';
import type { Plan } from '@prisma/client';

export const LIMITS: Record<Plan, {
  bots: number;
  docsPerBot: number;
  monthlyMessages: number;
  whatsapp: boolean;
  assistantMonthly: number;
  assistantDaily: number;
  /**
   * Cupo del Chat de prueba del panel. Va aparte de monthlyMessages a
   * proposito: el dueño probando su propio bot no le puede comer los mensajes
   * que necesita para atender clientes. Igual lleva tope, porque cada prueba
   * es una llamada a Anthropic que se paga.
   */
  testMonthly: number;
  testDaily: number;
  /** Encuesta de satisfaccion a los clientes finales */
  nps: boolean;
  /**
   * Informe semanal individual de CADA bot activo del usuario, sin tope de
   * cantidad. Se limita por profundidad, no por cantidad de bots: cobrarle
   * Profesional a alguien con 3 bots y mandarle el informe de uno solo se
   * siente una estafa, y la queja cuesta mas que el reporte extra.
   */
  weeklyReports: boolean;
  /**
   * Informe consolidado que compara todos los bots entre si (rankings de
   * volumen, satisfaccion y deuda de conocimiento). Solo Agencia: tiene
   * sentido unicamente cuando se manejan varios bots a la vez, y es el
   * diferencial concreto del plan.
   */
  consolidatedReports: boolean;
}> = {
  FREE:    { bots: 1,         docsPerBot: 3,         monthlyMessages: 100,    whatsapp: false, assistantMonthly: 10,  assistantDaily: 5,   testMonthly: 60,   testDaily: 25,  nps: false, weeklyReports: false, consolidatedReports: false },
  STARTER: { bots: 1,         docsPerBot: 10,        monthlyMessages: 1000,   whatsapp: true,  assistantMonthly: 100, assistantDaily: 15,  testMonthly: 300,  testDaily: 60,  nps: true,  weeklyReports: false, consolidatedReports: false },
  PRO:     { bots: 5,         docsPerBot: 50,        monthlyMessages: 4000,   whatsapp: true,  assistantMonthly: 300, assistantDaily: 40,  testMonthly: 900,  testDaily: 150, nps: true,  weeklyReports: true,  consolidatedReports: false },
  AGENCY:  { bots: Infinity,  docsPerBot: Infinity,  monthlyMessages: 10000,  whatsapp: true,  assistantMonthly: 800, assistantDaily: 100, testMonthly: 2500, testDaily: 400, nps: true,  weeklyReports: true,  consolidatedReports: true  },
};

export const PLAN_LIMIT_CODE = 'PLAN_LIMIT_EXCEEDED';

/**
 * Plan que rige en este momento. Un plan pago vencido vale FREE aunque la
 * columna todavia diga otra cosa.
 *
 * Es la defensa inmediata: el cron que hace el downgrade corre una vez al dia,
 * y sin esto un usuario vencido seguiria usando WhatsApp y el cupo del plan
 * pago hasta la proxima corrida.
 */
export function effectivePlan(user: { plan: Plan; planExpiresAt: Date | null }): Plan {
  if (user.plan === 'FREE') return 'FREE';
  if (user.planExpiresAt && user.planExpiresAt.getTime() <= Date.now()) return 'FREE';
  return user.plan;
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * Verifica el limite mensual de mensajes de un usuario, reseteando el
 * contador si cambio el mes. Lanza AppError 429 si el limite se alcanzo.
 * Usable desde middleware (req.user) o directamente por userId
 * (webhook de WhatsApp y widget publico, donde no hay req.user).
 */
export async function assertMessageLimit(userId: string): Promise<void> {
  let user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true, messagesUsedThisMonth: true, messagesResetAt: true },
  });

  const now = new Date();
  if (!isSameMonth(user.messagesResetAt, now)) {
    user = await prisma.user.update({
      where: { id: userId },
      data: { messagesUsedThisMonth: 0, messagesResetAt: now },
      select: { plan: true, planExpiresAt: true, messagesUsedThisMonth: true, messagesResetAt: true },
    });
  }

  const plan = effectivePlan(user);
  const limit = LIMITS[plan].monthlyMessages;
  if (user.messagesUsedThisMonth >= limit) {
    throw new AppError(
      429,
      'Límite de mensajes del plan alcanzado',
      PLAN_LIMIT_CODE,
      { limit, used: user.messagesUsedThisMonth, plan },
    );
  }
}

/**
 * Incrementa el contador mensual del usuario. Llamar SOLO despues de que
 * el bot genero y persistio una respuesta exitosa.
 */
export async function incrementMessageUsage(userId: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { messagesUsedThisMonth: { increment: 1 } },
    });
  } catch (err) {
    // El contador nunca debe romper una respuesta ya generada
    console.error('[planLimits] Error al incrementar contador de mensajes:', err);
  }
}

// ─── Cupos dobles (mensual + diario) ──────────────────────────────────────────
// Los usan el asistente de plataforma y el Chat de prueba: los dos llaman a la
// API de Anthropic en cada mensaje, asi que sin tope un solo usuario Free
// podria generar costo ilimitado. La mecanica es identica en los dos, asi que
// vive una sola vez y se parametriza con las columnas de cada uno.

// El "dia" es el dia calendario de Paraguay (UTC-4, mismo criterio que
// dailySummary): si se usara UTC, el cupo diario se renovaria a las 20:00
// hora local, que para el usuario no significa nada.
const PY_OFFSET_MS = -4 * 3600 * 1000;

function pyDayKey(d: Date): string {
  const t = new Date(d.getTime() + PY_OFFSET_MS);
  return `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`;
}

/** Proxima medianoche paraguaya, expresada en UTC */
function nextPyMidnight(): Date {
  const now = new Date();
  const py = new Date(now.getTime() + PY_OFFSET_MS);
  const startOfNext = Date.UTC(py.getUTCFullYear(), py.getUTCMonth(), py.getUTCDate() + 1);
  return new Date(startOfNext - PY_OFFSET_MS);
}

/** Primer dia del mes siguiente (el reset mensual usa isSameMonth en UTC) */
function nextMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export interface AssistantQuota {
  allowed: boolean;
  /** Cual cupo se agoto; null si todavia hay */
  scope: 'daily' | 'monthly' | null;
  remaining: number;
  dailyRemaining: number;
  limit: number;
  dailyLimit: number;
  /** Cuando se renueva el cupo agotado (o el diario, si no se agoto ninguno) */
  resetsAt: string;
  plan: Plan;
}

/** Que columnas y que limites usa cada cupo doble */
interface DefinicionCupo {
  mes: 'assistantMsgsThisMonth' | 'testMsgsThisMonth';
  dia: 'assistantMsgsToday' | 'testMsgsToday';
  resetMes: 'assistantResetAt' | 'testResetAt';
  resetDia: 'assistantDayResetAt' | 'testDayResetAt';
  limiteMes: (l: (typeof LIMITS)[Plan]) => number;
  limiteDia: (l: (typeof LIMITS)[Plan]) => number;
}

const CUPO_ASISTENTE: DefinicionCupo = {
  mes: 'assistantMsgsThisMonth',
  dia: 'assistantMsgsToday',
  resetMes: 'assistantResetAt',
  resetDia: 'assistantDayResetAt',
  limiteMes: (l) => l.assistantMonthly,
  limiteDia: (l) => l.assistantDaily,
};

const CUPO_CHAT_PRUEBA: DefinicionCupo = {
  mes: 'testMsgsThisMonth',
  dia: 'testMsgsToday',
  resetMes: 'testResetAt',
  resetDia: 'testDayResetAt',
  limiteMes: (l) => l.testMonthly,
  limiteDia: (l) => l.testDaily,
};

/**
 * Estado de un cupo doble, reseteando contadores vencidos de paso.
 * Aplica el mismo criterio de plan vencido que el resto de los limites.
 */
async function checkCupoDoble(userId: string, cupo: DefinicionCupo): Promise<AssistantQuota> {
  const campos = {
    plan: true, planExpiresAt: true,
    [cupo.mes]: true, [cupo.dia]: true,
    [cupo.resetMes]: true, [cupo.resetDia]: true,
  } as const;

  type Fila = Record<string, unknown> & { plan: Plan; planExpiresAt: Date | null };
  let user = (await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: campos,
  })) as unknown as Fila;

  const now = new Date();
  const monthStale = !isSameMonth(user[cupo.resetMes] as Date, now);
  const dayStale = pyDayKey(user[cupo.resetDia] as Date) !== pyDayKey(now);

  if (monthStale || dayStale) {
    user = (await prisma.user.update({
      where: { id: userId },
      data: {
        ...(monthStale ? { [cupo.mes]: 0, [cupo.resetMes]: now } : {}),
        ...(dayStale ? { [cupo.dia]: 0, [cupo.resetDia]: now } : {}),
      },
      select: campos,
    })) as unknown as Fila;
  }

  const plan = effectivePlan(user);
  const limits = LIMITS[plan];
  const limiteMes = cupo.limiteMes(limits);
  const limiteDia = cupo.limiteDia(limits);
  const remaining = Math.max(0, limiteMes - (user[cupo.mes] as number));
  const dailyRemaining = Math.max(0, limiteDia - (user[cupo.dia] as number));

  // El mensual manda: si se agotaron los dos, lo que importa es cuando vuelve el mes
  const scope: AssistantQuota['scope'] =
    remaining <= 0 ? 'monthly' : dailyRemaining <= 0 ? 'daily' : null;

  return {
    allowed: scope === null,
    scope,
    remaining,
    dailyRemaining,
    limit: limiteMes,
    dailyLimit: limiteDia,
    resetsAt: (scope === 'monthly' ? nextMonthStart() : nextPyMidnight()).toISOString(),
    plan,
  };
}

/**
 * Incrementa los dos contadores de un cupo. Llamar SOLO despues de una llamada
 * exitosa a Anthropic; nunca rompe una respuesta ya generada.
 */
async function incrementarCupo(userId: string, cupo: DefinicionCupo, etiqueta: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { [cupo.mes]: { increment: 1 }, [cupo.dia]: { increment: 1 } },
    });
  } catch (err) {
    console.error(`[planLimits] Error al incrementar contador de ${etiqueta}:`, err);
  }
}

export const checkAssistantLimit = (userId: string) => checkCupoDoble(userId, CUPO_ASISTENTE);
export const incrementAssistantUsage = (userId: string) =>
  incrementarCupo(userId, CUPO_ASISTENTE, 'el asistente');

/**
 * Cupo del Chat de prueba del panel.
 *
 * Deliberadamente separado de monthlyMessages: el dueño probando su propio bot
 * no le puede consumir los mensajes que necesita para atender clientes reales.
 * Un Free con 100 mensajes que prueba 30 veces se quedaba con 70 para vender.
 */
export const checkTestChatLimit = (userId: string) => checkCupoDoble(userId, CUPO_CHAT_PRUEBA);
export const incrementTestChatUsage = (userId: string) =>
  incrementarCupo(userId, CUPO_CHAT_PRUEBA, 'el Chat de prueba');

/** Corta el Chat de prueba si el usuario agotó su cupo de pruebas */
export async function assertTestChatLimit(userId: string): Promise<void> {
  const cupo = await checkTestChatLimit(userId);
  if (cupo.allowed) return;
  throw new AppError(
    429,
    cupo.scope === 'daily'
      ? `Llegaste al límite de ${cupo.dailyLimit} mensajes de prueba por día. Se renueva a la medianoche. Esto no afecta los mensajes de tus clientes.`
      : `Llegaste al límite de ${cupo.limit} mensajes de prueba del mes en tu plan ${cupo.plan}. Esto no afecta los mensajes de tus clientes.`,
    PLAN_LIMIT_CODE,
    { limit: cupo.limit, dailyLimit: cupo.dailyLimit, scope: cupo.scope, resetsAt: cupo.resetsAt, plan: cupo.plan },
  );
}

export function checkBotLimit(req: Request, _res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: req.user!.userId },
        include: { _count: { select: { bots: true } } },
      });
      const plan = effectivePlan(user);
      const limit = LIMITS[plan];
      if (user._count.bots >= limit.bots) {
        throw new AppError(
          403,
          `Límite de bots alcanzado. Tu plan ${plan} permite máximo ${limit.bots} bot${limit.bots === 1 ? '' : 's'}. Actualizá tu plan para crear más.`,
          PLAN_LIMIT_CODE,
          { limit: limit.bots, used: user._count.bots, plan },
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  })();
}

export function checkDocLimit(req: Request, _res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });
      const plan = effectivePlan(user);
      const limit = LIMITS[plan];

      const docCount = await prisma.document.count({ where: { botId: req.params.botId } });
      if (docCount >= limit.docsPerBot) {
        throw new AppError(
          403,
          `Límite de documentos alcanzado. Tu plan ${plan} permite máximo ${limit.docsPerBot} documentos por bot. Eliminá alguno o actualizá tu plan.`,
          PLAN_LIMIT_CODE,
          { limit: limit.docsPerBot, used: docCount, plan },
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  })();
}

export function checkMessageLimit(req: Request, _res: Response, next: NextFunction): void {
  void (async () => {
    try {
      await assertMessageLimit(req.user!.userId);
      next();
    } catch (err) {
      next(err);
    }
  })();
}

export function checkWhatsAppAccess(req: Request, _res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });
      const plan = effectivePlan(user);
      if (!LIMITS[plan].whatsapp) {
        throw new AppError(
          403,
          user.plan !== 'FREE' && plan === 'FREE'
            ? 'Tu plan venció. Renovalo desde Planes para seguir usando WhatsApp.'
            : 'WhatsApp no está disponible en tu plan. Actualizá a Básico o superior.',
          PLAN_LIMIT_CODE,
          { limit: 0, used: 0, plan },
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  })();
}
