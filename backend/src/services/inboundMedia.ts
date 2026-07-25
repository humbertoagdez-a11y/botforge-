/**
 * Procesamiento de media entrante, compartido por los webhooks de Twilio y de
 * Meta Cloud API. Trabaja sobre los bytes ya descargados: cada canal se encarga
 * de bajarlos como corresponda (Twilio con Basic auth, Meta con la Graph API).
 */
import { env } from '../config/env';

/**
 * Transcribe un audio con Deepgram. Devuelve '' si Deepgram no esta
 * configurado o si falla: el mensaje sigue su curso sin transcripcion.
 */
export async function transcribeAudio(audio: ArrayBuffer, mimeType: string): Promise<string> {
  if (!env.DEEPGRAM_API_KEY) return '';

  try {
    const dgRes = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&language=es', {
      method: 'POST',
      headers: {
        Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
        'Content-Type': mimeType,
      },
      body: audio,
    });
    const dgData = (await dgRes.json()) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    const transcript = dgData.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';

    if (transcript) {
      console.log('[deepgram] Audio transcripto:', transcript.slice(0, 120));
    }
    return transcript;
  } catch (err) {
    console.warn('[deepgram] Error transcribiendo audio:', err);
    return '';
  }
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
