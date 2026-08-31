/**
 * Perfil de negocio de WhatsApp por Meta Cloud API.
 * Hermano de metaMessaging.ts: mismas convenciones (GRAPH_BASE, authHeader,
 * describeError) para que el manejo de errores de Graph sea uno solo.
 *
 * DIFERENCIA IMPORTANTE con metaMessaging.ts: alli el phone-number-id sale de
 * env.META_PHONE_NUMBER_ID, que es global. Aca NO: cada bot tiene su propio
 * numero conectado (Bot.metaPhoneNumberId) y todas estas funciones lo reciben
 * por parametro. Usar la variable global escribiria el perfil del numero
 * equivocado.
 *
 * META_WHATSAPP_TOKEN nunca se loguea: viaja solo en el header Authorization.
 */
import { env } from '../config/env';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Los 7 campos que devuelve Meta. Todos pueden venir ausentes si no se setearon. */
export interface BusinessProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
}

/** Lo que se puede escribir. profile_picture_handle va aparte, no en el PATCH. */
export type BusinessProfileUpdate = Partial<{
  about: string;
  address: string;
  description: string;
  email: string;
  websites: string[];
  vertical: string;
  profile_picture_handle: string;
}>;

/** Enum cerrado de Meta. Fuente de verdad tambien para la validacion con zod. */
export const VERTICALES = [
  'OTHER', 'AUTO', 'BEAUTY', 'APPAREL', 'EDU', 'ENTERTAIN', 'EVENT_PLAN',
  'FINANCE', 'GROCERY', 'GOVT', 'HOTEL', 'HEALTH', 'NONPROFIT',
  'PROF_SERVICES', 'RETAIL', 'TRAVEL', 'RESTAURANT', 'ALCOHOL',
  'ONLINE_GAMBLING', 'PHYSICAL_GAMBLING', 'OTC_DRUGS',
] as const;

export type Vertical = (typeof VERTICALES)[number];

const CAMPOS = 'about,address,description,email,profile_picture_url,websites,vertical';

function authHeader(): { Authorization: string } {
  return { Authorization: `Bearer ${env.META_WHATSAPP_TOKEN}` };
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

/** Lee los 7 campos del perfil del numero de ESE bot. */
export async function getBusinessProfile(phoneNumberId: string): Promise<BusinessProfile> {
  const res = await fetch(
    `${GRAPH_BASE}/${phoneNumberId}/whatsapp_business_profile?fields=${CAMPOS}`,
    { headers: authHeader() },
  );

  if (!res.ok) {
    throw new Error(`No se pudo leer el perfil de WhatsApp — ${await describeError(res)}`);
  }

  // Meta devuelve { data: [ {...} ] }, con un solo elemento
  const body = (await res.json()) as { data?: BusinessProfile[] };
  return body.data?.[0] ?? {};
}

/**
 * Escribe SOLO los campos presentes en `data`. Los ausentes no se mandan, asi
 * que Meta los deja como estaban: no hay forma de pisar sin querer un campo
 * que el usuario no toco.
 */
export async function updateBusinessProfile(
  phoneNumberId: string,
  data: BusinessProfileUpdate,
): Promise<void> {
  const payload: Record<string, unknown> = { messaging_product: 'whatsapp' };
  for (const [clave, valor] of Object.entries(data)) {
    if (valor !== undefined) payload[clave] = valor;
  }

  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/whatsapp_business_profile`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Meta rechazó la actualización del perfil — ${await describeError(res)}`);
  }
}

/**
 * Sube la foto por la Resumable Upload API y devuelve el handle que espera
 * profile_picture_handle. Son tres pasos y cada uno puede fallar por motivos
 * distintos, asi que el error dice SIEMPRE en cual se cayo.
 *
 * El buffer que llega ya tiene que venir normalizado (cuadrado, 640x640,
 * JPEG/PNG): esta funcion no valida ni procesa la imagen, de eso se encarga
 * la ruta antes de llamar aca.
 */
export async function uploadProfilePicture(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (!env.META_APP_ID) {
    throw new Error('Falta configurar META_APP_ID para poder cambiar la foto de perfil');
  }

  // Paso 1: abrir la sesion de subida
  let sessionId: string;
  try {
    const res = await fetch(
      `${GRAPH_BASE}/${env.META_APP_ID}/uploads?file_length=${fileBuffer.length}&file_type=${encodeURIComponent(mimeType)}`,
      { method: 'POST', headers: authHeader() },
    );
    if (!res.ok) {
      throw new Error(await describeError(res));
    }
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new Error('Meta no devolvió el id de la sesión de subida');
    sessionId = body.id;
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    throw new Error(`Falló el paso 1 de la subida de la foto (abrir sesión) — ${detalle}`);
  }

  // Paso 2: mandar los bytes y recibir el handle
  let handle: string;
  try {
    const res = await fetch(`${GRAPH_BASE}/${sessionId}`, {
      method: 'POST',
      headers: { ...authHeader(), file_offset: '0', 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(fileBuffer),
    });
    if (!res.ok) {
      throw new Error(await describeError(res));
    }
    const body = (await res.json()) as { h?: string };
    if (!body.h) throw new Error('Meta no devolvió el handle del archivo');
    handle = body.h;
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    throw new Error(`Falló el paso 2 de la subida de la foto (enviar bytes) — ${detalle}`);
  }

  return handle;
}

/**
 * Paso 3: asocia un handle ya subido al perfil. Se deja aparte de
 * updateBusinessProfile para que el error diga que fallo el paso 3 y no una
 * actualizacion generica del perfil.
 */
export async function setProfilePictureHandle(
  phoneNumberId: string,
  handle: string,
): Promise<void> {
  try {
    await updateBusinessProfile(phoneNumberId, { profile_picture_handle: handle });
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    throw new Error(`Falló el paso 3 de la subida de la foto (asociarla al perfil) — ${detalle}`);
  }
}
