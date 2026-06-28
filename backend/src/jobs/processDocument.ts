import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { documentQueue, type ProcessDocumentJobData } from '../lib/queue';
import { extractAndChunk } from '../services/documentProcessor';
import { getEmbedding } from '../services/embeddings';
import { upsertChunks, deleteChunksByIds, type ChunkVector } from '../services/pinecone';

documentQueue.process(async (job) => {
  const { documentId } = job.data;

  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'PROCESSING' },
  });

  try {
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });

    // Delete any existing chunks (re-processing case)
    const existingChunks = await prisma.chunk.findMany({
      where: { documentId },
      select: { pineconeId: true },
    });
    if (existingChunks.length > 0) {
      await deleteChunksByIds(existingChunks.map((c) => c.pineconeId));
      await prisma.chunk.deleteMany({ where: { documentId } });
    }

    await job.progress(10);

    const textChunks = await extractAndChunk(doc.filePath, doc.mimeType);
    const vectors: ChunkVector[] = [];

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      const chunkId = uuidv4();
      const embedding = await getEmbedding(chunk.content);

      await prisma.chunk.create({
        data: {
          id: chunkId,
          documentId: doc.id,
          botId: doc.botId,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          chunkIndex: chunk.chunkIndex,
          pineconeId: chunkId,
        },
      });

      vectors.push({
        id: chunkId,
        values: embedding,
        metadata: {
          botId: doc.botId,
          documentId: doc.id,
          chunkId,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
        },
      });

      await job.progress(10 + Math.floor((i / textChunks.length) * 80));
    }

    await upsertChunks(vectors);

    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'READY' },
    });

    await job.progress(100);
    console.log(`[processDocument] Documento ${documentId} procesado: ${vectors.length} chunks`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Error desconocido';
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'ERROR', errorMsg },
    });
    console.error(`[processDocument] Error en documento ${documentId}:`, errorMsg);
    throw err;
  }
});

documentQueue.on('failed', (job, err) => {
  console.error(`[queue] Job ${job.id} fallido después de ${job.attemptsMade} intentos:`, err.message);
});

export { documentQueue };
export type { ProcessDocumentJobData };
