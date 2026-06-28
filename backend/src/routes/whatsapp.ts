import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import twilio from 'twilio';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { ragChat } from '../services/rag';

const router = Router();

// ─── Webhook público de Twilio ────────────────────────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  // Verificar firma de Twilio en producción
  if (env.NODE_ENV === 'production' && env.TWILIO_AUTH_TOKEN) {
    const valid = twilio.validateRequest(
      env.TWILIO_AUTH_TOKEN,
      req.headers['x-twilio-signature'] as string ?? '',
      `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      req.body as Record<string, string>,
    );
    if (!valid) {
      res.status(403).send('Forbidden');
      return;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const from = (req.body as Record<string, string>).From ?? '';
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const to = (req.body as Record<string, string>).To ?? '';
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const body = (req.body as Record<string, string>).Body ?? '';

  const phoneNumber = to.replace('whatsapp:', '');

  const twiml = new twilio.twiml.MessagingResponse();

  try {
    const bot = await prisma.bot.findFirst({
      where: { whatsappNumber: phoneNumber, isActive: true },
    });

    if (!bot) {
      twiml.message('Este número no tiene un bot activo configurado.');
      res.type('text/xml').send(twiml.toString());
      return;
    }

    const readyDocs = await prisma.document.count({
      where: { botId: bot.id, status: 'READY' },
    });

    if (readyDocs === 0) {
      twiml.message('El bot aún no tiene documentos listos. Intenta más tarde.');
      res.type('text/xml').send(twiml.toString());
      return;
    }

    // Buscar o crear conversación para este número
    const channelId = from;
    let conversation = await prisma.conversation.findUnique({
      where: { botId_channelId: { botId: bot.id, channelId } },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { id: uuidv4(), botId: bot.id, channelId, channel: 'whatsapp' },
      });
    }

    // Historial de los últimos 10 mensajes
    const recentMsgs = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    await prisma.message.create({
      data: { id: uuidv4(), conversationId: conversation.id, role: 'USER', content: body },
    });

    const history = recentMsgs
      .reverse()
      .map((m) => ({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content }));

    const { content, tokensUsed } = await ragChat(
      bot.id,
      bot.name,
      bot.personality,
      bot.language,
      history,
      body,
    );

    await prisma.message.create({
      data: {
        id: uuidv4(),
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content,
        tokensUsed,
      },
    });

    twiml.message(content);
  } catch (err) {
    console.error('[whatsapp] Error en webhook:', err);
    twiml.message('Hubo un problema al procesar tu mensaje. Por favor intenta de nuevo.');
  }

  res.type('text/xml').send(twiml.toString());
});

// ─── Conectar número de WhatsApp a un bot (requiere auth) ────────────────────
const connectSchema = z.object({ whatsappNumber: z.string().regex(/^\+\d{7,15}$/, 'Número inválido (ej: +595981234567)') });

router.patch('/bots/:botId/connect', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { whatsappNumber } = connectSchema.parse(req.body);

    const bot = await prisma.bot.findUnique({ where: { id: req.params.botId } });
    if (!bot) throw new AppError(404, 'Bot no encontrado');
    if (bot.userId !== req.user!.userId) throw new AppError(403, 'Acceso denegado');

    // Verificar que el número no está en uso por otro bot
    const existing = await prisma.bot.findFirst({
      where: { whatsappNumber, id: { not: bot.id } },
    });
    if (existing) throw new AppError(409, 'Ese número ya está asignado a otro bot');

    const updated = await prisma.bot.update({
      where: { id: bot.id },
      data: { whatsappNumber },
    });

    res.json({ data: updated, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

router.delete('/bots/:botId/connect', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bot = await prisma.bot.findUnique({ where: { id: req.params.botId } });
    if (!bot) throw new AppError(404, 'Bot no encontrado');
    if (bot.userId !== req.user!.userId) throw new AppError(403, 'Acceso denegado');

    const updated = await prisma.bot.update({
      where: { id: bot.id },
      data: { whatsappNumber: null },
    });

    res.json({ data: updated, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

export default router;
