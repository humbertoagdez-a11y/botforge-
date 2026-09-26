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

/**
 * Todos los ids que hay en el indice, paginando hasta el final.
 *
 * Solo lo usa el script de huerfanos. En el camino normal nunca hace falta
 * recorrer el indice entero: las consultas van siempre filtradas por botId.
 */
export async function listarTodosLosIds(): Promise<string[]> {
  const index = getClient().index(env.PINECONE_INDEX);
  const ids: string[] = [];
  let token: string | undefined;

  do {
    const pagina = await index.listPaginated(token ? { paginationToken: token } : {});
    for (const v of pagina.vectors ?? []) {
      if (v.id) ids.push(v.id);
    }
    token = pagina.pagination?.next;
  } while (token);

  return ids;
}

/**
 * La metadata de un grupo de vectores, para saber de que bot era cada uno.
 *
 * Se pide de a 100 porque fetch los manda en la URL y con listas largas el
 * request se pasa de tamaño.
 */
export async function traerMetadataDeVectores(
  ids: string[],
): Promise<Map<string, { botId?: string; documentId?: string }>> {
  const index = getClient().index(env.PINECONE_INDEX);
  const out = new Map<string, { botId?: string; documentId?: string }>();

  for (let i = 0; i < ids.length; i += 100) {
    const res = await index.fetch(ids.slice(i, i + 100));
    for (const [id, vec] of Object.entries(res.records ?? {})) {
      out.set(id, {
        botId: vec.metadata?.botId as string | undefined,
        documentId: vec.metadata?.documentId as string | undefined,
      });
    }
  }

  return out;
}
