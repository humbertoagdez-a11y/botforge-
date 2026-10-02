/**
 * API de Conversiones de Meta: los eventos de conversion, mandados desde el
 * servidor.
 *
 * POR QUE EXISTE: la campaña web optimiza para InitiateCheckout y no habia
 * registrado una sola conversion. El pixel del navegador se pierde por
 * bloqueadores, por el navegador interno de las apps y por quien cierra la
 * pestaña antes de que cargue. El mismo evento mandado desde aca llega igual.
 *
 * LA REGLA DE CONSENTIMIENTO, que no se negocia: solo se manda si la persona
 * eligio "Aceptar" en el banner. Con "Solo las necesarias" no sale nada, ni
 * por el navegador ni por aca. Mandarlo por servidor cambia el transporte, no
 * lo que se comparte, y el banner le promete a esa persona que no se usa nada
 * para publicidad. Lo decidio el dueño el 2026-10-02.
 *
 * DEDUPLICACION: cada evento lleva el mismo event_id que el que manda el pixel
 * del navegador. Meta junta los dos y cuenta uno solo.
 *
 * Nunca lanza: una conversion que no se pudo reportar no puede romper un
 * registro ni un pago.
 */
import { createHash } from 'crypto';
import { env } from '../config/env';

const GRAPH = 'https://graph.facebook.com/v23.0';

export type EventoMeta = 'CompleteRegistration' | 'InitiateCheckout' | 'Purchase';

/** Lo que trae el navegador para atribuir, cuando hubo consentimiento. */
export interface AtribucionMeta {
  consentimiento: boolean;
  fbc?: string | null;
  fbp?: string | null;
}

export interface DatosEventoMeta {
  evento: EventoMeta;
  /** El MISMO id que uso el pixel. Sin esto Meta cuenta dos conversiones. */
  eventId: string;
  /** Pagina donde paso, para Meta */
  url: string;
  email: string;
  userId: string;
  fbc?: string | null;
  fbp?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  valor?: number;
  /** Lo que se compro o se registro, para el reporte de Meta */
  contenido?: string;
}

/**
 * SHA-256 en hexadecimal, sobre el valor normalizado como pide Meta: sin
 * espacios a los costados y en minusculas. Un email con una mayuscula de mas
 * da otro hash y Meta no lo empareja.
 */
export function hashear(valor: string): string {
  return createHash('sha256').update(valor.trim().toLowerCase()).digest('hex');
}

/**
 * fbc con el formato que exige Meta: fb.1.<milisegundos>.<fbclid>.
 * Si ya viene con ese formato (de la cookie _fbc), se respeta tal cual.
 */
export function normalizarFbc(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const v = valor.trim();
  if (/^fb\.\d\.\d+\./.test(v)) return v.slice(0, 500);
  if (/^[A-Za-z0-9_-]{10,}$/.test(v)) return `fb.1.${Date.now()}.${v}`.slice(0, 500);
  return null;
}

/** fbp valido (fb.1.<ms>.<numero>), o null. Nada mas se acepta del navegador. */
export function normalizarFbp(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const v = valor.trim();
  return /^fb\.\d\.\d+\.\d+$/.test(v) ? v.slice(0, 100) : null;
}

/** Si la API esta lista para usar. */
export function capiActiva(): boolean {
  return Boolean(env.META_CAPI_TOKEN && env.META_PIXEL_ID);
}

/**
 * Manda un evento. Devuelve true si Meta lo acepto.
 *
 * Lo que va a Meta:
 *   - email y user id: SHA-256, nunca en claro
 *   - IP y user agent: en claro, porque Meta los pide asi para emparejar
 *   - fbc / fbp: tal cual, son identificadores de Meta
 */
export async function enviarEventoMeta(d: DatosEventoMeta): Promise<boolean> {
  if (!capiActiva()) {
    console.log(`[meta-capi] apagada (falta META_CAPI_TOKEN): no se manda ${d.evento}`);
    return false;
  }

  const userData: Record<string, unknown> = {
    em: [hashear(d.email)],
    external_id: [hashear(d.userId)],
  };
  if (d.fbc) userData.fbc = d.fbc;
  if (d.fbp) userData.fbp = d.fbp;
  if (d.ip) userData.client_ip_address = d.ip;
  if (d.userAgent) userData.client_user_agent = d.userAgent;

  const evento: Record<string, unknown> = {
    event_name: d.evento,
    event_time: Math.floor(Date.now() / 1000),
    event_id: d.eventId,
    action_source: 'website',
    event_source_url: d.url,
    user_data: userData,
  };
  if (d.valor !== undefined || d.contenido) {
    evento.custom_data = {
      ...(d.valor !== undefined ? { value: d.valor, currency: 'PYG' } : {}),
      ...(d.contenido ? { content_name: d.contenido, content_ids: [d.contenido], content_type: 'product' } : {}),
    };
  }

  const cuerpo: Record<string, unknown> = { data: [evento] };
  if (env.META_CAPI_TEST_CODE) cuerpo.test_event_code = env.META_CAPI_TEST_CODE;

  try {
    const res = await fetch(`${GRAPH}/${env.META_PIXEL_ID}/events`, {
      method: 'POST',
      // El token va en el header y no en la URL: asi no queda en ningun log
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.META_CAPI_TOKEN}` },
      body: JSON.stringify(cuerpo),
    });
    const json = (await res.json().catch(() => ({}))) as {
      events_received?: number;
      fbtrace_id?: string;
      error?: { message?: string; code?: number };
    };
    if (!res.ok) {
      console.error(
        `[meta-capi] ${d.evento} rechazado (${res.status}): ${json.error?.message ?? 'sin detalle'}`,
      );
      return false;
    }
    // Sin datos personales en el log: el evento, el id y lo que contesto Meta
    console.log(
      `[meta-capi] ${d.evento} enviado · event_id ${d.eventId} · recibidos ${json.events_received ?? '?'}` +
        `${env.META_CAPI_TEST_CODE ? ' · MODO PRUEBA' : ''} · fbc ${d.fbc ? 'si' : 'no'} · fbp ${d.fbp ? 'si' : 'no'}`,
    );
    return true;
  } catch (err) {
    console.error(`[meta-capi] ${d.evento} no se pudo enviar:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * La IP real del visitante. Railway pone su proxy adelante y trust proxy esta
 * en 1, asi que req.ip ya es la del cliente; se sacan los prefijos de IPv6
 * mapeada que Meta no reconoce.
 */
export function ipDelCliente(ip: string | undefined): string | null {
  if (!ip) return null;
  return ip.replace(/^::ffff:/, '');
}
