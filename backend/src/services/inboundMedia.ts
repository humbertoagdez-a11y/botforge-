/**
 * Procesamiento de media entrante, compartido por los webhooks de Twilio y de
 * Meta Cloud API. Trabaja sobre los bytes ya descargados: cada canal se encarga
 * de bajarlos como corresponda (Twilio con Basic auth, Meta con la Graph API).
 */
import { env } from '../config/env';
import { transcribirNotaDeVoz } from './transcripcion';

/**
 * Transcribe un audio. Lo usa el webhook de Twilio, que esta apagado con kill
 * switch pero se mantiene funcionando.
 *
 * Delega en services/transcripcion.ts para no tener dos implementaciones de lo
 * mismo: de paso Twilio hereda el timeout y el respaldo con Groq. Devuelve ''
 * si no se pudo, que es el contrato que ese webhook ya esperaba.
 */
export async function transcribeAudio(audio: ArrayBuffer, mimeType: string): Promise<string> {
  const r = await transcribirNotaDeVoz(Buffer.from(audio), mimeType);
  return r.texto;
}

/**
 * Analiza una imagen con Google Vision y devuelve una descripcion en texto para
 * inyectar en el prompt. Devuelve '' si Vision no esta configurado o si falla.
 */
export async function analyzeImage(image: ArrayBuffer): Promise<string> {
  if (!env.GOOGLE_VISION_API_KEY) return '';

  try {
    const base64 = Buffer.from(image).toString('base64');

    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${env.GOOGLE_VISION_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64 },
              features: [
                { type: 'TEXT_DETECTION', maxResults: 1 },
                { type: 'LABEL_DETECTION', maxResults: 5 },
                { type: 'OBJECT_LOCALIZATION', maxResults: 5 },
              ],
            },
          ],
        }),
      },
    );
    const visionData = (await visionRes.json()) as {
      responses?: Array<{
        fullTextAnnotation?: { text?: string };
        labelAnnotations?: Array<{ description: string }>;
        localizedObjectAnnotations?: Array<{ name: string }>;
      }>;
    };
    const response = visionData.responses?.[0];

    const text = response?.fullTextAnnotation?.text ?? '';
    const labels = (response?.labelAnnotations ?? []).map((l) => l.description).join(', ');
    const objects = (response?.localizedObjectAnnotations ?? []).map((o) => o.name).join(', ');

    let imageContext = '[El cliente mandó una imagen.';
    if (text) imageContext += ` Texto detectado: "${text.slice(0, 200)}".`;
    if (labels) imageContext += ` Elementos: ${labels}.`;
    if (objects) imageContext += ` Objetos: ${objects}.`;
    imageContext += ']';

    console.log('[vision] Imagen analizada:', imageContext.slice(0, 200));
    return imageContext;
  } catch (err) {
    console.warn('[vision] Error analizando imagen:', err);
    return '';
  }
}
