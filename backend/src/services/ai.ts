/**
 * Llamadas a Anthropic que NO son el bot desplegado.
 *
 * El motor del bot tenant (system prompt, RAG, tools, fallback) vive entero en
 * tenantAgent.ts y no se duplica aca. Este archivo tenia una segunda
 * implementacion —generateBotResponse y streamBotResponse— que llamaba al
 * modelo SIN el parametro tools: el Chat de prueba del panel corria por ahi y
 * el bot no podia buscar en documentos, mandar fotos de Drive ni derivar a un
 * humano, todo lo cual si hacia en WhatsApp. El dueño probaba una cosa y sus
 * clientes recibian otra. Se elimino; ahora los tres canales entran por
 * runTenantTurn.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { logCacheUsage } from '../lib/cacheUsage';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const PRIMARY_MODEL = 'claude-sonnet-5';
const FALLBACK_MODEL = 'claude-opus-4-8';

async function callGenerate(
  model: string,
  system: string,
  messages: Anthropic.MessageParam[],
  maxTokens = 1024,
  scope = 'ai',
): Promise<{ content: string; tokensUsed: number; stopReason: string }> {
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  logCacheUsage(scope, response.usage);

  const block = response.content[0];
  const content = block.type === 'text' ? block.text : '';
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
  const stopReason = (response.stop_reason as string) ?? '';

  return { content, tokensUsed, stopReason };
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
