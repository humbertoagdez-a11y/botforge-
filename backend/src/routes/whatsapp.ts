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

const SANDBOX_NUMBER = env.TWILIO_WHATSAPP_FROM?.replace('whatsapp:', '') ?? '+14155238886';
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateCode(): string {
  return `BF-${Math.floor(100000 + Math.random() * 900000)}`;
}

async function getOwnedBot(botId: string, userId: string) {
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Acceso denegado');
  return bot;
}

// ─── POST /bots/:botId/request-connection ─────────────────────────────────────
const connectionSchema = z.object({
  phoneNumber: z.string().regex(/^\+\d{7,15}$/, 'Formato inválido. Ejemplo: +595981234567'),
});

router.post(
  '/bots/:botId/request-connection',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { phoneNumber } = connectionSchema.parse(req.body);
      await getOwnedBot(req.params.botId, req.user!.userId);

      // Expire previous pending connections for this bot
      await prisma.whatsAppConnection.updateMany({
        where: { botId: req.params.botId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });

      const code = generateCode();
      const expiresAt = new Date(Date.now() + CODE_TTL_MS);

      await prisma.whatsAppConnection.create({
        data: {
          id: uuidv4(),
          botId: req.params.botId,
          phoneNumber,
          verificationCode: code,
          expiresAt,
        },
      });

      res.json({
        data: {
          code,
          sandboxNumber: SANDBOX_NUMBER,
          expiresAt: expiresAt.toISOString(),
        },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /bots/:botId/connection-status ───────────────────────────────────────
router.get(
  '/bots/:botId/connection-status',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bot = await getOwnedBot(req.params.botId, req.user!.userId);

      if (bot.whatsappNumber) {
        res.json({ data: { status: 'ACTIVE', phoneNumber: bot.whatsappNumber }, error: null, meta: null });
        return;
      }

      const conn = await prisma.whatsAppConnection.findFirst({
        where: { botId: req.params.botId },
        orderBy: { createdAt: 'desc' },
      });

      if (!conn) {
        res.json({ data: { status: 'IDLE' }, error: null, meta: null });
        return;
      }

      if (conn.status === 'PENDING' && new Date() > conn.expiresAt) {
        await prisma.whatsAppConnection.update({
          where: { id: conn.id },
          data: { status: 'EXPIRED' },
        });
        res.json({ data: { status: 'EXPIRED' }, error: null, meta: null });
        return;
      }

      res.json({
        data: {
          status: conn.status,
          phoneNumber: conn.status === 'ACTIVE' ? conn.phoneNumber : undefined,
          expiresAt: conn.status === 'PENDING' ? conn.expiresAt.toISOString() : undefined,
        },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /bots/:botId/connect ──────────────────────────────────────────────
router.delete(
  '/bots/:botId/connect',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bot = await getOwnedBot(req.params.botId, req.user!.userId);

      await prisma.whatsAppConnection.updateMany({
        where: { botId: bot.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });

      const updated = await prisma.bot.update({
        where: { id: bot.id },
        data: { whatsappNumber: null },
      });

      res.json({ data: updated, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /webhook ─────────────────────────────────────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  // Signature validation deshabilitada temporalmente
  // if (env.NODE_ENV === 'production' && env.TWILIO_AUTH_TOKEN) {
  //   const valid = twilio.validateRequest(
  //     env.TWILIO_AUTH_TOKEN,
  //     (req.headers['x-twilio-signature'] as string) ?? '',
  //     `${req.protocol}://${req.get('host')}${req.originalUrl}`,
  //     req.body as Record<string, string>,
  //   );
  //   if (!valid) {
  //     res.status(403).send('Forbidden');
  //     return;
  //   }
  // }

  const body = req.body as Record<string, string>;
  const from = body.From ?? '';
  const to = body.To ?? '';
  const msgBody = (body.Body ?? '').trim();
  const fromNumber = from.replace('whatsapp:', '');
  const toNumber = to.replace('whatsapp:', '');

  const twiml = new twilio.twiml.MessagingResponse();

  // ── Verification code flow ──────────────────────────────────────────────────
  if (/^BF-\d{6}$/i.test(msgBody)) {
    const code = msgBody.toUpperCase();
    try {
      const conn = await prisma.whatsAppConnection.findUnique({
        where: { verificationCode: code },
      });

      if (!conn || conn.status !== 'PENDING') {
        twiml.message('Código inválido o ya utilizado. Generá uno nuevo desde el panel de BotForge.');
      } else if (new Date() > conn.expiresAt) {
        await prisma.whatsAppConnection.update({ where: { id: conn.id }, data: { status: 'EXPIRED' } });
        twiml.message('El código expiró ⏱ Generá uno nuevo desde el panel de BotForge.');
      } else if (conn.phoneNumber !== fromNumber) {
        twiml.message('Este código fue generado para otro número. Asegurate de enviar desde el número que registraste.');
      } else {
        await prisma.$transaction([
          prisma.whatsAppConnection.update({ where: { id: conn.id }, data: { status: 'ACTIVE' } }),
          prisma.bot.update({ where: { id: conn.botId }, data: { whatsappNumber: fromNumber } }),
        ]);
        twiml.message('✅ ¡WhatsApp conectado exitosamente a tu bot de BotForge! Podés probarlo enviando cualquier mensaje.');
      }
    } catch (err) {
      console.error('[webhook] Error en verificación:', err);
      twiml.message('Hubo un error al verificar el código. Intentá de nuevo.');
    }
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // ── Normal chat flow ────────────────────────────────────────────────────────
  try {
    const senderNumber = fromNumber;
    const bot = await prisma.bot.findFirst({
      where: { whatsappNumber: senderNumber, isActive: true },
    });

    if (!bot) {
      twiml.message('Este número no tiene un bot activo configurado.');
      res.type('text/xml').send(twiml.toString());
      return;
    }

    const readyDocs = await prisma.document.count({ where: { botId: bot.id, status: 'READY' } });
    if (readyDocs === 0) {
      twiml.message('El bot aún no tiene documentos listos. Intenta más tarde.');
      res.type('text/xml').send(twiml.toString());
      return;
    }

    const channelId = from;
    let conversation = await prisma.conversation.findUnique({
      where: { botId_channelId: { botId: bot.id, channelId } },
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { id: uuidv4(), botId: bot.id, channelId, channel: 'whatsapp' },
      });
    }

    const recentMsgs = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    await prisma.message.create({
      data: { id: uuidv4(), conversationId: conversation.id, role: 'USER', content: msgBody },
    });

    const history = recentMsgs
      .reverse()
      .map((m) => ({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content }));

    const { content, tokensUsed } = await ragChat(
      bot.id, bot.name, bot.personality, bot.language, history, msgBody,
    );

    await prisma.message.create({
      data: { id: uuidv4(), conversationId: conversation.id, role: 'ASSISTANT', content, tokensUsed },
    });

    twiml.message(content);
  } catch (err) {
    console.error('[whatsapp] Error en webhook:', err);
    twiml.message('Hubo un problema al procesar tu mensaje. Por favor intentá de nuevo.');
  }

  res.type('text/xml').send(twiml.toString());
});

export default router;
