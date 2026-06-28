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
  PRO:     { bots: 5,         docsPerBot: 50,        monthlyMessages: 10000,  whatsapp: true  },
  AGENCY:  { bots: Infinity,  docsPerBot: Infinity,  monthlyMessages: 100000, whatsapp: true  },
};

export function checkBotLimit(req: Request, _res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: req.user!.userId },
        include: { _count: { select: { bots: true } } },
      });
      const limit = LIMITS[user.plan];
      if (user._count.bots >= limit.bots) {
        throw new AppError(
          403,
          `Tu plan ${user.plan} permite máximo ${limit.bots} bot${limit.bots === 1 ? '' : 's'}. Actualizá tu plan para crear más.`,
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
      const limit = LIMITS[user.plan];

      const docCount = await prisma.document.count({ where: { botId: req.params.botId } });
      if (docCount >= limit.docsPerBot) {
        throw new AppError(
          403,
          `Tu plan ${user.plan} permite máximo ${limit.docsPerBot} documentos por bot. Eliminá alguno o actualizá tu plan.`,
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
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });
      const limit = LIMITS[user.plan];

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const msgCount = await prisma.message.count({
        where: {
          role: 'ASSISTANT',
          createdAt: { gte: startOfMonth },
          conversation: { bot: { userId: req.user!.userId } },
        },
      });

      if (msgCount >= limit.monthlyMessages) {
        throw new AppError(
          403,
          `Alcanzaste el límite de ${limit.monthlyMessages} mensajes mensuales de tu plan. Actualizá tu plan para continuar.`,
        );
      }
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
      if (!LIMITS[user.plan].whatsapp) {
        throw new AppError(403, 'WhatsApp no está disponible en tu plan. Actualizá a Básico o superior.');
      }
      next();
    } catch (err) {
      next(err);
    }
  })();
}
