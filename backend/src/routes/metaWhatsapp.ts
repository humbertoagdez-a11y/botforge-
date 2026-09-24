import { createHmac, timingSafeEqual } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { reportarError } from '../lib/monitoring';
import { transcribeAudio, analyzeImage } from '../services/inboundMedia';
import { credencialDeBot, credencialGlobal } from '../services/metaAuth';
import {
  downloadMedia,
  ErrorEnvioMeta,
  isMetaConfigured,
  markAsReadAndTyping,
  sendPendingImage,
  sendTextMessage,
} from '../services/metaMessaging';
import { marcarRevocado } from '../services/metaOnboarding';
import {
  confirmarEntrega,
  handleVerificationCode,
  marcarNoEntregado,
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
/**
 * El media pertenece a la WABA que recibio el mensaje, asi que se baja con el
 * token de ESE bot. Por eso el bot se resuelve antes de llamar aca: con un
 * token por cliente, el global no tiene acceso al media de una WABA ajena.
 */
async function extractContent(
  msg: MetaMessage,
  token: string,
): Promise<{ text: string; imageContext: string; unsupported: boolean }> {
  switch (msg.type) {
    case 'text':
      return { text: (msg.text?.body ?? '').trim(), imageContext: '', unsupported: false };

    case 'audio': {
      const mediaId = msg.audio?.id;
      if (!mediaId) return { text: '', imageContext: '', unsupported: true };
      try {
        const { buffer, mimeType } = await downloadMedia(mediaId, token);
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
        const { buffer } = await downloadMedia(mediaId, token);
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

  // El bot se resuelve ANTES que nada: solo hace falta el phone_number_id, y su
  // token es el que corresponde para el typing indicator y para bajar el media.
  // Puede ser null (numero sin bot, o codigo de verificacion entrando por el
  // numero de BotForge); ahi se usa la credencial global, como siempre.
  // El bot se busca SIN filtrar por isActive: si esta pausado igual es suyo el
  // numero, y contestarle al cliente con la credencial global fallaria — el
  // token global no tiene permiso sobre la WABA de otro negocio. Antes un bot
  // pausado conectado por Embedded Signup dejaba al cliente sin ninguna
  // respuesta, ni siquiera el aviso.
  const bot = await prisma.bot.findFirst({ where: { metaPhoneNumberId: phoneNumberId } });
  console.log('[meta] bot encontrado:', bot?.id, 'activo:', bot?.isActive, 'phone_number_id:', phoneNumberId);

  const credEntrante = bot ? credencialDeBot(bot) : credencialGlobal(phoneNumberId);

  // Feedback inmediato antes del trabajo pesado (bajar media, transcribir,
  // RAG, loop del agente): el cliente ve el "visto" y el "escribiendo...".
  // Se espera a proposito para que el indicador aparezca antes de arrancar;
  // la funcion nunca lanza, asi que no puede frenar el procesamiento.
  if (msg.id) await markAsReadAndTyping(credEntrante, msg.id);

  const { text, imageContext, unsupported } = await extractContent(msg, credEntrante.token);

  if (unsupported) {
    await sendTextMessage(credEntrante, clientNumber, 'Por ahora puedo leer texto, audios e imágenes. ¿Me lo escribís?');
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
    await sendTextMessage(credencialGlobal(phoneNumberId), clientNumber, reply);
    return;
  }

  if (!bot) {
    await sendTextMessage(credEntrante, clientNumber, 'Este número no tiene un bot activo configurado.');
    return;
  }

  if (!bot.isActive) {
    await sendTextMessage(
      credEntrante,
      clientNumber,
      'Este WhatsApp está pausado en este momento. Volvé a escribir más tarde.',
    );
    return;
  }

  // Sin texto ni imagen legible no hay nada que mandarle al agente
  if (!text && !imageContext) {
    await sendTextMessage(credencialDeBot(bot), clientNumber, 'No pude entender ese mensaje. ¿Me lo escribís?');
    return;
  }

  const result = await processInboundMessage({
    bot,
    clientNumber,
    channelId,
    text,
    imageContext: imageContext || undefined,
  });

  // La credencial del bot, no la global: el cliente espera la respuesta desde
  // el numero del bot, y en la Sesion 2 ademas ira firmada con SU token
  const credBot = credencialDeBot(bot);

  if (result.text) {
    try {
      await sendTextMessage(credBot, clientNumber, result.text);
      // Salio de verdad: recien ahora se cobra el cupo
      if (result.messageId) await confirmarEntrega(bot.userId);
    } catch (err) {
      // Ya se reintento dentro de sendTextMessage. No se cobra el cupo y queda
      // marcado, para que el dueño no vea una respuesta fantasma en el panel.
      if (result.messageId) await marcarNoEntregado(result.messageId);
      await revisarSiRevocaron(bot, err);
      throw err;
    }
  }

  if (result.pendingImage) {
    try {
      await sendPendingImage(credBot, clientNumber, result.pendingImage);
    } catch (mediaErr) {
      // El texto ya salió: que falle la imagen no puede tumbar la respuesta
      reportarError('meta-envio-imagen', mediaErr, { origen: result.pendingImage.source });
    }
  }
}

/** Recorre el payload y procesa cada mensaje entrante, en orden. */
/**
 * Si el envio fallo porque el cliente nos saco el acceso, se deja anotado.
 *
 * Solo aplica a los bots con token propio (Embedded Signup): si el token es el
 * global, un 190 es un problema nuestro, no del cliente, y marcarle el bot
 * como revocado seria mentirle.
 */
async function revisarSiRevocaron(
  bot: { id: string; metaBusinessToken: string | null },
  err: unknown,
): Promise<void> {
  if (!(err instanceof ErrorEnvioMeta) || !err.credencialInvalida) return;
  if (!bot.metaBusinessToken) return;
  await marcarRevocado(bot.id, `envio rechazado con codigo ${err.codigo ?? 'sin codigo'}`);
}

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
              // La credencial del BOT, no la global: si el numero es de un
              // cliente (Embedded Signup), el token global no tiene permiso
              // sobre su WABA y este aviso nunca llegaba a destino.
              const dueño = await prisma.bot.findFirst({ where: { metaPhoneNumberId: phoneNumberId } });
              const cred = dueño ? credencialDeBot(dueño) : credencialGlobal(phoneNumberId);
              await sendTextMessage(
                cred,
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
/**
 * Verifica que la notificacion venga de Meta.
 *
 * Meta firma cada POST con HMAC-SHA256(app_secret, cuerpo crudo) y lo manda en
 * X-Hub-Signature-256. Se compara con timingSafeEqual, nunca con ===: comparar
 * strings corta en el primer byte distinto y filtra, por tiempo de respuesta,
 * cuanto prefijo se acerto.
 *
 * Devuelve 'sin-secreto' cuando META_APP_SECRET no esta configurado. En ese
 * caso NO se rechaza nada: apagar el webhook de golpe dejaria a todos los bots
 * sin responder. Queda avisado en el log hasta que se cargue el secreto.
 */
type ResultadoFirma = 'valida' | 'invalida' | 'sin-secreto';

function verificarFirmaMeta(req: Request): ResultadoFirma {
  if (!env.META_APP_SECRET) return 'sin-secreto';

  const header = req.get('x-hub-signature-256');
  if (!header?.startsWith('sha256=')) return 'invalida';

  const recibida = Buffer.from(header.slice('sha256='.length), 'hex');
  // Sin cuerpo crudo no hay nada que verificar: se rechaza en vez de confiar
  if (!req.rawBody) return 'invalida';

  const esperada = createHmac('sha256', env.META_APP_SECRET).update(req.rawBody).digest();

  // timingSafeEqual exige mismo largo; distinto largo ya es firma invalida
  if (recibida.length !== esperada.length) return 'invalida';
  return timingSafeEqual(recibida, esperada) ? 'valida' : 'invalida';
}

router.post('/webhook', (req: Request, res: Response, next: NextFunction) => {
  const body = req.body as MetaWebhookBody;

  // No es un payload de Meta: se lo dejamos al webhook de Twilio. Va ANTES de
  // verificar la firma a proposito: Twilio firma distinto y no tiene por que
  // pasar por este control.
  if (body?.object !== 'whatsapp_business_account') {
    next();
    return;
  }

  const firma = verificarFirmaMeta(req);
  if (firma === 'invalida') {
    console.warn('[meta] Notificacion rechazada: firma X-Hub-Signature-256 invalida o ausente');
    res.status(403).send('Forbidden');
    return;
  }
  if (firma === 'sin-secreto') {
    console.warn(
      '[meta] OJO: META_APP_SECRET no esta configurado, el webhook acepta cualquier POST. ' +
        'Cargar la variable en Railway para activar la verificacion de firma.',
    );
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
