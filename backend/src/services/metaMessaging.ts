/**
 * Envio y descarga de media por Meta Cloud API (WhatsApp).
 * Espeja la interfaz de twilioMessaging.ts para que el pipeline compartido
 * pueda usar cualquiera de los dos canales sin ramificar logica de negocio.
 *
 * META_WHATSAPP_TOKEN nunca se loguea: viaja solo en el header Authorization.
 */
import { env } from '../config/env';
import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary';
import type { PendingImage } from './tenantAgent';
import { authHeader, type CredencialMeta } from './metaAuth';

// Misma version que metaOnboarding.ts y que el SDK del popup. Estaban en
// v21 y v23 a la vez: dos versiones de Graph conviviendo en el mismo flujo
// es una fuente de diferencias de comportamiento imposible de diagnosticar.
const GRAPH_VERSION = 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function isMetaConfigured(): boolean {
  return Boolean(env.META_WHATSAPP_TOKEN && env.META_PHONE_NUMBER_ID);
}

function assertConfigured(): void {
  if (!isMetaConfigured()) {
    throw new Error('Meta Cloud API no está configurada (META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID)');
  }
}

/**
 * Con que credencial sale cada mensaje.
 *
 * Va como PRIMER parametro y es obligatoria a proposito. Antes estas funciones
 * leian env.META_PHONE_NUMBER_ID y env.META_WHATSAPP_TOKEN por su cuenta, asi
 * que desde el llamador era imposible notar que todo salia del mismo numero y
 * con el mismo token. Ahora el compilador obliga a decidirlo en cada envio.
 *
 * El numero y el token van atados en el mismo objeto (ver metaAuth.ts): con un
 * token por cliente, mandarlos sueltos permitiria combinar el numero de un
 * negocio con el token de otro.
 */

/** Meta espera el numero con codigo de pais y sin '+' ni prefijo de canal. */
function toMetaNumber(to: string): string {
  return to.replace('whatsapp:', '').replace(/^\+/, '');
}

/**
 * Lee el cuerpo del error de Graph sin filtrar credenciales. Meta responde
 * { error: { message, type, code } }; el token nunca viene en la respuesta.
 */
interface DetalleError {
  texto: string;
  /** Codigo de error de Graph, no el status HTTP */
  codigo: number | null;
  tipo: string | null;
}

async function describeError(res: Response): Promise<DetalleError> {
  try {
    const data = (await res.json()) as {
      error?: { message?: string; code?: number; type?: string };
    };
    const message = data.error?.message ?? 'sin detalle';
    const codigo = data.error?.code ?? null;
    return {
      texto: `${codigo ?? res.status}: ${message}`,
      codigo,
      tipo: data.error?.type ?? null,
    };
  } catch {
    return { texto: `HTTP ${res.status}`, codigo: null, tipo: null };
  }
}

/**
 * El cliente nos saco el acceso (o el token dejo de valer).
 *
 * Meta lo avisa con un OAuthException: 190 es el token invalido o revocado,
 * 102 la sesion caida, y 10 / 200 / 299 son permisos que ya no tenemos. Un 401
 * crudo cuenta igual. Importa distinguirlo de un fallo pasajero: un 500 se
 * reintenta, una credencial muerta no mejora reintentando y hay que avisarle
 * al dueño que reconecte.
 */
const CODIGOS_CREDENCIAL_MUERTA = new Set([10, 102, 190, 200, 299]);

export class ErrorEnvioMeta extends Error {
  readonly credencialInvalida: boolean;
  readonly codigo: number | null;

  constructor(mensaje: string, detalle: DetalleError | null, status: number) {
    super(mensaje);
    this.name = 'ErrorEnvioMeta';
    this.codigo = detalle?.codigo ?? null;
    this.credencialInvalida =
      status === 401 ||
      (detalle?.codigo !== null &&
        detalle?.codigo !== undefined &&
        CODIGOS_CREDENCIAL_MUERTA.has(detalle.codigo));
  }
}

/** Reintentos ante fallos pasajeros de Meta, sin contar el primer intento */
const REINTENTOS = 3;
const ESPERA_BASE_MS = 500;
const ESPERA_MAX_MS = 8000;

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 429 (rate limit) y 5xx son pasajeros: reintentar tiene sentido. Un 4xx
 * distinto es un problema del pedido o del token y no mejora reintentando.
 */
