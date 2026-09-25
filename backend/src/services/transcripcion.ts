/**
 * Transcripción de notas de voz de WhatsApp.
 *
 * Un solo camino para los dos proveedores. Deepgram es el principal porque ya
 * estaba integrado, con la clave cargada y andando; Groq entra solo si hay
 * `GROQ_API_KEY`, y se usa como respaldo cuando Deepgram falla — que en la
 * práctica es cuando se agota el crédito de los 200 dólares.
 *
 * Los dos comen `audio/ogg; codecs=opus` tal cual lo manda WhatsApp, así que
 * acá no se convierte nada y el contenedor de Railway no necesita ffmpeg.
 *
 * Nunca lanza. Un audio que no se pudo transcribir devuelve un motivo, y el
 * canal decide qué decirle al cliente: el bot tiene que seguir atendiendo
 * texto e imágenes exactamente igual que antes.
 */
import { env } from '../config/env';

/** Más que esto y el cliente se queda mirando "escribiendo..." sin respuesta. */
const TIMEOUT_MS = 15_000;

/** Tope de duración. Arriba de esto se le pide que escriba o grabe más corto. */
export const MAX_SEGUNDOS = 120;

export type MotivoFallo =
  | 'sin-proveedor'
  | 'demasiado-largo'
  | 'vacia'
  | 'error-proveedor';

export interface ResultadoTranscripcion {
  /** Texto transcripto. Vacío cuando `fallo` viene cargado. */
  texto: string;
  /** Duración real del audio en segundos, o null si no se pudo leer. */
  segundos: number | null;
  /** Quién la resolvió. Sirve para ver en los logs cuándo entró el respaldo. */
  proveedor: 'deepgram' | 'groq' | null;
  fallo: MotivoFallo | null;
}

// ─── Duración, leída del contenedor ───────────────────────────────────────────

/**
 * Duración de un Ogg/Opus, sin ffmpeg.
 *
 * La última página Ogg trae el *granule position*, que en Opus siempre cuenta
 * muestras a 48 kHz sin importar el sample rate real del audio. Se le resta el
 * pre-skip, que vive en la cabecera OpusHead.
 *
 * Se lee así y no con ffmpeg porque la imagen de Railway no lo trae, y sumarlo
 * al build para averiguar un número que está en los primeros bytes del archivo
 * no se justifica. Verificado contra un audio real: dio 11,294 s, el mismo
 * valor que devolvió Deepgram después de procesarlo.
 *
 * Devuelve null si el archivo no es Ogg (por ejemplo un m4a que alguien adjuntó
 * como archivo en vez de grabar). Ahí no se puede aplicar el tope por duración
 * y se cae al tope por tamaño, que es el que igual impone Meta.
 */
export function duracionOggOpus(buffer: Buffer): number | null {
  // Se busca hacia atrás: la página que interesa es la última
  let granuleFinal = -1;
  for (let i = buffer.length - 27; i >= 0; i--) {
    if (
      buffer[i] === 0x4f && // O
      buffer[i + 1] === 0x67 && // g
      buffer[i + 2] === 0x67 && // g
      buffer[i + 3] === 0x53 // S
    ) {
      granuleFinal = Number(buffer.readBigUInt64LE(i + 6));
      break;
    }
  }
  if (granuleFinal < 0) return null;

  let preSkip = 0;
  const cabecera = buffer.indexOf(Buffer.from('OpusHead'));
  if (cabecera >= 0 && cabecera + 12 <= buffer.length) {
    preSkip = buffer.readUInt16LE(cabecera + 10);
  }

  const segundos = (granuleFinal - preSkip) / 48000;
  return Number.isFinite(segundos) && segundos > 0 ? segundos : null;
}

// ─── Proveedores ──────────────────────────────────────────────────────────────

/** Corta la espera al proveedor sin dejar el fetch colgado. */
async function conTimeout(
  hacer: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const ac = new AbortController();
  const reloj = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await hacer(ac.signal);
  } finally {
    clearTimeout(reloj);
  }
}

