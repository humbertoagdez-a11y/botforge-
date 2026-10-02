/**
 * De que anuncio de Meta vino la persona, para atribuirle la conversion aunque
 * pase dias despues.
 *
 * LA REGLA: nada se escribe en el navegador ni sale hacia el servidor sin que
 * la persona haya tocado "Aceptar" en el banner.
 *
 * El problema que eso trae: el fbclid llega en la URL ANTES de que la persona
 * elija. Si se guardara en una cookie o en localStorage para no perderlo, ya
 * se estaria guardando algo de publicidad sin consentimiento. Por eso vive
 * solo en MEMORIA (una variable de este modulo), que no es almacenamiento en
 * el dispositivo y muere al cerrar la pestaña. Recien si la persona acepta se
 * escribe la cookie _fbc, que es la que usa Meta.
 *
 * Next navega del lado del cliente, asi que la memoria sobrevive de la portada
 * al registro: alcanza para el caso normal de alguien que llega del anuncio,
 * acepta y se registra.
 */
import { useCookieConsentStore } from './store';

/** El fbclid de la URL de llegada, solo en memoria. */
let fbclidEnMemoria: string | null = null;

const DIAS_FBC = 90;

function leerCookie(nombre: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${nombre}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Lee el fbclid de la URL de llegada. Lo llama <CapturaAtribucion/> una vez,
 * al montar. No escribe nada en ningun lado.
 */
export function capturarFbclid(): void {
  if (typeof window === 'undefined' || fbclidEnMemoria) return;
  try {
    const f = new URLSearchParams(window.location.search).get('fbclid');
    if (f && /^[A-Za-z0-9_-]{10,500}$/.test(f)) fbclidEnMemoria = f;
  } catch {
    // URL rara: sin atribucion, nada mas
  }
}

/**
 * Escribe _fbc con el formato de Meta (fb.1.<ms>.<fbclid>). Solo se llama con
 * consentimiento. Si la cookie ya existe —porque el pixel la creo al cargar con
 * el fbclid en la URL— no se toca: pisarla cambiaria la fecha del click.
 */
export function persistirFbc(): void {
  if (typeof document === 'undefined' || !fbclidEnMemoria || leerCookie('_fbc')) return;
  const valor = `fb.1.${Date.now()}.${fbclidEnMemoria}`;
  const vence = new Date(Date.now() + DIAS_FBC * 86400000).toUTCString();
  document.cookie = `_fbc=${encodeURIComponent(valor)}; expires=${vence}; path=/; SameSite=Lax; Secure`;
}

export interface DatosMeta {
  consentimiento: boolean;
  eventId?: string;
  fbc?: string;
  fbp?: string;
}

/**
 * Lo que se le manda al backend junto con un registro o un checkout.
 *
 * Sin consentimiento va SOLO { consentimiento: false }: ni el fbclid, ni las
 * cookies, ni el id del evento. El backend tampoco manda nada a Meta.
 */
export function datosMeta(eventId?: string): DatosMeta {
  if (useCookieConsentStore.getState().choice !== 'all') return { consentimiento: false };
  persistirFbc();
  const fbc = leerCookie('_fbc') ?? (fbclidEnMemoria ? `fb.1.${Date.now()}.${fbclidEnMemoria}` : null);
  const fbp = leerCookie('_fbp');
  return {
    consentimiento: true,
    ...(eventId ? { eventId } : {}),
    ...(fbc ? { fbc } : {}),
    ...(fbp ? { fbp } : {}),
  };
}

/** Un id para deduplicar el evento entre el pixel y el servidor. */
export function nuevoEventId(prefijo: string): string {
  const aleatorio =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefijo}_${aleatorio}`;
}
