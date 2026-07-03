import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import twilio from 'twilio';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { checkWhatsAppAccess, assertMessageLimit, incrementMessageUsage } from '../middleware/planLimits';
import { ragChat } from '../services/rag';
import { sendEmail } from '../services/email';

// ─── Notificación "el cliente pide un humano" ─────────────────────────────────

const HUMAN_KEYWORDS = [
  'hablar con una persona',
  'hablar con alguien',
  'quiero hablar con alguien',
  'hablar con un humano',
  'con un humano',
  'persona real',
  'un agente',
  'atencion humana',
  'atención humana',
  'no sos una persona',
  'sos un robot',
];

function wantsHuman(message: string): boolean {
  const lower = message.toLowerCase();
  return HUMAN_KEYWORDS.some((k) => lower.includes(k));
}

async function notifyHumanRequested(
  bot: { id: string; name: string },
  clientNumber: string,
  message: string,
): Promise<void> {
  try {
    const config = await prisma.notificationConfig.findUnique({
      where: { botId_event: { botId: bot.id, event: 'human_requested' } },
    });
    if (!config?.isActive) return;

    const preview = message.length > 200 ? `${message.slice(0, 200)}...` : message;
    await sendEmail(
      config.email,
      'Tu bot necesita ayuda humana',
      `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:20px;font-weight:bold;color:#7C3AED;margin:0 0 20px;">BotForge</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
        Un cliente pidió hablar con una persona en el bot <strong>${bot.name}</strong>.
      </p>
      <p style="font-size:14px;color:#333;margin:0 0 4px;">Número del cliente: <strong>${clientNumber}</strong></p>
      <p style="font-size:14px;color:#333;margin:0 0 20px;">Mensaje: "${preview}"</p>
      <a href="${env.FRONTEND_URL}/dashboard/conversations"
         style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:10px 24px;border-radius:8px;">
        Ver la conversación
      </a>
    </div>
  </body>
</html>`,
    );
  } catch (err) {
    console.error('[whatsapp] Error al notificar pedido de humano:', err);
  }
}

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
  checkWhatsAppAccess,
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

// ─── Validación de firma Twilio ───────────────────────────────────────────────
// Usa BACKEND_URL fija (no reconstruye la URL del request): detras del proxy
// de Railway req.protocol/host no coinciden con la URL publica que firma Twilio
function validateTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn('[webhook] TWILIO_AUTH_TOKEN no configurado, saltando validación');
    next();
    return;
  }

  const signature = (req.headers['x-twilio-signature'] as string | undefined) ?? '';
  const url = `${env.BACKEND_URL}/api/v1/whatsapp/webhook`;
  const params = req.body as Record<string, string>;

  const isValid = twilio.validateRequest(authToken, signature, url, params);

  if (!isValid) {
    console.warn('[webhook] Firma Twilio inválida — request rechazado');
    console.log('[webhook] URL usada para validar:', url);
    console.log('[webhook] Signature recibida:', signature);
    res.status(403).send('Forbidden');
    return;
  }

  next();
}

// ─── POST /webhook ─────────────────────────────────────────────────────────────
router.post('/webhook', validateTwilioSignature, async (req: Request, res: Response) => {
  const body = req.body as Record<string, string>;
  const from = body.From ?? '';
  const msgBody = (body.Body ?? '').trim();
  const fromNumber = from.replace('whatsapp:', '');

  console.log('[webhook] from:', from);
  console.log('[webhook] senderNumber:', from.replace('whatsapp:', ''));

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
    console.log('[webhook] bot encontrado:', bot?.id, bot?.whatsappNumber);

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

    // Limite mensual del plan del dueño del bot
    try {
      await assertMessageLimit(bot.userId);
    } catch (limitErr) {
      if (limitErr instanceof AppError && limitErr.statusCode === 429) {
        twiml.message('Este bot alcanzó el límite mensual de mensajes de su plan. El negocio ya fue notificado.');
        res.type('text/xml').send(twiml.toString());
        return;
      }
      throw limitErr;
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

    // Notificacion por email si el cliente pide hablar con una persona
    if (wantsHuman(msgBody)) {
      void notifyHumanRequested(bot, senderNumber, msgBody);
    }

    const history = recentMsgs
      .reverse()
      .map((m) => ({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content }));

    const { content, tokensUsed } = await ragChat(
      bot.id, bot.name, bot.personality, bot.language, history, msgBody,
    );

    await prisma.message.create({
      data: { id: uuidv4(), conversationId: conversation.id, role: 'ASSISTANT', content, tokensUsed },
    });

    await incrementMessageUsage(bot.userId);

    twiml.message(content);
  } catch (err) {
    console.error('[whatsapp] Error en webhook:', err);
    twiml.message('Hubo un problema al procesar tu mensaje. Por favor intentá de nuevo.');
  }

  res.type('text/xml').send(twiml.toString());
});

export default router;
