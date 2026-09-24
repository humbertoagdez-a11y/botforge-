/**
 * Onboarding de un numero de WhatsApp de un cliente via Embedded Signup.
 *
 * El cliente completa el popup de Facebook Login for Business en el navegador y
 * Meta devuelve un `code` de vida muy corta junto con los ids de sus activos.
 * Aca se cambia ese code por un business token scopeado a SU negocio y se deja
 * el numero listo para recibir y enviar.
 *
 * El ORDEN de las tres llamadas importa y esta invertido respecto de lo que
 * parecia natural: primero se suscriben los webhooks y recien despues se
 * registra el numero. Al reves, entre el registro y la suscripcion habria una
 * ventana en la que el numero ya recibe mensajes y nadie los escucha.
 *
 * Ningun token se loguea: viajan solo en el header Authorization.
 */
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { ESTADO_ACTIVO } from './metaAuth';
import { cifrar } from '../lib/cifrado';

const GRAPH_VERSION = 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const ESTADO_ERROR = 'ERROR';
export const ESTADO_REVOCADO = 'REVOCADO';

/** Etapa donde se cayo el onboarding. Viaja al frontend para poder reintentar. */
export type EtapaOnboarding = 'previo' | 'exchange' | 'subscribe' | 'register';

export interface DatosSignup {
  code: string;
  phoneNumberId: string;
  wabaId: string;
  businessId?: string;
}

export interface ResultadoOnboarding {
  phoneNumberId: string;
  wabaId: string;
  /** Numero legible del cliente. null si Meta no lo devolvio. */
  displayNumber: string | null;
  /** Se muestra UNA vez al dueño: Meta lo pide si alguna vez re-registra */
  pin: string;
  conectadoEn: Date;
}

/** Lee el error de Graph sin filtrar credenciales. */
async function describeError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string; code?: number } };
    return `${data.error?.code ?? res.status}: ${data.error?.message ?? 'sin detalle'}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function assertConfigurado(): void {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new AppError(
      503,
      'La conexión con Meta no está disponible en este momento',
      'META_NO_CONFIGURADO',
    );
  }
}

/**
 * El cliente nos saco el acceso: se deja anotado para que el panel pueda
 * pedirle que reconecte en vez de mostrarle un WhatsApp "conectado" que no
 * responde.
 *
 * El token se borra: ya no sirve para nada y no hay motivo para seguir
 * guardando una credencial de un tercero. El phoneNumberId se conserva a
 * proposito, asi el webhook sigue reconociendo el numero si el cliente vuelve.
 *
 * Nunca lanza: se llama desde el camino de error de un envio, y no puede
 * tapar el error original.
 */
export async function marcarRevocado(botId: string, motivo: string): Promise<void> {
  try {
    await prisma.bot.update({
      where: { id: botId },
      data: { metaEstado: ESTADO_REVOCADO, metaBusinessToken: null },
    });
    console.warn(`[meta] bot ${botId} marcado como REVOCADO — ${motivo}`);
  } catch (err) {
    console.error(`[meta] no se pudo marcar el bot ${botId} como revocado:`, err);
  }
}

/** PIN de verificacion en dos pasos. Seis digitos, incluidos los ceros a la izquierda. */
export function generarPin(): string {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

/**
 * Cambia el code del SDK por un business token del cliente.
 *
 * Las credenciales van en la query porque asi lo define el endpoint de OAuth:
 * no lleva header Authorization. El code dura muy poco, asi que esta llamada
 * tiene que salir en el mismo request que lo recibe, sin trabajo previo.
 */
export async function intercambiarCode(code: string): Promise<string> {
  assertConfigurado();

  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set('client_id', env.META_APP_ID);
  url.searchParams.set('client_secret', env.META_APP_SECRET);
  url.searchParams.set('code', code);

  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new AppError(
      400,
      'El código de conexión venció o no es válido. Volvé a iniciar la conexión.',
      'META_CODE_INVALIDO',
      { etapa: 'exchange', detalle: await describeError(res) },
    );
  }

  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new AppError(502, 'Meta no devolvió un token de acceso', 'META_SIN_TOKEN', {
      etapa: 'exchange',
    });
  }
  return body.access_token;
}

/**
 * Suscribe la app a los webhooks de la WABA del cliente.
 *
 * Es idempotente: volver a llamarla sobre una WABA ya suscrita no rompe nada,
 * que es lo que permite reintentar un onboarding que quedo a medias.
 */
export async function suscribirWebhooks(wabaId: string, businessToken: string): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${businessToken}` },
  });
  if (!res.ok) {
    throw new AppError(
      502,
      'No se pudieron activar las notificaciones de WhatsApp para esa cuenta',
      'META_SUBSCRIBE_FALLO',
      { etapa: 'subscribe', detalle: await describeError(res) },
    );
  }
}

