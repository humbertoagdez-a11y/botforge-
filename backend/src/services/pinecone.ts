import { Pinecone } from '@pinecone-database/pinecone';
import { env } from '../config/env';

let client: Pinecone | null = null;

function getClient(): Pinecone {
  if (!client) client = new Pinecone({ apiKey: env.PINECONE_API_KEY });
  return client;
}

export interface ChunkVector {
  id: string;
  values: number[];
  metadata: {
    botId: string;
    documentId: string;
    chunkId: string;
    content: string;
    chunkIndex: number;
  };
}

export async function upsertChunks(chunks: ChunkVector[]): Promise<void> {
  const index = getClient().index(env.PINECONE_INDEX);
  const batchSize = 100;
  for (let i = 0; i < chunks.length; i += batchSize) {
    await index.upsert(chunks.slice(i, i + batchSize));
  }
}

export async function querySimilarChunks(
  vector: number[],
  botId: string,
  topK = 5,
): Promise<Array<{ content: string; score: number }>> {
  const index = getClient().index(env.PINECONE_INDEX);
  const result = await index.query({
    vector,
    topK,
    filter: { botId: { $eq: botId } },
    includeMetadata: true,
  });

  return (result.matches ?? []).map((m) => ({
    content: (m.metadata?.content as string) ?? '',
    score: m.score ?? 0,
  }));
}

export async function deleteChunksByIds(pineconeIds: string[]): Promise<void> {
  if (pineconeIds.length === 0) return;
  const index = getClient().index(env.PINECONE_INDEX);
  const batchSize = 1000;
  for (let i = 0; i < pineconeIds.length; i += batchSize) {
    await index.deleteMany(pineconeIds.slice(i, i + batchSize));
  }
}
