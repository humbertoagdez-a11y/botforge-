/**
 * Recuperacion de contexto para el bot tenant.
 *
 * Unica implementacion de la busqueda semantica: la usan el contexto inicial de
 * cada turno y la herramienta buscar_en_documentos. Antes cada una tenia su
 * propia copia de TOP_K y del umbral, que es exactamente como se desincronizan
 * dos caminos que deberian devolver lo mismo.
 *
 * Ya no vive aca la generacion de respuestas: el motor del bot es uno solo y
 * esta en tenantAgent.ts.
 */
import { getEmbedding } from './embeddings';
import { querySimilarChunks } from './pinecone';

export const SIMILARITY_THRESHOLD = 0.3;
export const TOP_K = 5;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function getRelevantChunks(botId: string, userMessage: string): Promise<string[]> {
  const queryVector = await getEmbedding(userMessage);
  const similar = await querySimilarChunks(queryVector, botId, TOP_K);
  return similar.filter((c) => c.score >= SIMILARITY_THRESHOLD).map((c) => c.content);
}
