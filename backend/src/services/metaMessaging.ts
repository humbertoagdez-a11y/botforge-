/**
 * Envio y descarga de media por Meta Cloud API (WhatsApp).
 * Espeja la interfaz de twilioMessaging.ts para que el pipeline compartido
 * pueda usar cualquiera de los dos canales sin ramificar logica de negocio.
 *
 * META_WHATSAPP_TOKEN nunca se loguea: viaja solo en el header Authorization.
 */
import { env } from '../config/env';
import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function isMetaConfigured(): boolean {
  return Boolean(env.META_WHATSAPP_TOKEN && env.META_PHONE_NUMBER_ID);
}

function assertConfigured(): void {
  if (!isMetaConfigured()) {
    throw new Error('Meta Cloud API no está configurada (META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID)');
  }
}

function authHeader(): { Authorization: string } {
  return { Authorization: `Bearer ${env.META_WHATSAPP_TOKEN}` };
}

/** Meta espera el numero con codigo de pais y sin '+' ni prefijo de canal. */
function toMetaNumber(to: string): string {
  return to.replace('whatsapp:', '').replace(/^\+/, '');
}

/**
 * Lee el cuerpo del error de Graph sin filtrar credenciales. Meta responde
 * { error: { message, type, code } }; el token nunca viene en la respuesta.
 */
async function describeError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string; code?: number } };
    const message = data.error?.message ?? 'sin detalle';
    const code = data.error?.code ?? res.status;
    return `${code}: ${message}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function postMessage(payload: Record<string, unknown>): Promise<void> {
  assertConfigured();

  const res = await fetch(`${GRAPH_BASE}/${env.META_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });

  if (!res.ok) {
    throw new Error(`Meta rechazó el envío — ${await describeError(res)}`);
  }
}

export async function sendTextMessage(to: string, body: string): Promise<void> {
  await postMessage({
    to: toMetaNumber(to),
    type: 'text',
    text: { body },
  });
}

/** Envia una imagen ya hospedada en una URL publica accesible por Meta. */
export async function sendImageByUrl(to: string, imageUrl: string, caption: string): Promise<void> {
  await postMessage({
    to: toMetaNumber(to),
    type: 'image',
    image: { link: imageUrl, caption },
  });
}

/**
 * Sube la imagen a Cloudinary (Meta necesita una URL publica) y la manda con
 * caption. Misma firma que twilioMessaging.sendImageMessage para que el
 * pipeline compartido no distinga canales. Los archivos quedan tageados
 * whatsapp_temp para poder limpiarlos en lote desde Cloudinary.
 */
export async function sendImageMessage(
  to: string,
  imageBase64: string,
  mimeType: string,
  caption: string,
): Promise<void> {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary no está configurado (necesario para hospedar la imagen)');
  }

  const uploadRes = await cloudinary.uploader.upload(
    `data:${mimeType};base64,${imageBase64}`,
    {
      folder: 'botforge/whatsapp-media',
      resource_type: 'image',
      tags: ['whatsapp_temp'],
    },
  );

  await sendImageByUrl(to, uploadRes.secure_url, caption);
}

/**
 * Descarga un media entrante. Meta lo entrega en dos pasos: primero se pide la
 * metadata del id (que devuelve una URL temporal) y despues se baja el binario
 * de esa URL, que tambien exige el token.
 */
export async function downloadMedia(
  mediaId: string,
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  assertConfigured();

  const metaRes = await fetch(`${GRAPH_BASE}/${mediaId}`, { headers: authHeader() });
  if (!metaRes.ok) {
    throw new Error(`No se pudo leer el media ${mediaId} — ${await describeError(metaRes)}`);
  }

  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) {
    throw new Error(`Meta no devolvió URL de descarga para el media ${mediaId}`);
  }

  const binRes = await fetch(meta.url, { headers: authHeader() });
  if (!binRes.ok) {
    throw new Error(`No se pudo descargar el media ${mediaId} — HTTP ${binRes.status}`);
  }

  return {
    buffer: await binRes.arrayBuffer(),
    mimeType: meta.mime_type ?? 'application/octet-stream',
  };
}
