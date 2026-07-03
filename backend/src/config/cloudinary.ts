import { v2 as cloudinary } from 'cloudinary';
import { env } from './env';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export function isCloudinaryConfigured(): boolean {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

/**
 * Sube un archivo local a Cloudinary como raw y devuelve la URL persistente,
 * o null si Cloudinary no esta configurado o falla (el llamador mantiene el
 * archivo local como fallback).
 */
export async function uploadRawToCloudinary(
  localFilePath: string,
  documentId: string,
): Promise<string | null> {
  if (!isCloudinaryConfigured()) {
    console.warn('[cloudinary] No configurado — el archivo queda solo en disco local (efímero en Railway)');
    return null;
  }
  try {
    const result = await cloudinary.uploader.upload(localFilePath, {
      resource_type: 'raw',
      folder: 'botforge/documents',
      public_id: `doc_${documentId}`,
    });
    return result.secure_url;
  } catch (err) {
    console.error('[cloudinary] Error al subir, se mantiene el archivo local:', err);
    return null;
  }
}

export { cloudinary };