/**
 * Trae el numero legible (+595...) del phone_number_id.
 *
 * Nunca lanza: es informativo. Si falla, el bot queda conectado igual y el
 * panel cae al numero de la plataforma, que es lo que mostraba antes.
 */
export async function traerNumeroLegible(
  phoneNumberId: string,
  businessToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}?fields=display_phone_number`, {
      headers: { Authorization: `Bearer ${businessToken}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { display_phone_number?: string };
    return body.display_phone_number ?? null;
  } catch {
    return null;
  }
}

/** Registra el numero para Cloud API y le fija el PIN de verificacion en dos pasos. */
export async function registrarNumero(
  phoneNumberId: string,
  businessToken: string,
  pin: string,
): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/register`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${businessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  });
  if (!res.ok) {
    throw new AppError(
      502,
      'No se pudo registrar el número en WhatsApp Cloud API',
      'META_REGISTER_FALLO',
      { etapa: 'register', detalle: await describeError(res) },
    );
  }
}

/**
 * Orquesta el onboarding completo.
 *
 * La regla de oro del manejo de errores: NO dejar el numero registrado si los
 * webhooks no quedaron suscritos. Preferimos un onboarding incompleto y
 * reintentable antes que un numero recibiendo mensajes que nadie escucha.
 */
export async function completarOnboarding(
  botId: string,
  datos: DatosSignup,
): Promise<ResultadoOnboarding> {
  assertConfigurado();

  // Antes de gastar el code: el numero no puede estar tomado por otro bot.
  // metaPhoneNumberId es @unique, asi que sin este chequeo el onboarding
  // avanzaria contra Meta y recien reventaria al guardar.
  const tomado = await prisma.bot.findUnique({
    where: { metaPhoneNumberId: datos.phoneNumberId },
    select: { id: true },
  });
  if (tomado && tomado.id !== botId) {
    throw new AppError(
      409,
      'Ese número de WhatsApp ya está conectado a otro bot',
      'META_NUMERO_TOMADO',
      { etapa: 'previo' },
    );
  }

  // 1. Code -> business token. Si falla no se guarda nada: sin token no hay
  //    nada que reintentar, el cliente tiene que volver a pasar por el popup.
  const businessToken = await intercambiarCode(datos.code);

  const base = {
    metaWabaId: datos.wabaId,
    metaBusinessId: datos.businessId ?? null,
    // Cifrado en reposo si TOKEN_ENCRYPTION_KEY esta cargada. Sin la
    // variable devuelve el mismo string, o sea el comportamiento de hoy.
    metaBusinessToken: cifrar(businessToken),
  };

  // 2. Webhooks primero.
  try {
    await suscribirWebhooks(datos.wabaId, businessToken);
  } catch (err) {
    // Se guarda el token para poder reintentar sin pedirle otro code al
    // cliente, pero el numero NO se toca: queda sin registrar a proposito.
    await prisma.bot.update({
      where: { id: botId },
      data: { ...base, metaEstado: ESTADO_ERROR },
    });
    throw err;
  }

  // 3. Recien ahora el numero.
  const pin = generarPin();
  try {
    await registrarNumero(datos.phoneNumberId, businessToken, pin);
  } catch (err) {
    await prisma.bot.update({
      where: { id: botId },
      data: { ...base, metaEstado: ESTADO_ERROR },
    });
    throw err;
  }

  const conectadoEn = new Date();
  const displayNumber = await traerNumeroLegible(datos.phoneNumberId, businessToken);

  await prisma.bot.update({
    where: { id: botId },
    data: {
      ...base,
      metaPhoneNumberId: datos.phoneNumberId,
      metaDisplayNumber: displayNumber,
      metaRegistrationPin: cifrar(pin),
      metaConectadoEn: conectadoEn,
      metaEstado: ESTADO_ACTIVO,
    },
  });

  console.log(`[meta-onboarding] bot ${botId} conectado — waba ${datos.wabaId}`);
  return { phoneNumberId: datos.phoneNumberId, wabaId: datos.wabaId, displayNumber, pin, conectadoEn };
}
