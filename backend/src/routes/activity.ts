import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const EVENT_LIMIT = 20;

interface ActivityEvent {
  type: 'message' | 'document' | 'whatsapp';
  description: string;
  botName: string;
  createdAt: string;
}

function preview(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

const CHANNEL_LABEL: Record<string, string> = {
  web: 'chat web',
  whatsapp: 'WhatsApp',
  widget: 'widget',
};

// GET /api/v1/activity — ultimos eventos relevantes del usuario
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const [messages, documents, connections] = await Promise.all([
      prisma.message.findMany({
        where: { role: 'ASSISTANT', conversation: { bot: { userId } } },
        orderBy: { createdAt: 'desc' },
        take: EVENT_LIMIT,
        include: {
          conversation: {
            select: { channel: true, bot: { select: { name: true } } },
          },
        },
      }),
      prisma.document.findMany({
        where: { bot: { userId } },
        orderBy: { updatedAt: 'desc' },
        take: EVENT_LIMIT,
        include: { bot: { select: { name: true } } },
      }),
      prisma.whatsAppConnection.findMany({
        where: { status: 'ACTIVE', bot: { userId } },
        orderBy: { createdAt: 'desc' },
        take: EVENT_LIMIT,
        include: { bot: { select: { name: true } } },
      }),
    ]);

    const events: ActivityEvent[] = [
      ...messages.map((m) => ({
        type: 'message' as const,
        description: `Respondió por ${CHANNEL_LABEL[m.conversation.channel] ?? m.conversation.channel}: "${preview(m.content)}"`,
        botName: m.conversation.bot.name,
        createdAt: m.createdAt.toISOString(),
      })),
      ...documents.map((d) => {
        const description =
          d.status === 'READY'
            ? `Documento "${d.name}" procesado y listo`
            : d.status === 'ERROR'
              ? `Error al procesar el documento "${d.name}"`
              : `Documento "${d.name}" subido, en proceso`;
        return {
          type: 'document' as const,
          description,
          botName: d.bot.name,
          createdAt: d.updatedAt.toISOString(),
        };
      }),
      ...connections.map((c) => ({
        type: 'whatsapp' as const,
        description: `WhatsApp conectado (${c.phoneNumber})`,
        botName: c.bot.name,
        createdAt: c.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, EVENT_LIMIT);

    res.json({ data: events, error: null, meta: { total: events.length } });
  } catch (err) {
    next(err);
  }
});

export default router;
