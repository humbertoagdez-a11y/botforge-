import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { LIMITS, effectivePlan } from '../middleware/planLimits';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      user,
      totalBots,
      activeBots,
      botsWithWhatsApp,
      totalDocs,
      readyDocs,
      totalConversations,
      activeConversations,
      monthlyMessages,
      messagesToday,
      totalMessages,
      recentConversations,
    ] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { plan: true, planExpiresAt: true },
      }),
      prisma.bot.count({ where: { userId } }),
      prisma.bot.count({ where: { userId, isActive: true } }),
      prisma.bot.count({ where: { userId, whatsappNumber: { not: null } } }),
      prisma.document.count({ where: { bot: { userId } } }),
      prisma.document.count({ where: { bot: { userId }, status: 'READY' } }),
      prisma.conversation.count({ where: { bot: { userId } } }),
      prisma.conversation.count({ where: { bot: { userId }, updatedAt: { gte: last24h } } }),
      prisma.message.count({
        where: {
          role: 'ASSISTANT',
          createdAt: { gte: startOfMonth },
          conversation: { bot: { userId } },
        },
      }),
      prisma.message.count({
        where: {
          role: 'ASSISTANT',
          createdAt: { gte: startOfToday },
          conversation: { bot: { userId } },
        },
      }),
      prisma.message.count({
        where: { role: 'ASSISTANT', conversation: { bot: { userId } } },
      }),
      prisma.conversation.findMany({
        where: { bot: { userId } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        include: {
          bot: { select: { name: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, role: true, createdAt: true },
          },
          _count: { select: { messages: true } },
        },
      }),
    ]);

    // effectivePlan y no user.plan: un plan vencido ya vale FREE para el
    // enforcement, y el panel tiene que mostrar el mismo limite que se aplica
    const planVigente = effectivePlan(user);
    const limits = LIMITS[planVigente];

    res.json({
      data: {
        plan: planVigente,
        planLimits: {
          bots: Number.isFinite(limits.bots) ? limits.bots : null,
          docsPerBot: Number.isFinite(limits.docsPerBot) ? limits.docsPerBot : null,
          monthlyMessages: limits.monthlyMessages,
          whatsapp: limits.whatsapp,
        },
        totalBots,
        activeBots,
        botsWithWhatsApp,
        botsWithoutWhatsApp: totalBots - botsWithWhatsApp,
        totalDocs,
        readyDocs,
        totalConversations,
        activeConversations,
        monthlyMessages,
        messagesToday,
        totalMessages,
        recentConversations,
      },
      error: null,
      meta: null,
    });
  } catch (err) {
    next(err);
  }
});

