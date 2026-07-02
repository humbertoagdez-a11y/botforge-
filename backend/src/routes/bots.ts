import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { checkBotLimit } from '../middleware/planLimits';
import { generateInstructivo } from '../services/ai';

const router = Router();

router.use(requireAuth);

const createBotSchema = z.object({
  name: z.string().min(1).max(100),
  personality: z.string().max(5000).optional(),
  language: z.enum(['es', 'en', 'pt']).default('es'),
});

const updateBotSchema = createBotSchema.partial();

async function getOwnedBot(botId: string, userId: string) {
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Acceso denegado');
  return bot;
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bots = await prisma.bot.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { documents: true, conversations: true } },
      },
    });
    res.json({ data: bots, error: null, meta: { total: bots.length } });
  } catch (err) {
    next(err);
  }
});

router.post('/', checkBotLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createBotSchema.parse(req.body);
    const bot = await prisma.bot.create({
      data: { id: uuidv4(), userId: req.user!.userId, ...body },
    });
    res.status(201).json({ data: bot, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bot = await getOwnedBot(req.params.id, req.user!.userId);
    res.json({ data: bot, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOwnedBot(req.params.id, req.user!.userId);
    const body = updateBotSchema.parse(req.body);
    const updated = await prisma.bot.update({ where: { id: req.params.id }, data: body });
    res.json({ data: updated, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOwnedBot(req.params.id, req.user!.userId);
    await prisma.bot.delete({ where: { id: req.params.id } });
    res.json({ data: { ok: true }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

const instructivoSchema = z.object({
  answers: z.record(z.string().max(4000)).refine(
    (obj) => Object.values(obj).some((v) => v.trim().length > 0),
    { message: 'Se necesita al menos una respuesta' },
  ),
});

router.post('/:id/generate-instructivo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOwnedBot(req.params.id, req.user!.userId);
    const { answers } = instructivoSchema.parse(req.body);
    const instructivo = await generateInstructivo(answers);
    res.json({ data: { instructivo }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

export default router;
