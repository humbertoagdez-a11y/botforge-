import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { LIMITS } from '../middleware/planLimits';

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
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } }),
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

    const limits = LIMITS[user.plan];

    res.json({
      data: {
        plan: user.plan,
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

export default router;