function esPasajero(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Cuanto esperar antes del proximo intento. Se respeta Retry-After si Meta lo
 * manda —en segundos o como fecha—; si no, backoff exponencial.
 */
function esperaAntesDeReintentar(res: Response, intento: number): number {
  const header = res.headers.get('retry-after');
  if (header) {
    const segundos = Number(header);
    if (Number.isFinite(segundos) && segundos >= 0) {
      return Math.min(segundos * 1000, ESPERA_MAX_MS);
    }
    const fecha = Date.parse(header);
    if (!Number.isNaN(fecha)) {
      return Math.min(Math.max(fecha - Date.now(), 0), ESPERA_MAX_MS);
    }
  }
  return Math.min(ESPERA_BASE_MS * 2 ** intento, ESPERA_MAX_MS);
}

async function postMessage(
  cred: CredencialMeta,
  payload: Record<string, unknown>,
): Promise<void> {
  assertConfigured();

  let ultimoError = '';
  let ultimoDetalle: DetalleError | null = null;
  let ultimoStatus = 0;

  for (let intento = 0; intento <= REINTENTOS; intento++) {
    let res: Response;
    try {
      res = await fetch(`${GRAPH_BASE}/${cred.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { ...authHeader(cred.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      });
    } catch (err) {
      // Fallo de red: tambien es pasajero
      ultimoError = err instanceof Error ? err.message : String(err);
      ultimoDetalle = null;
      ultimoStatus = 0;
      if (intento === REINTENTOS) break;
      await dormir(Math.min(ESPERA_BASE_MS * 2 ** intento, ESPERA_MAX_MS));
      continue;
    }

    if (res.ok) return;

    ultimoStatus = res.status;
    ultimoDetalle = await describeError(res);
    ultimoError = ultimoDetalle.texto;
    if (!esPasajero(res.status) || intento === REINTENTOS) break;

    const espera = esperaAntesDeReintentar(res, intento);
    console.warn(
      `[meta] envio fallido (${res.status}), reintento ${intento + 1}/${REINTENTOS} en ${espera}ms`,
    );
    await dormir(espera);
  }

  throw new ErrorEnvioMeta(`Meta rechazó el envío — ${ultimoError}`, ultimoDetalle, ultimoStatus);
}

export async function sendTextMessage(
  cred: CredencialMeta,
  to: string,
  body: string,
): Promise<void> {
  await postMessage(cred, {
    to: toMetaNumber(to),
    type: 'text',
    text: { body },
  });
}

/**
 * Marca el mensaje del cliente como leido y prende el indicador de
 * "escribiendo...".
 *
 * Contrato verificado contra la doc de Meta (Cloud API > typing indicators):
 * POST /{phone-number-id}/messages con status 'read', el wamid del mensaje
 * entrante y typing_indicator.type 'text'. Meta apaga el indicador cuando
 * mandamos la respuesta o a los 25 segundos, lo que pase primero.
 *
 * Es puramente cosmetico: nunca lanza ni propaga errores, para que un fallo
 * aca no impida que el cliente reciba la respuesta real.
 *
 * Loguea SIEMPRE, exito o fallo. Sin el log de exito no habria forma de
 * distinguir en Railway entre "anduvo" y "nunca se llamo".
 */
export async function markAsReadAndTyping(
  cred: CredencialMeta,
  messageId: string,
): Promise<void> {
  if (!isMetaConfigured()) {
    console.warn('[whatsapp] typing indicator omitido: Meta Cloud API no está configurada');
    return;
  }

  try {
    const res = await fetch(`${GRAPH_BASE}/${cred.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { ...authHeader(cred.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      }),
    });

    if (res.ok) {
      console.log(`[whatsapp] typing indicator enviado (wamid ${messageId})`);
      return;
    }
    console.warn(`[whatsapp] error en typing indicator: ${(await describeError(res)).texto}`);
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.warn(`[whatsapp] error en typing indicator: ${detalle}`);
  }
}

/** Envia una imagen ya hospedada en una URL publica accesible por Meta. */
export async function sendImageByUrl(
  cred: CredencialMeta,
  to: string,
  imageUrl: string,
  caption: string,
): Promise<void> {
  await postMessage(cred, {
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
  cred: CredencialMeta,
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

  await sendImageByUrl(cred, to, uploadRes.secure_url, caption);
}

/**
 * Descarga un media entrante. Meta lo entrega en dos pasos: primero se pide la
 * metadata del id (que devuelve una URL temporal) y despues se baja el binario
 * de esa URL, que tambien exige el token.
 */
export async function downloadMedia(
  mediaId: string,
  /** Solo el token: bajar un media no sale por ningun numero de negocio */
  token: string,
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  assertConfigured();

  const metaRes = await fetch(`${GRAPH_BASE}/${mediaId}`, { headers: authHeader(token) });
  if (!metaRes.ok) {
    throw new Error(`No se pudo leer el media ${mediaId} — ${(await describeError(metaRes)).texto}`);
  }

  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) {
    throw new Error(`Meta no devolvió URL de descarga para el media ${mediaId}`);
  }

  const binRes = await fetch(meta.url, { headers: authHeader(token) });
  if (!binRes.ok) {
    throw new Error(`No se pudo descargar el media ${mediaId} — HTTP ${binRes.status}`);
  }

  return {
    buffer: await binRes.arrayBuffer(),
    mimeType: meta.mime_type ?? 'application/octet-stream',
  };
}

/**
 * Entrega la imagen que dejo el agente. Es solo un despacho entre las dos
 * primitivas de arriba: las imagenes del panel ya viven en Cloudinary y van
 * por URL; las de Drive llegan como binario y hay que hospedarlas primero.
 */
export async function sendPendingImage(
  cred: CredencialMeta,
  to: string,
  img: PendingImage,
): Promise<void> {
  if (img.source === 'url') {
    await sendImageByUrl(cred, to, img.url, img.caption);
    return;
  }
  await sendImageMessage(cred, to, img.imageBase64, img.mimeType, img.caption);
}
