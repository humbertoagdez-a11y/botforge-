import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from './errorHandler';
import type { Plan } from '@prisma/client';

export const LIMITS: Record<Plan, {
  bots: number;
  docsPerBot: number;
  monthlyMessages: number;
  whatsapp: boolean;
}> = {
  FREE:    { bots: 1,         docsPerBot: 3,         monthlyMessages: 100,    whatsapp: false },
  STARTER: { bots: 1,         docsPerBot: 10,        monthlyMessages: 1000,   whatsapp: true  },
  PRO:     { bots: 5,         docsPerBot: 50,        monthlyMessages: 4000,   whatsapp: true  },
  AGENCY:  { bots: Infinity,  docsPerBot: Infinity,  monthlyMessages: 10000,  whatsapp: true  },
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
