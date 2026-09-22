import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { checkBotLimit, effectivePlan, LIMITS, PLAN_LIMIT_CODE } from '../middleware/planLimits';
import { generateInstructivo } from '../services/ai';

const router = Router();

router.use(requireAuth);

const createBotSchema = z.object({
  name: z.string().min(1).max(100),
  personality: z.string().max(5000).optional(),
  language: z.enum(['es', 'en', 'pt']).default('es'),
});

const updateBotSchema = createBotSchema.partial().extend({
  isActive: z.boolean().optional(),
  npsEnabled: z.boolean().optional(),
});

/**
 * Campos del bot que se le devuelven al navegador.
 *
 * Es una lista blanca EXPLICITA, no un findUnique pelado, y el motivo son dos
 * campos: metaBusinessToken y metaRegistrationPin. El token de negocio del
 * cliente no expira nunca y permite enviar WhatsApp en su nombre; el PIN es su
 * verificacion en dos pasos. El frontend no usa ninguno de los dos, asi que no
 * tienen por que salir del servidor.
 *
 * Si mañana se agrega un campo al modelo hay que sumarlo aca a mano. Es
 * deliberado: obliga a decidir si ese campo puede viajar, en vez de que se
 * filtre solo.
 */
const CAMPOS_PUBLICOS = {
  id: true,
  userId: true,
  name: true,
  personality: true,
  language: true,
  whatsappNumber: true,
  metaPhoneNumberId: true,
  metaWabaId: true,
  metaBusinessId: true,
  metaDisplayNumber: true,
  metaConectadoEn: true,
  metaEstado: true,
  npsEnabled: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

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
      select: {
        ...CAMPOS_PUBLICOS,
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
      select: CAMPOS_PUBLICOS,
    });
    res.status(201).json({ data: bot, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOwnedBot(req.params.id, req.user!.userId);
    // Se relee con la lista blanca: getOwnedBot trae la fila entera porque la
    // usan otras rutas para leer campos internos, y eso no puede salir al
    // navegador.
    const bot = await prisma.bot.findUnique({
      where: { id: req.params.id },
      select: CAMPOS_PUBLICOS,
    });
    res.json({ data: bot, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOwnedBot(req.params.id, req.user!.userId);
    const body = updateBotSchema.parse(req.body);

    // El plan manda: sin NPS en el plan no se puede activar desde la API,
    // aunque el frontend muestre el switch deshabilitado
    if (body.npsEnabled === true) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: req.user!.userId },
        select: { plan: true, planExpiresAt: true },
      });
      if (!LIMITS[effectivePlan(user)].nps) {
        throw new AppError(
          403,
          'La encuesta de satisfacción está disponible desde el plan Básico.',
          PLAN_LIMIT_CODE,
        );
      }
    }

    const updated = await prisma.bot.update({
      where: { id: req.params.id },
      data: body,
      select: CAMPOS_PUBLICOS,
    });
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
