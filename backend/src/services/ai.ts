import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { buildTenantSystemPrompt } from './tenantAgent';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const PRIMARY_MODEL = 'claude-sonnet-5';
const FALLBACK_MODEL = 'claude-opus-4-8';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// El system prompt del bot desplegado vive en tenantAgent.ts (arquitectura
// dual): personalidad del dueño + reglas base de calidad de BotForge.
function buildSystemPrompt(
  botName: string,
  personality: string,
  language: string,
  contextChunks: string[],
): string {
  return buildTenantSystemPrompt(botName, personality, language, contextChunks.join('\n\n'));
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
  maxTokens = 1024,
): Promise<{ content: string; tokensUsed: number; stopReason: string }> {
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
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

const INSTRUCTIVO_SYSTEM = `Sos un experto en crear instructivos de entrenamiento para chatbots de ventas en WhatsApp. Tu tarea es tomar las respuestas del dueño de un negocio y generar un documento de entrenamiento completo, claro y estructurado para que la IA pueda responder perfectamente a los clientes.

El instructivo debe incluir:
- Presentación del negocio
- Catalogo completo de productos/servicios con precios
- Horarios y zona de cobertura
- Formas de pago
- Politicas de cambio y garantia
- Promociones vigentes
- Diferenciadores del negocio
- Tono y personalidad del bot
- Preguntas frecuentes con respuestas exactas
- Instrucciones de derivacion a humano
- Informacion adicional relevante

Redactalo en formato de texto plano, sin markdown, sin asteriscos, sin bullets. Solo parrafos claros y secciones bien tituladas con MAYUSCULAS. El resultado debe poder copiarse directamente como instructivo de un chatbot.`;

export async function generateInstructivo(
  answers: Record<string, string>,
): Promise<string> {
  const userContent = Object.entries(answers)
    .filter(([, v]) => v.trim().length > 0)
    .map(([question, answer]) => `${question}\n${answer}`)
    .join('\n\n');

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Estas son las respuestas del dueño del negocio. Generá el instructivo completo:\n\n${userContent}`,
    },
  ];

  const primary = await callGenerate(PRIMARY_MODEL, INSTRUCTIVO_SYSTEM, messages, 4096);

  if (primary.stopReason === 'refusal') {
    console.warn(`[ai] ${PRIMARY_MODEL} devolvió refusal en instructivo, reintentando con ${FALLBACK_MODEL}`);
    const fallback = await callGenerate(FALLBACK_MODEL, INSTRUCTIVO_SYSTEM, messages, 4096);
    return fallback.content;
  }

  return primary.content;
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