// Conversaciones paginadas
router.get('/conversations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where: { bot: { userId: req.user!.userId } },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          bot: { select: { name: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, role: true, createdAt: true },
          },
          _count: { select: { messages: true } },
        },
      }),
      prisma.conversation.count({ where: { bot: { userId: req.user!.userId } } }),
    ]);

    res.json({
      data: conversations,
      error: null,
      meta: { total, page, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// Hilo completo de una conversación (con verificación de propiedad)
router.get('/conversations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        bot: { select: { name: true, userId: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    });

    if (!conversation) throw new AppError(404, 'Conversación no encontrada');
    if (conversation.bot.userId !== req.user!.userId) throw new AppError(403, 'Acceso denegado');

    const { bot, ...rest } = conversation;
    res.json({
      data: { ...rest, bot: { name: bot.name } },
      error: null,
      meta: null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── NPS ──────────────────────────────────────────────────────────────────────

const SEMANAS_EVOLUCION = 8;

/** Bots del usuario, opcionalmente acotado a uno. Verifica pertenencia. */
async function resolveBotIds(userId: string, botId?: string): Promise<string[]> {
  if (botId) {
    const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { userId: true } });
    if (!bot) throw new AppError(404, 'Bot no encontrado');
    if (bot.userId !== userId) throw new AppError(403, 'Acceso denegado');
    return [botId];
  }
  const bots = await prisma.bot.findMany({ where: { userId }, select: { id: true } });
  return bots.map((b) => b.id);
}

router.get('/nps', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const botId = typeof req.query.botId === 'string' ? req.query.botId : undefined;

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true, planExpiresAt: true },
    });
    const plan = effectivePlan(user);

    // Sin NPS en el plan se responde igual, con enabled false: el frontend
    // muestra la sección bloqueada en vez de un error
    if (!LIMITS[plan].nps) {
      res.json({ data: { enabled: false, plan }, error: null, meta: null });
      return;
    }

    const botIds = await resolveBotIds(userId, botId);
    if (botIds.length === 0) {
      res.json({
        data: { enabled: true, plan, total: 0, promedio: null, distribucion: [], comentarios: [], evolucion: [], preguntas: 0, sinRevisar: 0 },
        error: null,
        meta: null,
      });
      return;
    }

    const desdeEvolucion = new Date(Date.now() - SEMANAS_EVOLUCION * 7 * 24 * 60 * 60 * 1000);

    const [respuestas, preguntas, comentarios] = await Promise.all([
      prisma.npsResponse.findMany({
        where: { botId: { in: botIds } },
        orderBy: { createdAt: 'desc' },
        take: 2000,
        select: { score: true, sentiment: true, createdAt: true, reviewed: true },
      }),
      prisma.npsPrompt.count({ where: { botId: { in: botIds } } }),
      prisma.npsResponse.findMany({
        where: { botId: { in: botIds }, comment: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, score: true, sentiment: true, comment: true,
          reviewed: true, createdAt: true,
          bot: { select: { name: true } },
        },
      }),
    ]);

    const total = respuestas.length;
    const promedio = total > 0 ? respuestas.reduce((a, r) => a + r.score, 0) / total : null;

    const distribucion = [1, 2, 3, 4, 5].map((score) => ({
      score,
      cantidad: respuestas.filter((r) => r.score === score).length,
    }));

    const sinRevisar = respuestas.filter((r) => r.sentiment === 'DETRACTOR' && !r.reviewed).length;

    // Evolución por semana: se agrupa en memoria porque el volumen es chico
    const evolucion: Array<{ semana: string; promedio: number; cantidad: number }> = [];
    for (let i = SEMANAS_EVOLUCION - 1; i >= 0; i--) {
      const fin = new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000);
      const inicio = new Date(fin.getTime() - 7 * 24 * 60 * 60 * 1000);
      const dentro = respuestas.filter((r) => r.createdAt >= inicio && r.createdAt < fin);
      evolucion.push({
        semana: fin.toISOString().slice(5, 10),
        promedio: dentro.length > 0 ? Number((dentro.reduce((a, r) => a + r.score, 0) / dentro.length).toFixed(2)) : 0,
        cantidad: dentro.length,
      });
    }
    void desdeEvolucion;

    res.json({
      data: {
        enabled: true,
        plan,
        total,
        promedio: promedio !== null ? Number(promedio.toFixed(2)) : null,
        preguntas,
        tasaRespuesta: preguntas > 0 ? Number(((total / preguntas) * 100).toFixed(0)) : 0,
        sinRevisar,
        distribucion,
        evolucion,
        comentarios: comentarios.map((c) => ({
          id: c.id,
          score: c.score,
          sentiment: c.sentiment,
          comment: c.comment,
          reviewed: c.reviewed,
          createdAt: c.createdAt,
          bot: c.bot.name,
        })),
      },
      error: null,
      meta: null,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /nps/:id/reviewed — marcar un comentario como visto
router.patch('/nps/:id/reviewed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const respuesta = await prisma.npsResponse.findUnique({
      where: { id: req.params.id },
      include: { bot: { select: { userId: true } } },
    });
    if (!respuesta) throw new AppError(404, 'Respuesta no encontrada');
    // Sin esto cualquier usuario marcaría como visto el NPS de otro
    if (respuesta.bot.userId !== req.user!.userId) throw new AppError(403, 'Acceso denegado');

    const updated = await prisma.npsResponse.update({
      where: { id: respuesta.id },
      data: { reviewed: true },
      select: { id: true, reviewed: true },
    });
    res.json({ data: updated, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

export default router;
