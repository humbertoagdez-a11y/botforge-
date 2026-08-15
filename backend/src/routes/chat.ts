/**
 * Chat de prueba del panel: el dueño prueba su bot antes de conectarlo.
 *
 * Corre por el MISMO motor que WhatsApp (runTenantTurn): mismo modelo, mismas
 * herramientas, mismo limite de rondas, mismo umbral de RAG y mismo system
 * prompt. Lo unico que cambia es el canal por el que entra y sale el texto.
 *
 * Es la razon de ser de esta pantalla: si el panel respondiera distinto que
 * WhatsApp, el dueño aprobaria un comportamiento que sus clientes nunca van a
 * recibir. Antes pasaba exactamente eso — esta ruta llamaba a un motor sin
 * herramientas.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { assertTestChatLimit, incrementTestChatUsage } from '../middleware/planLimits';
import { runTenantTurn } from '../services/tenantAgent';

const router = Router({ mergeParams: true });

router.use(requireAuth);

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
});

/** Mismo tamaño de ventana que usa el pipeline de WhatsApp */
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

  // Una conversación ajena nunca se continúa aunque llegue un id válido
  if (conversation && conversation.botId !== bot.id) conversation = null;

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

/** Lee la ventana de historial y persiste el mensaje del cliente, como WhatsApp */
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

// ─── POST /stream  (Server-Sent Events) ─────────────────────────────────────
router.post('/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, conversationId } = chatSchema.parse(req.body);

    // Cupo propio del Chat de prueba. NO se toca monthlyMessages: probar el
    // bot no le puede comer al dueño los mensajes que necesita para vender.
    await assertTestChatLimit(req.user!.userId);

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
      const { content, tokensUsed, pendingImage } = await runTenantTurn({
        bot,
        history,
        message,
        // El dueño probando no es un cliente: se identifica como tal en las
        // notificaciones que dispare el bot (derivar_a_humano manda un email)
        clientId: `Chat de prueba (${req.user!.email})`,
        channel: 'web',
        stream: {
          onDelta: (text) => sendEvent({ type: 'delta', text }),
          onDiscard: () => sendEvent({ type: 'discard' }),
          onToolUse: (name) => sendEvent({ type: 'tool', name }),
          signal: abortController.signal,
        },
      });

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
        await incrementTestChatUsage(req.user!.userId);
        sendEvent({
          type: 'done',
          conversationId: conversation.id,
          messageId: assistantMsg.id,
          tokensUsed,
          // Las imágenes del panel ya viven en Cloudinary, así que el Chat de
          // prueba puede mostrar exactamente la misma que recibiría el cliente.
          // Las de Drive llegan como binario y no se suben acá solo para la
          // vista previa: de esas se avisa el nombre.
          imagen: pendingImage
            ? pendingImage.source === 'url'
              ? { caption: pendingImage.caption, url: pendingImage.url }
              : { caption: pendingImage.caption, url: null }
            : null,
        });
      }
    } catch (streamErr) {
      console.error('[chat] Error generando la respuesta de prueba:', streamErr);
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
