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
  FREE:    { bots: 1,         docsPerBot: 3,         monthlyMessages: 100,    whatsapp: false, assistantMonthly: 10,  assistantDaily: 5,   nps: false, weeklyReports: false, consolidatedReports: false },
  STARTER: { bots: 1,         docsPerBot: 10,        monthlyMessages: 1000,   whatsapp: true,  assistantMonthly: 100, assistantDaily: 15,  nps: true,  weeklyReports: false, consolidatedReports: false },
  PRO:     { bots: 5,         docsPerBot: 50,        monthlyMessages: 4000,   whatsapp: true,  assistantMonthly: 300, assistantDaily: 40,  nps: true,  weeklyReports: true,  consolidatedReports: false },
  AGENCY:  { bots: Infinity,  docsPerBot: Infinity,  monthlyMessages: 10000,  whatsapp: true,  assistantMonthly: 800, assistantDaily: 100, nps: true,  weeklyReports: true,  consolidatedReports: true  },
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

// ─── Cupo del asistente de plataforma ─────────────────────────────────────────
// El asistente llama a la API de Anthropic en cada mensaje: sin tope, un solo
// usuario Free podria generar costo ilimitado. Cupo doble: mensual y diario.

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

/**
 * Estado del cupo del asistente, reseteando contadores vencidos de paso.
 * Aplica el mismo criterio de plan vencido que el resto de los limites.
 */
export async function checkAssistantLimit(userId: string): Promise<AssistantQuota> {
  let user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      plan: true,
      planExpiresAt: true,
      assistantMsgsThisMonth: true,
      assistantMsgsToday: true,
      assistantResetAt: true,
      assistantDayResetAt: true,
    },
  });

  const now = new Date();
  const monthStale = !isSameMonth(user.assistantResetAt, now);
  const dayStale = pyDayKey(user.assistantDayResetAt) !== pyDayKey(now);

  if (monthStale || dayStale) {
    user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(monthStale ? { assistantMsgsThisMonth: 0, assistantResetAt: now } : {}),
        ...(dayStale ? { assistantMsgsToday: 0, assistantDayResetAt: now } : {}),
      },
      select: {
        plan: true,
        planExpiresAt: true,
        assistantMsgsThisMonth: true,
        assistantMsgsToday: true,
        assistantResetAt: true,
        assistantDayResetAt: true,
      },
    });
  }

  const plan = effectivePlan(user);
  const limits = LIMITS[plan];
  const remaining = Math.max(0, limits.assistantMonthly - user.assistantMsgsThisMonth);
  const dailyRemaining = Math.max(0, limits.assistantDaily - user.assistantMsgsToday);

  // El mensual manda: si se agotaron los dos, lo que importa es cuando vuelve el mes
  const scope: AssistantQuota['scope'] =
    remaining <= 0 ? 'monthly' : dailyRemaining <= 0 ? 'daily' : null;

  return {
    allowed: scope === null,
    scope,
    remaining,
    dailyRemaining,
    limit: limits.assistantMonthly,
    dailyLimit: limits.assistantDaily,
    resetsAt: (scope === 'monthly' ? nextMonthStart() : nextPyMidnight()).toISOString(),
    plan,
  };
}

/**
 * Incrementa los dos contadores del asistente. Llamar SOLO despues de una
 * llamada exitosa a Anthropic; nunca rompe una respuesta ya generada.
 */
export async function incrementAssistantUsage(userId: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        assistantMsgsThisMonth: { increment: 1 },
        assistantMsgsToday: { increment: 1 },
      },
    });
  } catch (err) {
    console.error('[planLimits] Error al incrementar contador del asistente:', err);
  }
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
