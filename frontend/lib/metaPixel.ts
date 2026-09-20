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

export type EventoPixel = 'Lead' | 'InitiateCheckout' | 'Purchase';

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

/** Evento de conversion. Si no hay consentimiento no hace nada. */
export function pixelTrack(evento: EventoPixel, datos?: Record<string, unknown>): void {
  if (!asegurarPixel()) return;
  if (datos) window.fbq!('track', evento, datos);
  else window.fbq!('track', evento);
}