/** Nova-3 en español. Acepta el ogg/opus de WhatsApp sin convertir. */
async function conDeepgram(audio: Buffer, mimeType: string): Promise<string> {
  const res = await conTimeout((signal) =>
    fetch('https://api.deepgram.com/v1/listen?model=nova-3&language=es&smart_format=true', {
      method: 'POST',
      headers: {
        Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
        'Content-Type': mimeType,
      },
      body: new Uint8Array(audio),
      signal,
    }),
  );

  if (!res.ok) {
    // El cuerpo trae el motivo (crédito agotado, clave sin permisos, etc.).
    // Nunca se loguea la clave: viaja solo en el header.
    const detalle = await res.text().catch(() => '');
    throw new Error(`deepgram HTTP ${res.status}: ${detalle.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
  };
  return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
}

/**
 * Whisper large v3 turbo por Groq.
 *
 * Va como respaldo y no como principal porque exige una cuenta y una clave
 * más. Su nivel gratuito se renueva todos los días (8 horas de audio), así que
 * es la red que aguanta cuando se termina el crédito de Deepgram.
 */
async function conGroq(audio: Buffer, mimeType: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), 'nota.ogg');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'es');
  form.append('response_format', 'json');

  const res = await conTimeout((signal) =>
    fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
      signal,
    }),
  );

  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`groq HTTP ${res.status}: ${detalle.slice(0, 200)}`);
  }

  const data = (await res.json()) as { text?: string };
  return data.text ?? '';
}

// ─── Entrada única ────────────────────────────────────────────────────────────

/**
 * Transcribe una nota de voz. Nunca lanza.
 *
 * El orden es Deepgram y después Groq. Si Deepgram falla por lo que sea —
 * crédito agotado, caída, timeout— se intenta con Groq sin que el cliente se
 * entere. Si Groq no está configurado, no hay segundo intento y se devuelve el
 * motivo para que el canal responda algo útil.
 */
export async function transcribirNotaDeVoz(
  audio: Buffer,
  mimeType: string,
): Promise<ResultadoTranscripcion> {
  const segundos = duracionOggOpus(audio);

  if (segundos !== null && segundos > MAX_SEGUNDOS) {
    console.log(`[transcripcion] audio de ${segundos.toFixed(0)}s rechazado por largo`);
    return { texto: '', segundos, proveedor: null, fallo: 'demasiado-largo' };
  }

  const intentos: Array<{ nombre: 'deepgram' | 'groq'; correr: () => Promise<string> }> = [];
  if (env.DEEPGRAM_API_KEY) {
    intentos.push({ nombre: 'deepgram', correr: () => conDeepgram(audio, mimeType) });
  }
  if (env.GROQ_API_KEY) {
    intentos.push({ nombre: 'groq', correr: () => conGroq(audio, mimeType) });
  }

  if (intentos.length === 0) {
    console.warn('[transcripcion] ningun proveedor configurado (DEEPGRAM_API_KEY / GROQ_API_KEY)');
    return { texto: '', segundos, proveedor: null, fallo: 'sin-proveedor' };
  }

  // Se distingue "nadie entendio nada" de "el proveedor se cayo": al cliente le
  // decimos lo mismo, pero en los logs no es el mismo problema — uno es un
  // audio malo y el otro es credito agotado o una caida.
  let huboError = false;

  for (const intento of intentos) {
    const t0 = Date.now();
    try {
      const texto = (await intento.correr()).trim();
      const ms = Date.now() - t0;

      if (!texto) {
        // Audio mudo, ruido, o un idioma que el modelo no pudo sacar. Se
        // prueba con el siguiente proveedor: a veces uno saca lo que el otro no.
        console.warn(`[transcripcion] ${intento.nombre} devolvio vacio (${ms}ms)`);
        continue;
      }

      console.log(
        `[transcripcion] ${intento.nombre} ok — ${segundos?.toFixed(1) ?? '?'}s de audio en ${ms}ms: ` +
          `"${texto.slice(0, 80)}"`,
      );
      return { texto, segundos, proveedor: intento.nombre, fallo: null };
    } catch (err) {
      huboError = true;
      const detalle = err instanceof Error ? err.message : String(err);
      const esTimeout = detalle.includes('abort') || (err as Error)?.name === 'AbortError';
      console.warn(
        `[transcripcion] ${intento.nombre} fallo tras ${Date.now() - t0}ms` +
          `${esTimeout ? ' (timeout)' : ''}: ${detalle}`,
      );
    }
  }

  return { texto: '', segundos, proveedor: null, fallo: huboError ? 'error-proveedor' : 'vacia' };
}
