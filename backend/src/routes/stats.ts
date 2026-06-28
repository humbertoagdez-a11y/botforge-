import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalBots, activeBots, totalDocs, totalConversations, monthlyMessages] =
      await Promise.all([
        prisma.bot.count({ where: { userId } }),
        prisma.bot.count({ where: { userId, isActive: true } }),
        prisma.document.count({ where: { bot: { userId } } }),
        prisma.conversation.count({ where: { bot: { userId } } }),
        prisma.message.count({
          where: {
            role: 'ASSISTANT',
            createdAt: { gte: startOfMonth },
            conversation: { bot: { userId } },
          },
        }),
      ]);

    res.json({
      data: { totalBots, activeBots, totalDocs, totalConversations, monthlyMessages },
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

export default router;
