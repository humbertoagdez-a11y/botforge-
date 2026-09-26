/**
 * Borrado del rastro que un bot deja FUERA de la base de datos.
 *
 * Postgres se limpia solo con los onDelete: Cascade del schema. Pinecone y
 * Cloudinary no: son servicios aparte y nadie les avisa. Hasta ahora borrar un
 * bot dejaba sus vectores y sus archivos ahi para siempre — se pagan igual, y
 * los vectores huerfanos siguen ocupando el indice que comparten todos los
 * clientes.
 *
 * Borrar un documento suelto SI limpiaba las dos cosas (routes/documents.ts).
 * Lo que faltaba era el caso de arriba: borrar el bot entero.
 *
 * Todo es best-effort y NUNCA lanza. Si Cloudinary esta caido, el dueño tiene
 * que poder borrar su bot igual: un archivo huerfano es molesto, un bot que no
 * se puede borrar es un bloqueo.
 */
import { prisma } from '../lib/prisma';
import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary';
import { deleteChunksByIds } from './pinecone';

export interface ResumenLimpieza {
  vectores: number;
  documentos: number;
  imagenes: number;
  fallas: string[];
}

/**
 * Borra vectores de Pinecone e imagenes y documentos de Cloudinary.
 *
 * Se llama ANTES de borrar el bot de la base: las filas de chunks, documentos
 * e imagenes se van en cascada, y son las que dicen QUE hay que borrar afuera.
 * Llamarla despues no encontraria nada que borrar y el rastro quedaria igual.
 */
export async function limpiarRastroDelBot(botId: string): Promise<ResumenLimpieza> {
  const resumen: ResumenLimpieza = { vectores: 0, documentos: 0, imagenes: 0, fallas: [] };

  // ─── Pinecone ──────────────────────────────────────────────────────────────
  try {
    const chunks = await prisma.chunk.findMany({
      where: { botId },
      select: { pineconeId: true },
    });
    if (chunks.length > 0) {
      await deleteChunksByIds(chunks.map((c) => c.pineconeId));
      resumen.vectores = chunks.length;
    }
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    resumen.fallas.push(`pinecone: ${motivo}`);
    console.error(`[limpieza] no se pudieron borrar los vectores del bot ${botId}:`, motivo);
  }

  if (!isCloudinaryConfigured()) return resumen;

  // ─── Documentos en Cloudinary ──────────────────────────────────────────────
  // Solo los que tienen url: sin ella el archivo nunca llego a subirse y el
  // public_id que armariamos no existe del otro lado.
  try {
    const docs = await prisma.document.findMany({
      where: { botId, url: { not: null } },
      select: { id: true },
    });
    for (const doc of docs) {
      try {
        await cloudinary.uploader.destroy(`botforge/documents/doc_${doc.id}`, {
          resource_type: 'raw',
        });
        resumen.documentos++;
      } catch (err) {
        resumen.fallas.push(`documento ${doc.id}`);
        console.error(`[limpieza] no se pudo borrar el documento ${doc.id} de Cloudinary:`, err);
      }
    }
  } catch (err) {
    resumen.fallas.push('lectura de documentos');
    console.error(`[limpieza] no se pudieron leer los documentos del bot ${botId}:`, err);
  }

  // ─── Imagenes en Cloudinary ────────────────────────────────────────────────
  try {
    const imagenes = await prisma.botImage.findMany({
      where: { botId },
      select: { id: true, publicId: true },
    });
    for (const img of imagenes) {
      try {
        await cloudinary.uploader.destroy(img.publicId, { resource_type: 'image' });
        resumen.imagenes++;
      } catch (err) {
        resumen.fallas.push(`imagen ${img.id}`);
        console.error(`[limpieza] no se pudo borrar la imagen ${img.id} de Cloudinary:`, err);
      }
    }
  } catch (err) {
    resumen.fallas.push('lectura de imagenes');
    console.error(`[limpieza] no se pudieron leer las imagenes del bot ${botId}:`, err);
  }

  return resumen;
}
