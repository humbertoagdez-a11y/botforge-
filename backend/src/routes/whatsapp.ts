import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import twilio from 'twilio';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { checkWhatsAppAccess } from '../middleware/planLimits';
import { completarOnboarding, ESTADO_REVOCADO } from '../services/metaOnboarding';
import { transcribeAudio, analyzeImage } from '../services/inboundMedia';
import {
  handleVerificationCode,
  confirmarEntrega,
  marcarNoEntregado,
  processInboundMessage,
  VERIFICATION_CODE_RE,
} from '../services/inboundMessage';
import { sendTextMessage, sendPendingImage, isTwilioConfigured } from '../services/twilioMessaging';

const router = Router();

const SANDBOX_NUMBER = env.TWILIO_WHATSAPP_FROM?.replace('whatsapp:', '') ?? '+14155238886';
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Canal activo y numero al que el cliente tiene que escribirle para conectar.
 * Con Twilio apagado (default) es el numero real de WhatsApp Business; si se
 * reactiva Twilio, vuelve a ser el del sandbox. El frontend arma las
 * instrucciones con esto, sin numeros hardcodeados.
 */
function activeChannel(): { channel: 'meta' | 'twilio'; businessNumber: string } {
  return env.TWILIO_WHATSAPP_ENABLED
    ? { channel: 'twilio', businessNumber: SANDBOX_NUMBER }
    : { channel: 'meta', businessNumber: env.META_WHATSAPP_DISPLAY_NUMBER };
}

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
  requireVerifiedEmail,
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

      const { channel, businessNumber } = activeChannel();

      res.json({
        data: {
          code,
          channel,
          businessNumber,
          // Alias heredado: lo lee el frontend anterior a Meta. Apunta al mismo
          // numero, asi que durante el deploy escalonado sigue siendo correcto.
          sandboxNumber: businessNumber,
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
  requireVerifiedEmail,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bot = await getOwnedBot(req.params.botId, req.user!.userId);
      const base = activeChannel();

      // Con Meta los mensajes llegan al numero de negocio, no al del cliente:
      // ese es el numero que hay que mostrar como conectado. Con Twilio sigue
      // siendo el numero del cliente, que es donde rutea el sandbox.
      // El numero propio manda sobre el de la plataforma: un bot conectado por
      // Embedded Signup atiende desde SU numero, y mostrar el de BotForge seria
      // la misma contradiccion que ya se corrigio en el encabezado del bot.
      const connectedNumber = bot.metaPhoneNumberId
        ? (bot.metaDisplayNumber ?? base.businessNumber)
        : bot.whatsappNumber;

      if (connectedNumber) {
        // REVOCADO tiene su propio estado: el numero sigue vinculado pero los
        // envios rebotan. Mostrarlo como ACTIVE era dejarle al dueño un
        // WhatsApp "conectado" que en realidad no contesta a nadie.
        res.json({
          data: {
            ...base,
            status: bot.metaEstado === ESTADO_REVOCADO ? 'REVOKED' : 'ACTIVE',
            phoneNumber: connectedNumber,
            // Solo los conectados por Embedded Signup tienen numero propio
            numeroPropio: Boolean(bot.metaBusinessToken) || Boolean(bot.metaDisplayNumber),
          },
          error: null,
          meta: null,
        });
        return;
      }

      const conn = await prisma.whatsAppConnection.findFirst({
        where: { botId: req.params.botId },
        orderBy: { createdAt: 'desc' },
      });

      if (!conn) {
        res.json({ data: { ...base, status: 'IDLE' }, error: null, meta: null });
        return;
      }

      if (conn.status === 'PENDING' && new Date() > conn.expiresAt) {
        await prisma.whatsAppConnection.update({
          where: { id: conn.id },
          data: { status: 'EXPIRED' },
        });
        res.json({ data: { ...base, status: 'EXPIRED' }, error: null, meta: null });
        return;
      }

      res.json({
        data: {
          ...base,
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
  requireVerifiedEmail,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bot = await getOwnedBot(req.params.botId, req.user!.userId);

      await prisma.whatsAppConnection.updateMany({
        where: { botId: bot.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });

      // Se limpia TODO el rastro de Meta, no solo el vinculo.
      //
      // Antes quedaban metaBusinessToken, metaEstado ACTIVO, el wabaId y el
      // numero visible. Consecuencias reales: seguiamos guardando la
      // credencial de un cliente que ya se fue, y si despues conectaba OTRO
      // numero, tokenDelBot() devolvia el token viejo —que no tiene permiso
      // sobre la WABA nueva— hasta que el onboarding lo pisara.
      const updated = await prisma.bot.update({
        where: { id: bot.id },
        data: {
          whatsappNumber: null,
          metaPhoneNumberId: null,
          metaBusinessToken: null,
          metaBusinessId: null,
          metaWabaId: null,
          metaDisplayNumber: null,
          metaRegistrationPin: null,
          metaConectadoEn: null,
          metaEstado: null,
        },
      });

      res.json({ data: updated, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Kill switch del canal Twilio ─────────────────────────────────────────────
// El canal activo es Meta Cloud API. El codigo de Twilio queda intacto pero
// inactivo: se reactiva poniendo TWILIO_WHATSAPP_ENABLED=true, sin tocar nada
// mas. Responde 200 con TwiML vacio para que Twilio no reintente.
function requireTwilioEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!env.TWILIO_WHATSAPP_ENABLED) {
    res.status(200).type('text/xml').send('<Response></Response>');
    return;
  }
  next();
}

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
router.post(
  '/webhook',
  requireTwilioEnabled,
  validateTwilioSignature,
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, string>;
    const from = body.From ?? '';
    let msgBody = (body.Body ?? '').trim();
    const fromNumber = from.replace('whatsapp:', '');

    // ── Media entrante: audios (Deepgram) e imagenes (Google Vision) ─────────
    const mediaType = body.MediaContentType0 ?? '';
    const mediaUrl = body.MediaUrl0 ?? '';
    let imageContext = '';

    const twilioAuthHeader =
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
        ? `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`
        : null;

    if (mediaType.startsWith('audio/') && mediaUrl && twilioAuthHeader) {
      try {
        const audioRes = await fetch(mediaUrl, { headers: { Authorization: twilioAuthHeader } });
        const transcript = await transcribeAudio(await audioRes.arrayBuffer(), mediaType);
        if (transcript) msgBody = transcript;
      } catch (err) {
        console.warn('[deepgram] Error bajando audio de Twilio:', err);
      }
    }

    if (mediaType.startsWith('image/') && mediaUrl && twilioAuthHeader) {
      try {
        const imgRes = await fetch(mediaUrl, { headers: { Authorization: twilioAuthHeader } });
        imageContext = await analyzeImage(await imgRes.arrayBuffer());
      } catch (err) {
        console.warn('[vision] Error bajando imagen de Twilio:', err);
      }
    }

    console.log('[webhook] from:', from);
    console.log('[webhook] senderNumber:', fromNumber);

    const twiml = new twilio.twiml.MessagingResponse();

    // ── Verification code flow ────────────────────────────────────────────────
    if (VERIFICATION_CODE_RE.test(msgBody)) {
      const reply = await handleVerificationCode(msgBody, fromNumber, {
        channel: 'twilio',
        whatsappNumber: fromNumber,
      });
      twiml.message(reply);
      res.type('text/xml').send(twiml.toString());
      return;
    }

    // ── Normal chat flow ──────────────────────────────────────────────────────
    try {
      const bot = await prisma.bot.findFirst({
        where: { whatsappNumber: fromNumber, isActive: true },
      });
      console.log('[webhook] bot encontrado:', bot?.id, bot?.whatsappNumber);

      if (!bot) {
        twiml.message('Este número no tiene un bot activo configurado.');
        res.type('text/xml').send(twiml.toString());
        return;
      }

      const result = await processInboundMessage({
        bot,
        clientNumber: fromNumber,
        channelId: from,
        text: msgBody,
        imageContext: imageContext || undefined,
      });

      // Los avisos del sistema se responden por TwiML, igual que siempre
      if (result.isNotice) {
        twiml.message(result.text);
        res.type('text/xml').send(twiml.toString());
        return;
      }

      // Respuesta por API directa (control total sobre multimedia); TwiML queda
      // solo como fallback si Twilio no esta configurado (dev sin credenciales)
      if (isTwilioConfigured()) {
        if (result.text) {
          try {
            await sendTextMessage(from, result.text);
            if (result.messageId) await confirmarEntrega(bot.userId);
          } catch (err) {
            if (result.messageId) await marcarNoEntregado(result.messageId);
            throw err;
          }
        }
        if (result.pendingImage) {
          try {
            await sendPendingImage(from, result.pendingImage);
          } catch (mediaErr) {
            console.error('[whatsapp] Error enviando la imagen adjunta:', mediaErr);
          }
        }
        res.type('text/xml').send('<Response></Response>');
        return;
      }

      twiml.message(result.text);
    } catch (err) {
      console.error('[whatsapp] Error en webhook:', err);
      twiml.message('Hubo un problema al procesar tu mensaje. Por favor intentá de nuevo.');
    }

    res.type('text/xml').send(twiml.toString());
  },
);

// ─── POST /bots/:botId/embedded-signup ────────────────────────────────────────
// Cierra el onboarding que el cliente empezo en el popup de Facebook Login for
// Business. El frontend manda lo que devolvio el SDK y aca se hace todo el
// trabajo servidor a servidor.
//
// El `code` dura muy poco, asi que el handler no hace nada pesado antes de
// pasarselo al servicio: valida, resuelve el bot y va derecho a Meta.
const embeddedSignupSchema = z.object({
  code: z.string().min(1),
  phoneNumberId: z.string().min(1),
  wabaId: z.string().min(1),
  businessId: z.string().optional(),
});

router.post(
  '/bots/:botId/embedded-signup',
  requireAuth,
  requireVerifiedEmail,
  checkWhatsAppAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const datos = embeddedSignupSchema.parse(req.body);
      await getOwnedBot(req.params.botId, req.user!.userId);

      const resultado = await completarOnboarding(req.params.botId, datos);

      res.json({
        data: {
          phoneNumberId: resultado.phoneNumberId,
          wabaId: resultado.wabaId,
          // El numero del cliente, para que el panel lo muestre sin recargar
          displayNumber: resultado.displayNumber,
          conectadoEn: resultado.conectadoEn.toISOString(),
          // Se devuelve para mostrarlo UNA vez: Meta lo vuelve a pedir si el
          // numero se re-registra alguna vez.
          pin: resultado.pin,
        },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
