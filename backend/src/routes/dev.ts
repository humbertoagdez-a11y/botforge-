import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { generateDailySummaries } from '../services/dailySummary';

const router = Router();
router.use(requireAuth);

/**
 * Permite ejecutar tareas de mantenimiento manualmente. En producción solo lo
 * puede usar el primer usuario creado (dueño de la plataforma); en dev, cualquiera.
 */
async function assertCanRunDevTasks(userId: string): Promise<void> {
  if (env.NODE_ENV !== 'production') return;
  const firstUser = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!firstUser || firstUser.id !== userId) {
    throw new AppError(403, 'Solo el administrador puede ejecutar esta acción');
  }
}

// POST /api/v1/dev/trigger-daily-summary — dispara el resumen diario ahora
router.post('/trigger-daily-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertCanRunDevTasks(req.user!.userId);
    const sent = await generateDailySummaries();
    res.json({ data: { sent }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

export default router;
