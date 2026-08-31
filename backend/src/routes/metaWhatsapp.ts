import { Router, Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { reportarError } from '../lib/monitoring';
import { transcribeAudio, analyzeImage } from '../services/inboundMedia';
import {
  downloadMedia,
  isMetaConfigured,
  markAsReadAndTyping,
  sendPendingImage,
  sendTextMessage,
} from '../services/metaMessaging';
import {
  handleVerificationCode,
  processInboundMessage,
  VERIFICATION_CODE_RE,
} from '../services/inboundMessage';

/**
 * Router de Meta Cloud API (WhatsApp).
 *
 * Convive con el router de Twilio (routes/whatsapp.ts): ambos se montan en
 * /api/v1/whatsapp porque Meta usa la misma URL para el GET de verificacion y
 * el POST de mensajes. Este router se monta primero; el POST reconoce el
 * payload de Meta por `object` y hace next() si no lo es, dejando que el
 * webhook de Twilio lo atienda como siempre.
 *
 * La logica de negocio vive en services/inboundMessage.ts, compartida con
 * Twilio. Aca queda solo lo propio del canal: parseo, media y envio.
 */
const router = Router();

// ─── GET /webhook ─────────────────────────────────────────────────────────────
// Meta llama a esta URL al guardar el callback en el panel de la app.
// Publico: Meta no envia ninguna credencial nuestra, solo el verify token.
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Sin token configurado no se puede verificar nada: rechazar siempre.
  // Evita que un META_VERIFY_TOKEN vacio valide cualquier request.
  if (!env.META_VERIFY_TOKEN) {
    console.warn('[meta] GET /webhook rechazado: META_VERIFY_TOKEN no esta configurado');
    res.status(403).send('Forbidden');
    return;
  }

  if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN && typeof challenge === 'string') {
    console.log('[meta] Webhook verificado correctamente');
    res.status(200).type('text/plain').send(challenge);
    return;
  }

  console.warn('[meta] GET /webhook rechazado: mode o verify_token invalidos');
  res.status(403).send('Forbidden');
});

// ─── Tipos del payload entrante ───────────────────────────────────────────────

interface MetaMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  audio?: { id?: string; mime_type?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
}

interface MetaValue {
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  messages?: MetaMessage[];
  /** Acuses de sent/delivered/read: llegan al mismo webhook y se ignoran */
  statuses?: unknown[];
}

interface MetaWebhookBody {
  object?: string;
  entry?: Array<{ id?: string; changes?: Array<{ value?: MetaValue; field?: string }> }>;
}

// ─── Deduplicacion de reintentos ──────────────────────────────────────────────
// Meta reenvia el mismo wamid si no recibe el 200 a tiempo. Respondemos al
// instante, asi que esto es solo un seguro barato contra respuestas duplicadas.
// En memoria a proposito: no amerita tabla, y con una sola instancia alcanza.

const MAX_SEEN_IDS = 500;
const seenMessageIds = new Set<string>();

function alreadyProcessed(messageId: string): boolean {
  if (seenMessageIds.has(messageId)) return true;
  seenMessageIds.add(messageId);
  if (seenMessageIds.size > MAX_SEEN_IDS) {
    const oldest = seenMessageIds.values().next().value;
    if (oldest !== undefined) seenMessageIds.delete(oldest);
  }
  return false;
}

// ─── Extraccion del contenido segun el tipo ───────────────────────────────────

/**
 * Devuelve el texto del cliente y, si mando una imagen, su descripcion segun
 * Vision. `unsupported` marca los tipos que no sabemos procesar.
 */
async function extractContent(
  msg: MetaMessage,
): Promise<{ text: string; imageContext: string; unsupported: boolean }> {
  switch (msg.type) {
    case 'text':
      return { text: (msg.text?.body ?? '').trim(), imageContext: '', unsupported: false };

    case 'audio': {
      const mediaId = msg.audio?.id;
      if (!mediaId) return { text: '', imageContext: '', unsupported: true };
      try {
        const { buffer, mimeType } = await downloadMedia(mediaId);
        const transcript = await transcribeAudio(buffer, msg.audio?.mime_type ?? mimeType);
        return { text: transcript.trim(), imageContext: '', unsupported: false };
      } catch (err) {
        console.warn('[meta] Error bajando audio:', err);
        return { text: '', imageContext: '', unsupported: false };
      }
    }

    case 'image': {
      const mediaId = msg.image?.id;
      const caption = (msg.image?.caption ?? '').trim();
      if (!mediaId) return { text: caption, imageContext: '', unsupported: false };
      try {
        const { buffer } = await downloadMedia(mediaId);
        const imageContext = await analyzeImage(buffer);
        return { text: caption, imageContext, unsupported: false };
      } catch (err) {
        console.warn('[meta] Error bajando imagen:', err);
        return { text: caption, imageContext: '', unsupported: false };
      }
    }

    default:
      return { text: '', imageContext: '', unsupported: true };
  }
}

// ─── Procesamiento de un mensaje ──────────────────────────────────────────────

