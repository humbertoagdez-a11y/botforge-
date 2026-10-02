/**
 * Pixel de Meta Ads.
 *
 * Dos reglas gobiernan todo este archivo:
 *
 * 1. CONSENTIMIENTO. El banner ofrece "Aceptar" (todas) o "Solo necesarias".
 *    El pixel instala la cookie _fbp y manda datos a Meta, asi que solo se
 *    carga si la eleccion fue 'all'. Sin este gate el boton del banner no
 *    significaria nada, y la pagina /cookies estaria mintiendo.
 *
 * 2. EL DASHBOARD NO SE TRACKEA. El script se inyecta con autoConfig apagado,
 *    asi que no dispara PageView ni clicks automaticos por su cuenta. El
 *    PageView de las paginas publicas lo manda <MetaPixel/>; los eventos de
 *    conversion los mandan los tres puntos del funnel. En las dos pantallas
 *    privadas donde hay conversion (pricing y pago-resultado) el pixel recien
 *    se carga en el instante del evento, y no ve nada mas de la navegacion.
 */
import { useCookieConsentStore } from './store';

export const PIXEL_ID = '1988014471769093';

type FbqFn = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
  push?: unknown;
};

declare global {
  // eslint-disable-next-line no-var
  var fbq: FbqFn | undefined;
  // eslint-disable-next-line no-var
  var _fbq: FbqFn | undefined;
}

/**
 * CompleteRegistration y no Lead para la cuenta creada: es el evento estandar
 * de Meta para eso, y el que se puede usar para optimizar una campaña. Lead
 * nunca llego a dispararse en produccion (0 eventos), asi que no hay historia
 * que se corte.
 */
export type EventoPixel = 'CompleteRegistration' | 'InitiateCheckout' | 'Purchase';

function hayConsentimiento(): boolean {
  return useCookieConsentStore.getState().choice === 'all';
}

let iniciado = false;

/**
 * Inyecta fbevents.js e inicializa el pixel, una sola vez por sesion de
 * navegador. Devuelve false si no hay consentimiento, y en ese caso no se
 * carga absolutamente nada.
 */
function asegurarPixel(): boolean {
  if (typeof window === 'undefined') return false;
  if (!hayConsentimiento()) return false;
  if (iniciado) return true;

  if (!window.fbq) {
    const fbq: FbqFn = function (...args: unknown[]): void {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue!.push(args);
    };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.push = fbq;
    window.fbq = fbq;
    window._fbq = fbq;

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }

  // Sin esto Meta manda PageView solo en cada carga, que es justo lo que no
  // queremos dentro del dashboard.
  window.fbq!('set', 'autoConfig', false, PIXEL_ID);
  window.fbq!('init', PIXEL_ID);
  iniciado = true;
  return true;
}

/** PageView explicito. Lo llama <MetaPixel/>, solo en rutas publicas. */
export function pixelPageView(): void {
  if (!asegurarPixel()) return;
  window.fbq!('track', 'PageView');
}

/**
 * Evento de conversion. Si no hay consentimiento no hace nada.
 *
 * `eventID` es la clave de deduplicacion de Meta: dos eventos con el mismo id
 * se cuentan una sola vez. Es lo que evita que recargar la pantalla de pago
 * infle los ingresos reportados.
 */
export function pixelTrack(
  evento: EventoPixel,
  datos?: Record<string, unknown>,
  eventID?: string,
): void {
  if (!asegurarPixel()) return;
  const opciones = eventID ? { eventID } : undefined;
  if (datos) window.fbq!('track', evento, datos, opciones);
  else window.fbq!('track', evento, undefined, opciones);
}

/**
 * Para cuando despues del evento la pagina se va (el checkout de Pagopar).
 *
 * pixelTrack solo encola: si fbevents.js todavia no termino de bajar y la
 * pagina navega, el evento se pierde. Pasaba siempre con InitiateCheckout,
 * porque /pricing no carga el pixel antes (prueba del 2026-10-02: el navegador
 * nunca lo mando). Espera a que el script este listo y un margen para que
 * salga el pedido, con tope. Sin consentimiento vuelve en el acto.
 */
export async function pixelTrackAntesDeSalir(
  evento: EventoPixel,
  datos: Record<string, unknown>,
  eventID: string,
  topeMs = 1500,
): Promise<void> {
  if (!asegurarPixel()) return;
  pixelTrack(evento, datos, eventID);
  const inicio = Date.now();
  while (!window.fbq?.callMethod && Date.now() - inicio < topeMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 300));
}

/**
 * Marca en localStorage que un evento unico ya se mando, y devuelve false si
 * ya estaba marcado. Segunda capa sobre el eventID: evita incluso emitir el
 * pedido a Meta. Si localStorage esta bloqueado devuelve true y queda solo la
 * deduplicacion del lado de Meta, que igual alcanza.
 */
export function marcarEventoUnico(clave: string): boolean {
  // Sin consentimiento no se escribe nada: la marca existe solo para no mandar
  // a Meta dos veces el mismo evento, y sin consentimiento no se manda ninguno.
  // Antes escribia igual, o sea guardaba en el navegador algo de publicidad de
  // quien habia elegido "Solo las necesarias".
  if (!hayConsentimiento()) return true;
  try {
    const k = `bf_pixel_${clave}`;
    if (localStorage.getItem(k)) return false;
    localStorage.setItem(k, new Date().toISOString());
    return true;
  } catch {
    return true;
  }
}
