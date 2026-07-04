import twilio from 'twilio';
import { env } from '../config/env';
import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary';

export function isTwilioConfigured(): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM);
}

function getClient() {
  if (!isTwilioConfigured()) {
    throw new Error('Twilio no está configurado (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM)');
  }
  return twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
}

function toWhatsApp(to: string): string {
  return to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
}

export async function sendTextMessage(to: string, body: string): Promise<void> {
  await getClient().messages.create({
    from: env.TWILIO_WHATSAPP_FROM,
    to: toWhatsApp(to),
    body,
  });
}

/**
 * Sube la imagen a Cloudinary (Twilio necesita una URL pública) y la manda
 * como media con caption. Los archivos quedan tageados whatsapp_temp para
 * poder limpiarlos en lote desde Cloudinary.
 */
export async function sendImageMessage(
  to: string,
  imageBase64: string,
  mimeType: string,
  caption: string,
): Promise<void> {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary no está configurado (necesario para hospedar la imagen)');
  }

  const uploadRes = await cloudinary.uploader.upload(
    `data:${mimeType};base64,${imageBase64}`,
    {
      folder: 'botforge/whatsapp-media',
      resource_type: 'image',
      tags: ['whatsapp_temp'],
    },
  );

  await getClient().messages.create({
    from: env.TWILIO_WHATSAPP_FROM,
    to: toWhatsApp(to),
    body: caption,
    mediaUrl: [uploadRes.secure_url],
  });
}
