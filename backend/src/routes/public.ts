import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { runTenantTurn } from '../services/tenantAgent';
import { AppError } from '../middleware/errorHandler';
import { assertMessageLimit, incrementMessageUsage } from '../middleware/planLimits';
import { widgetPorBot, widgetPorVisitante } from '../middleware/rateLimit';
import { resolverConversacion } from '../services/conversacion';
import { catalogoPublico } from '../services/planCatalog';

const router = Router();

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
});

/**
 * GET /planes — catalogo publico, derivado de LIMITS y de los precios reales.
 *
 * Existe para que la pagina de planes y cualquier integracion futura puedan
 * leer los limites de la fuente de verdad en vez de copiarlos. Es publico a
 * proposito: son los precios de la landing, no hay nada que proteger.
 */
router.get('/planes', (_req: Request, res: Response) => {
  res.json({ data: catalogoPublico(), error: null, meta: null });
});

router.post(
  '/bots/:botId/chat/stream',
  widgetPorVisitante,
  widgetPorBot,
  async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, conversationId } = chatSchema.parse(req.body);

    const bot = await prisma.bot.findUnique({ where: { id: req.params.botId, isActive: true } });
    if (!bot) throw new AppError(404, 'Bot no encontrado');

    const readyDocs = await prisma.document.count({ where: { botId: bot.id, status: 'READY' } });
    if (readyDocs === 0) throw new AppError(400, 'El bot no tiene documentos listos');

    // Limite mensual del plan del dueño del bot (antes de abrir el stream)
    await assertMessageLimit(bot.userId);

    const conversation = await resolverConversacion({
      botId: bot.id,
      canal: 'widget',
      nuevoChannelId: () => `widget-${uuidv4()}`,
      conversationId,
    });

    const recent = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    await prisma.message.create({
      data: { id: uuidv4(), conversationId: conversation.id, role: 'USER', content: message },
    });

    const history = recent
      .reverse()
      .map((m) => ({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content }));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const ac = new AbortController();
    req.on('close', () => ac.abort());

    function send(payload: Record<string, unknown>) {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }

    try {
      // Mismo motor que WhatsApp y que el Chat de prueba del panel
      const { content, tokensUsed } = await runTenantTurn({
        bot,
        history,
        message,
        clientId: `widget web (${conversation.id})`,
        channel: 'widget',
        stream: {
          onDelta: (text) => send({ type: 'delta', text }),
          onDiscard: () => send({ type: 'discard' }),
          onToolUse: (name) => send({ type: 'tool', name }),
          signal: ac.signal,
        },
      });

      if (!ac.signal.aborted) {
        const msg = await prisma.message.create({
          data: { id: uuidv4(), conversationId: conversation.id, role: 'ASSISTANT', content, tokensUsed },
        });
        await incrementMessageUsage(bot.userId);
        send({ type: 'done', conversationId: conversation.id, messageId: msg.id });
      }
    } catch {
      send({ type: 'error', message: 'Error al generar respuesta' });
    }

    res.end();
    } catch (err) {
      if (!res.headersSent) next(err);
      else res.end();
    }
  },
);

export default router;
