import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const PRIMARY_MODEL = 'claude-fable-5';
const FALLBACK_MODEL = 'claude-opus-4-8';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function buildSystemPrompt(
  botName: string,
  personality: string,
  language: string,
  contextChunks: string[],
): string {
  const langLabel =
    language === 'es' ? 'español' : language === 'pt' ? 'português' : 'English';

  const context =
    contextChunks.length > 0
      ? contextChunks.join('\n\n')
      : '';

  const hasContext = contextChunks.length > 0;

  return `Sos ${botName}. ${personality}

ESTILO DE COMUNICACIÓN — seguí estas reglas siempre, sin excepción:
- Hablás como una persona real en ${langLabel}, de forma cálida, natural y directa
- NUNCA usés asteriscos, guiones, bullets, numeraciones, negritas ni ningún formato markdown
- Escribís en párrafos cortos y fluidos, como un mensaje de WhatsApp
- Usás emojis ocasionalmente si el tono lo permite, pero sin exagerar
- Nunca decís frases robóticas como "según la información disponible", "base de conocimiento", "como asistente de IA" ni similares
- Si no sabés algo, lo decís natural: "Eso te lo confirmo, pero podés escribirnos directamente" — nunca inventés datos

COMPORTAMIENTO DE VENTAS:
- Entendés qué necesita el cliente y lo guiás hacia una acción concreta (reserva, compra, consulta, contacto)
- Hacés una pregunta al final de cada respuesta para avanzar la conversación cuando tiene sentido
- Manejás objeciones con empatía, sin presionar
- Generás interés genuino, como un vendedor humano inteligente
${hasContext ? `
INFORMACIÓN DEL NEGOCIO (usá esto para responder):
${context}` : ''}`;
}

function buildMessages(
  history: ChatMessage[],
  userMessage: string,
): Anthropic.MessageParam[] {
  return [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userMessage },
  ];
}

async function callGenerate(
  model: string,
  systemText: string,
  messages: Anthropic.MessageParam[],
): Promise<{ content: string; tokensUsed: number; stopReason: string }> {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
    messages,
  });

  const block = response.content[0];
  const content = block.type === 'text' ? block.text : '';
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
  const stopReason = (response.stop_reason as string) ?? '';

  return { content, tokensUsed, stopReason };
}

export async function generateBotResponse(
  botName: string,
  personality: string,
  language: string,
  contextChunks: string[],
  history: ChatMessage[],
  userMessage: string,
): Promise<{ content: string; tokensUsed: number }> {
  const systemText = buildSystemPrompt(botName, personality, language, contextChunks);
  const messages = buildMessages(history, userMessage);

  const primary = await callGenerate(PRIMARY_MODEL, systemText, messages);

  if (primary.stopReason === 'refusal') {
    console.warn(`[ai] ${PRIMARY_MODEL} devolvió refusal, reintentando con ${FALLBACK_MODEL}`);
    const { content, tokensUsed } = await callGenerate(FALLBACK_MODEL, systemText, messages);
    return { content, tokensUsed };
  }

  return { content: primary.content, tokensUsed: primary.tokensUsed };
}

export async function streamBotResponse(
  botName: string,
  personality: string,
  language: string,
  contextChunks: string[],
  history: ChatMessage[],
  userMessage: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ content: string; tokensUsed: number }> {
  const systemText = buildSystemPrompt(botName, personality, language, contextChunks);
  const messages = buildMessages(history, userMessage);

  const stream = anthropic.messages.stream({
    model: PRIMARY_MODEL,
    max_tokens: 1024,
    system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
    messages,
  });

  signal?.addEventListener('abort', () => stream.abort());

  stream.on('text', (text) => {
    onDelta(text);
  });

  const finalMessage = await stream.finalMessage();

  if ((finalMessage.stop_reason as string) === 'refusal') {
    console.warn(`[ai] ${PRIMARY_MODEL} stream devolvió refusal, reintentando con ${FALLBACK_MODEL}`);
    const fallback = await callGenerate(FALLBACK_MODEL, systemText, messages);
    onDelta(fallback.content);
    return fallback;
  }

  const content = finalMessage.content[0]?.type === 'text' ? finalMessage.content[0].text : '';
  const tokensUsed = finalMessage.usage.input_tokens + finalMessage.usage.output_tokens;

  return { content, tokensUsed };
}
