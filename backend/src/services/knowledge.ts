/**
 * Alta de conocimiento suelto en un bot: un dato que el bot no sabia se guarda
 * como documento nuevo y entra a la cola de procesamiento normal.
 *
 * Vive aca y no en la ruta porque lo usan dos entradas distintas: la
 * herramienta agregar_conocimiento del asistente y el boton "Agregar esta
 * informacion" del reporte semanal. Una sola implementacion evita que las dos
 * se desincronicen en limites o en como quedan nombrados los documentos.
 */
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { LIMITS, effectivePlan } from '../middleware/planLimits';
import { uploadRawToCloudinary } from '../config/cloudinary';
import { documentQueue } from '../lib/queue';

export interface ConocimientoAgregado {
  documentId: string;
  name: string;
  tituloLimpio: string;
}

/** Se lanza cuando el bot ya llego al tope de documentos de su plan */
export class LimiteDocumentosError extends Error {}

/**
 * Crea el documento, lo sube y lo encola. NO verifica pertenencia del bot: eso
 * es responsabilidad del llamador, que ya tiene el bot resuelto.
 */
export async function agregarConocimiento(params: {
  botId: string;
  userId: string;
  titulo: string;
  contenido: string;
}): Promise<ConocimientoAgregado> {
  const { botId, userId, titulo, contenido } = params;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
  const plan = effectivePlan(user);
  const docCount = await prisma.document.count({ where: { botId } });
  const limit = LIMITS[plan].docsPerBot;
  if (docCount >= limit) {
    throw new LimiteDocumentosError(
      `Límite de documentos alcanzado (${docCount}/${limit} del plan ${plan}). Eliminá alguno o mejorá el plan.`,
    );
  }

  const docId = uuidv4();
  const tituloLimpio = titulo.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ._-]/g, '').trim();
  const finalName = `Corrección: ${tituloLimpio}`.slice(0, 120);
  // El título va dentro del contenido: ayuda a que el chunk matchee
  const texto = `${tituloLimpio}\n\n${contenido}`;
  const filePath = path.join(env.UPLOADS_DIR, `${docId}.txt`);
  await fs.mkdir(env.UPLOADS_DIR, { recursive: true });
  await fs.writeFile(filePath, texto, 'utf-8');

  let doc = await prisma.document.create({
    data: {
      id: docId,
      botId,
      name: `${finalName}.txt`,
      mimeType: 'text/plain',
      filePath,
      fileSize: Buffer.byteLength(texto, 'utf-8'),
      status: 'PENDING',
    },
  });

  const url = await uploadRawToCloudinary(filePath, doc.id);
  if (url) {
    doc = await prisma.document.update({ where: { id: doc.id }, data: { url } });
    try { await fs.unlink(filePath); } catch { /* limpieza best-effort */ }
  }

  await documentQueue.add({ documentId: doc.id });

  return { documentId: doc.id, name: doc.name, tituloLimpio };
}
