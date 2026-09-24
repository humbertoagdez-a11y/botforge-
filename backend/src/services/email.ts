import { env } from '../config/env';

/**
 * Escapa un dato que va a interpolarse dentro del HTML de un email.
 *
 * Hace falta porque varios de estos emails llevan texto que NO escribio quien
 * los recibe: el mensaje de un cliente de WhatsApp, el comentario de una
 * encuesta, el asunto de un ticket. Sin escapar, cualquiera de esos textos
 * puede meter etiquetas —un <a> a otro sitio, por ejemplo— en un email que
 * llega con el remitente de BotForge. Es un vector de phishing contra el
 * dueño del negocio, no un problema de quien escribe.
 *
 * Se escapan las cinco entidades que importan en contenido y en atributos.
 */
export function escaparHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Envia un email via Resend (fetch nativo). Nunca lanza: si falta la API key
 * o el envio falla, loggea y devuelve false — los emails son best-effort.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  from = env.EMAIL_FROM,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY no configurada — se omite email "${subject}" a ${to}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error(`[email] Resend respondió ${res.status} al enviar "${subject}" a ${to}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] Error al enviar email:', err);
    return false;
  }
}
