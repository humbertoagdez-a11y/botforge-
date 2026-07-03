import { env } from '../config/env';

/**
 * Envia un email via Resend (fetch nativo). Nunca lanza: si falta la API key
 * o el envio falla, loggea y devuelve false — los emails son best-effort.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  from = 'BotForge Alerts <noreply@botforge.com.py>',
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
