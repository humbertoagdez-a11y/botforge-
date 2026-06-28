import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { ragChat, ragStream } from '../services/rag';

const router = Router({ mergeParams: true });

router.use(requireAuth);

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
});

const HISTORY_LIMIT = 10;

async function resolveConversation(
  botId: string,
  userId: string,
  conversationId?: string,
) {
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Acceso denegado');

  const readyDocs = await prisma.document.count({ where: { botId: bot.id, status: 'READY' } });
  if (readyDocs === 0) {
    throw new AppError(400, 'El bot no tiene documentos procesados. Subí al menos uno primero.');
  }

  let conversation = conversationId
    ? await prisma.conversation.findUnique({ where: { id: conversationId } })
    : null;

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        id: uuidv4(),
        botId: bot.id,
        channelId: `web-${userId}-${uuidv4()}`,
        channel: 'web',
      },
    });
  }

  return { bot, conversation };
}

async function getHistory(conversationId: string, userMessage: string) {
  const recent = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
  });

  await prisma.message.create({
    data: { id: uuidv4(), conversationId, role: 'USER', content: userMessage },
  });

  return recent
    .reverse()
    .map((m) => ({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content }));
}

// ─── POST /  (standard JSON response) ───────────────────────────────────────
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, conversationId } = chatSchema.parse(req.body);
    const { bot, conversation } = await resolveConversation(
      req.params.botId,
      req.user!.userId,
      conversationId,
    );

    const history = await getHistory(conversation.id, message);

    const { content, tokensUsed } = await ragChat(
      bot.id,
      bot.name,
      bot.personality,
      bot.language,
      history,
      message,
    );

    const assistantMsg = await prisma.message.create({
      data: { id: uuidv4(), conversationId: conversation.id, role: 'ASSISTANT', content, tokensUsed },
    });

    res.json({ data: { conversationId: conversation.id, message: assistantMsg }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /stream  (Server-Sent Events) ─────────────────────────────────────
router.post('/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, conversationId } = chatSchema.parse(req.body);
    const { bot, conversation } = await resolveConversation(
      req.params.botId,
      req.user!.userId,
      conversationId,
    );

    const history = await getHistory(conversation.id, message);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    function sendEvent(payload: Record<string, unknown>) {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    }

    try {
      const { content, tokensUsed } = await ragStream(
        bot.id,
        bot.name,
        bot.personality,
        bot.language,
        history,
        message,
        (text) => sendEvent({ type: 'delta', text }),
        abortController.signal,
      );

      if (!abortController.signal.aborted) {
        const assistantMsg = await prisma.message.create({
          data: {
            id: uuidv4(),
            conversationId: conversation.id,
            role: 'ASSISTANT',
            content,
            tokensUsed,
          },
        });
        sendEvent({ type: 'done', conversationId: conversation.id, messageId: assistantMsg.id, tokensUsed });
      }
    } catch (streamErr) {
      sendEvent({ type: 'error', message: 'Error al generar la respuesta' });
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) next(err);
    else res.end();
  }
});

// ─── GET /history/:conversationId ────────────────────────────────────────────
router.get('/history/:conversationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new AppError(404, 'Conversación no encontrada');

    const bot = await prisma.bot.findUnique({ where: { id: conversation.botId } });
    if (bot?.userId !== req.user!.userId) throw new AppError(403, 'Acceso denegado');

    res.json({ data: conversation, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

export default router;
