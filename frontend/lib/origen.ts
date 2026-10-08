/**
 * De donde llego la visita, para el embudo por origen.
 *
 * Independiente del pixel y del banner de cookies: no escribe NADA en el
 * navegador (ni cookie ni localStorage ni sessionStorage) y no manda nada a
 * Meta ni a terceros. Lee la URL de llegada una vez, la reduce a etiquetas
 * cortas y las guarda en memoria de la pagina; al navegar dentro del sitio
 * la memoria sigue, al cerrar la pestaña se pierde.
 *
 * Del fbclid se usa solo el hecho de que existe (si/no). El valor no se lee.
 * Al backend van solo la etiqueta de origen, la campaña y el anuncio; a la
 * cuenta, solo la etiqueta.
 */

export type Origen = 'meta-anuncio-web' | 'meta-anuncio-whatsapp' | 'directo' | 'otro';

export interface DatosOrigen {
  origen: Origen;
  campana?: string;
  anuncio?: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const PAGINAS_DE_ENTRADA = ['/', '/planes', '/auth/register'];
const FUENTES_META = ['meta', 'facebook', 'fb', 'instagram', 'ig'];

let enMemoria: DatosOrigen | null = null;
let visitaContada = false;

/**
 * Id de campaña de Meta tal como lo escribe {{campaign.id}} en los parametros
 * de URL: solo digitos, 15 a 20 (hoy 18, ej. 120260357049340456). Se reconoce
 * por la forma y no por un id fijo, para que sirva con campañas nuevas.
 */
const ID_CAMPANA_META = /^\d{15,20}$/;

/**
 * Normaliza la URL de llegada a un origen corto. Pura (recibe todo por
 * parametro) para poder probarla: ver scripts/probarOrigen.ts.
 *
 * El 2026-10-03 llegaron 88 visitas con el id de la campaña "botforge 30/09"
 * en utm_campaign y un utm_source que no estaba en FUENTES_META: cayeron en
 * "otro" y el panel subconto el trafico de Meta. Por eso el id de campaña de
 * Meta decide "meta-anuncio-web" ANTES de mirar utm_source.
 *
 * Un fbclid solo NO alcanza: Facebook lo agrega tambien a los clics organicos
 * (posts, grupos), y contarlo como anuncio inflaria la atribucion. Sin id de
 * campaña, un fbclid es "otro": vino de Facebook, pero no se sabe si de un
 * anuncio.
 */
export function clasificarOrigen(search: string, referrerExterno: boolean): DatosOrigen {
  const q = new URLSearchParams(search);
  const fuente = (q.get('utm_source') ?? '').toLowerCase();
  const medio = (q.get('utm_medium') ?? '').toLowerCase();
  const hayFbclid = q.has('fbclid');
  const campana = q.get('utm_campaign') ?? undefined;
  const anuncio = q.get('utm_content') ?? undefined;

  if (campana !== undefined && ID_CAMPANA_META.test(campana)) {
    return { origen: 'meta-anuncio-web', campana, anuncio };
  }
  if (fuente === 'whatsapp' || fuente === 'wa' || medio.includes('whatsapp')) {
    return { origen: 'meta-anuncio-whatsapp', campana, anuncio };
  }
  if (FUENTES_META.includes(fuente)) {
    return { origen: 'meta-anuncio-web', campana, anuncio };
  }
  if (fuente || hayFbclid) return { origen: 'otro', campana, anuncio };

  // Sin utm ni fbclid: si vino de otro sitio (buscador, red social sin
  // anuncio) es "otro"; si no hay referrer, "directo".
  return { origen: referrerExterno ? 'otro' : 'directo' };
}

/** La clasificacion de esta carga. Del referrer solo se mira si es de afuera, no se guarda. */
function clasificar(): DatosOrigen {
  let referrerExterno = false;
  try {
    referrerExterno = !!document.referrer && new URL(document.referrer).origin !== location.origin;
  } catch {
    // referrer ilegible
  }
  return clasificarOrigen(window.location.search, referrerExterno);
}

/**
 * Al cargar la pagina: fija el origen en memoria y, si es una entrada al
 * sitio por la landing, /planes o el registro, suma una visita.
 *
 * Una recarga no cuenta: el navegador dice si la carga fue una recarga
 * (performance navigation type), sin que haya que guardar nada.
 */
export function capturarOrigen(pathname: string): void {
  if (typeof window === 'undefined' || enMemoria) return;
  enMemoria = clasificar();

  if (visitaContada || !PAGINAS_DE_ENTRADA.includes(pathname)) return;
  let tipoCarga = 'navigate';
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    tipoCarga = nav?.type ?? 'navigate';
  } catch {
    // sin la API se cuenta
  }
  let desdeAfuera = true;
  try {
    desdeAfuera = !document.referrer || new URL(document.referrer).origin !== location.origin;
  } catch {
    // referrer ilegible: se cuenta
  }
  if (tipoCarga !== 'navigate' || !desdeAfuera) return;

  visitaContada = true;
  try {
    const cuerpo = JSON.stringify({ tipo: 'visita', pagina: pathname, ...enMemoria });
    if (!navigator.sendBeacon?.(`${API}/api/v1/origen`, cuerpo)) {
      void fetch(`${API}/api/v1/origen`, { method: 'POST', body: cuerpo, keepalive: true });
    }
  } catch {
    // Un contador no puede romper la pagina
  }
}

/** El origen de esta visita, para mandarlo con el registro */
export function origenDeLaVisita(): DatosOrigen | undefined {
  return enMemoria ?? undefined;
}
