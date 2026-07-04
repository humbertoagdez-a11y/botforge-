import { getEmbedding } from './embeddings';
import { querySimilarChunks } from './pinecone';
import { generateBotResponse, streamBotResponse, type ChatMessage } from './ai';

export type { ChatMessage };

const SIMILARITY_THRESHOLD = 0.3;
const TOP_K = 5;

export async function getRelevantChunks(botId: string, userMessage: string): Promise<string[]> {
  const queryVector = await getEmbedding(userMessage);
  const similar = await querySimilarChunks(queryVector, botId, TOP_K);
  return similar.filter((c) => c.score >= SIMILARITY_THRESHOLD).map((c) => c.content);
}

export async function ragChat(
  botId: string,
  botName: string,
  personality: string,
  language: string,
  history: ChatMessage[],
  userMessage: string,
): Promise<{ content: string; tokensUsed: number }> {
  const chunks = await getRelevantChunks(botId, userMessage);
  return generateBotResponse(botName, personality, language, chunks, history, userMessage);
}

export async function ragStream(
  botId: string,
  botName: string,
  personality: string,
  language: string,
  history: ChatMessage[],
  userMessage: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ content: string; tokensUsed: number }> {
  const chunks = await getRelevantChunks(botId, userMessage);
  return streamBotResponse(botName, personality, language, chunks, history, userMessage, onDelta, signal);
}