async function processMessage(msg: MetaMessage, phoneNumberId: string): Promise<void> {
  const fromDigits = msg.from;
  if (!fromDigits) return;

  // Meta entrega el numero sin '+'; lo normalizamos al formato que ya usa el
  // resto del sistema para que las conversaciones sean las mismas que Twilio.
  const clientNumber = `+${fromDigits.replace(/^\+/, '')}`;
  const channelId = `whatsapp:${clientNumber}`;

  // Feedback inmediato antes del trabajo pesado (bajar media, transcribir,
  // RAG, loop del agente): el cliente ve el "visto" y el "escribiendo...".
  // Se espera a proposito para que el indicador aparezca antes de arrancar;
  // la funcion nunca lanza, asi que no puede frenar el procesamiento.
  if (msg.id) await markAsReadAndTyping(phoneNumberId, msg.id);

  const { text, imageContext, unsupported } = await extractContent(msg);

  if (unsupported) {
    await sendTextMessage(phoneNumberId, clientNumber, 'Por ahora puedo leer texto, audios e imágenes. ¿Me lo escribís?');
    return;
  }

  // ── Código de verificación BF-XXXXXX ────────────────────────────────────────
  if (VERIFICATION_CODE_RE.test(text)) {
    const reply = await handleVerificationCode(text, clientNumber, {
      channel: 'meta',
      phoneNumberId,
    });
    // El codigo llega al numero de BotForge, y desde ese mismo numero se
    // responde: es el unico caso donde corresponde el numero de la plataforma.
    await sendTextMessage(phoneNumberId, clientNumber, reply);
    return;
  }

  const bot = await prisma.bot.findFirst({
    where: { metaPhoneNumberId: phoneNumberId, isActive: true },
  });
  console.log('[meta] bot encontrado:', bot?.id, 'phone_number_id:', phoneNumberId);

  if (!bot) {
    await sendTextMessage(phoneNumberId, clientNumber, 'Este número no tiene un bot activo configurado.');
    return;
  }

  // Sin texto ni imagen legible no hay nada que mandarle al agente
  if (!text && !imageContext) {
    await sendTextMessage(bot.metaPhoneNumberId ?? phoneNumberId, clientNumber, 'No pude entender ese mensaje. ¿Me lo escribís?');
    return;
  }

  const result = await processInboundMessage({
    bot,
    clientNumber,
    channelId,
    text,
    imageContext: imageContext || undefined,
  });

  // El numero del bot, no el global: es de donde el cliente espera la respuesta
  const numeroDelBot = bot.metaPhoneNumberId ?? phoneNumberId;

  if (result.text) await sendTextMessage(numeroDelBot, clientNumber, result.text);

  if (result.pendingImage) {
    try {
      await sendPendingImage(numeroDelBot, clientNumber, result.pendingImage);
    } catch (mediaErr) {
      // El texto ya salió: que falle la imagen no puede tumbar la respuesta
      reportarError('meta-envio-imagen', mediaErr, { origen: result.pendingImage.source });
    }
  }
}

/** Recorre el payload y procesa cada mensaje entrante, en orden. */
async function processWebhookBody(body: MetaWebhookBody): Promise<void> {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const messages = value?.messages ?? [];

      if (messages.length === 0) continue; // acuses de estado u otros eventos
      if (!phoneNumberId) {
        console.warn('[meta] Mensaje sin phone_number_id en metadata, se ignora');
        continue;
      }

      for (const msg of messages) {
        if (msg.id && alreadyProcessed(msg.id)) {
          console.log('[meta] Mensaje duplicado ignorado:', msg.id);
          continue;
        }
        try {
          await processMessage(msg, phoneNumberId);
        } catch (err) {
          reportarError('meta-mensaje', err, { tipo: msg.type ?? 'desconocido' });
          if (msg.from) {
            try {
              await sendTextMessage(
                phoneNumberId,
                `+${msg.from.replace(/^\+/, '')}`,
                'Hubo un problema al procesar tu mensaje. Por favor intentá de nuevo.',
              );
            } catch (sendErr) {
              reportarError('meta-envio-texto', sendErr);
            }
          }
        }
      }
    }
  }
}

// ─── POST /webhook ────────────────────────────────────────────────────────────
// Responde 200 antes de procesar: Meta reintenta si tardamos, y un reintento
// duplica el mensaje del cliente. El trabajo real corre despues, en background.
router.post('/webhook', (req: Request, res: Response, next: NextFunction) => {
  const body = req.body as MetaWebhookBody;

  // No es un payload de Meta: se lo dejamos al webhook de Twilio
  if (body?.object !== 'whatsapp_business_account') {
    next();
    return;
  }

  res.status(200).json({});

  if (!isMetaConfigured()) {
    console.warn('[meta] Mensaje entrante descartado: Meta Cloud API no está configurada');
    return;
  }

  void processWebhookBody(body).catch((err) => {
    reportarError('meta-webhook', err);
  });
});

export default router;
