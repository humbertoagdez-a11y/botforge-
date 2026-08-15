/**
 * AGENTE TIPO B — Bot Desplegado (tenant).
 * Vive en WhatsApp y en el widget web; interactúa con clientes finales.
 * Personalidad dinámica: la define el dueño en bot.personality (instructivo).
 * BotForge controla las reglas de calidad (baseRules); el dueño controla la voz.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { getRelevantChunks } from './rag';
import { sendEmail } from './email';
import { searchFileByName, downloadFileAsBase64, getValidAccessToken } from './googleDrive';
import { isCloudinaryConfigured } from '../config/cloudinary';
import { logCacheUsage } from '../lib/cacheUsage';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const PRIMARY_MODEL = 'claude-sonnet-5';
const FALLBACK_MODEL = 'claude-opus-4-8';
const MAX_TURNS = 5;

export interface TenantChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── SYSTEM PROMPT DINÁMICO ───────────────────────────────────────────────────

/**
 * Prompt del tenant partido para prompt caching.
 *
 * - `stable` depende solo del bot (nombre, personalidad, idioma y reglas): es
 *   idéntico en todos los mensajes de ese bot, así que es lo que se cachea.
 * - `context` es lo que trajo el RAG para ESTE mensaje y cambia siempre. Va
 *   después y sin marcar: si fuera antes, rompería el prefijo del caché.
 */
export interface TenantSystemBlocks {
  stable: string;
  context: string;
}

export function buildTenantSystemBlocks(
  botName: string,
  personality: string,
  language: string,
  documentsContent: string,
): TenantSystemBlocks {
  return {
    stable: buildTenantStablePrompt(botName, personality, language),
    context: documentsContent
      ? `INFORMACIÓN DEL NEGOCIO Y BASE DE CONOCIMIENTO:
${documentsContent}`
      : '',
  };
}

/** Parte cacheable: todo lo que no depende del mensaje puntual */
export function buildTenantStablePrompt(
  botName: string,
  personality: string,
  language: string,
): string {
  return buildTenantSystemPrompt(botName, personality, language, '');
}

export function buildTenantSystemPrompt(
  botName: string,
  personality: string,
  language: string,
  documentsContent: string,
): string {
  const langLabel =
    language === 'es' ? 'español' : language === 'pt' ? 'português' : 'English';

  const baseRules = `
REGLAS DE COMUNICACIÓN INNEGOCIABLES:
Hablás como una persona real en ${langLabel}, de forma cálida, natural y directa.
Mensajes cortos, máximo 3 o 4 líneas. Nunca usés asteriscos, guiones como bullets, almohadillas ni ningún símbolo de markdown. Solo texto plano como si fuera WhatsApp.
Nunca uses los signos de apertura ¿ ni ¡ al principio de una pregunta o exclamación. Escribís como se escribe en WhatsApp real: 'Como estas?' no '¿Cómo estás?', 'Genial!' no '¡Genial!'. Es una regla de estilo de esta plataforma, no un error ortográfico — revisá tu respuesta antes de enviarla y sacá cualquier ¿ o ¡ que hayas puesto por costumbre.
Nunca digas que sos un bot ni uses frases de IA como "según la información disponible", "base de conocimiento" o "como asistente".
Si no sabés algo, decí que lo vas a consultar y derivá; nunca inventés datos.
Siempre terminás con una pregunta o acción concreta cuando tiene sentido para avanzar la conversación.
Igualá el registro del cliente: si escribe informal, sé informal.
Entendés qué necesita el cliente y lo guiás hacia una acción concreta (reserva, compra, consulta, contacto). Manejás objeciones con empatía, sin presionar.
${documentsContent
    ? `
INFORMACIÓN DEL NEGOCIO Y BASE DE CONOCIMIENTO:
${documentsContent}`
    : ''}`;

  return `Sos ${botName}. ${personality}

${baseRules}`;
}

// ─── TOOL REGISTRY DEL TENANT ─────────────────────────────────────────────────

export const TENANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'buscar_en_documentos',
    description:
      'Busca información específica en los documentos del negocio. Usá esto cuando el cliente pregunte algo que debería estar en el catálogo, lista de precios, horarios o políticas y no esté en tu contexto.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Qué información buscar' },
      },
      required: ['query'],
    },
  },
  {
    name: 'buscar_archivos_drive',
    description:
      'Busca imágenes o archivos en la carpeta de Drive del negocio. Usá esto cuando el cliente pida ver fotos de productos, el menú, el catálogo u otros archivos.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Qué producto o archivo buscar' },
      },
      required: ['query'],
    },
  },
  {
    name: 'derivar_a_humano',
    description:
      'Avisa que un agente humano va a tomar la conversación. Usá esto cuando el cliente lo pida explícitamente, cuando la situación sea un reclamo serio, o cuando no puedas resolver lo que piden.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Por qué se deriva' },
      },
      required: ['motivo'],
    },
  },
];

// ─── CONTEXTO DE EJECUCIÓN ────────────────────────────────────────────────────

export interface TenantAgentContext {
  botId: string;
  botName: string;
  /** Identificador del cliente: número de WhatsApp o etiqueta del canal web */
  clientId: string;
  /** Canal por el que llegó el mensaje */
  channel: 'whatsapp' | 'web' | 'widget';
  /** Salida lateral: imagen encontrada en Drive lista para enviar al cliente.
      El binario nunca viaja en el tool_result (reventaría el contexto del
      modelo); el canal la manda con twilioMessaging.sendImageMessage. */
  pendingImage?: { imageBase64: string; mimeType: string; fileName: string };
}

// ─── EXECUTOR DE TOOLS ────────────────────────────────────────────────────────

const toolSchemas = {
  buscar_en_documentos: { query: 'string' },
  buscar_archivos_drive: { query: 'string' },
  derivar_a_humano: { motivo: 'string' },
} as const;

function readStringField(input: unknown, field: string): string {
  const value = (input as Record<string, unknown> | null)?.[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Parámetro '${field}' inválido`);
  }
  return value.trim().slice(0, 500);
}

export async function executeTenantTool(
  toolName: string,
  input: unknown,
  context: TenantAgentContext,
): Promise<unknown> {
  if (!(toolName in toolSchemas)) {
    throw new Error(`Herramienta desconocida: ${toolName}`);
  }

  switch (toolName) {
    case 'buscar_en_documentos': {
      const query = readStringField(input, 'query');
      // Misma funcion que arma el contexto inicial del turno: una sola
      // definicion de TOP_K y del umbral para toda la plataforma
      const chunks = await getRelevantChunks(context.botId, query);
      if (chunks.length === 0) {
        return { found: false, message: 'No hay información sobre eso en los documentos del negocio.' };
      }
      return { found: true, fragmentos: chunks };
    }

    case 'buscar_archivos_drive': {
      const query = readStringField(input, 'query');
      const driveConn = await prisma.driveConnection.findUnique({
        where: { botId: context.botId },
      });
      if (!driveConn?.isActive) {
        return { found: false, message: 'No hay carpeta de Drive configurada para este bot.' };
      }

      try {
        const accessToken = await getValidAccessToken(driveConn);
        const match = await searchFileByName(accessToken, driveConn.folderName, query);
        if (!match) {
          return {
            found: false,
            message: `No encontré archivos relacionados con "${query}" en la carpeta ${driveConn.folderName}.`,
          };
        }

        const { data, mimeType } = await downloadFileAsBase64(accessToken, match.id);
        if (!mimeType.startsWith('image/')) {
          return { found: false, message: `"${match.name}" existe pero no es una imagen, no se puede enviar por este canal.` };
        }
        if (!isCloudinaryConfigured()) {
          return { found: false, message: 'El envío de imágenes no está disponible en este momento.' };
        }
        context.pendingImage = { imageBase64: data, mimeType, fileName: match.name };

        return {
          found: true,
          fileName: match.name,
          message: `Encontré "${match.name}". La imagen se envía junto con tu respuesta, no incluyas ningún link.`,
        };
      } catch (err) {
        console.error('[drive] Error buscando archivo:', err);
        return { found: false, message: 'Hubo un error accediendo a Drive. Intentá de nuevo.' };
      }
    }

    case 'derivar_a_humano': {
      const motivo = readStringField(input, 'motivo');
      const config = await prisma.notificationConfig.findUnique({
        where: { botId_event: { botId: context.botId, event: 'human_requested' } },
      });
      if (!config?.isActive) {
        return {
          derivado: false,
          message: 'El negocio no tiene notificaciones configuradas; decile al cliente que un encargado le va a responder por este mismo chat.',
        };
      }
      try {
        await sendEmail(
          config.email,
          'Tu bot derivó una conversación a un humano',
          `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:20px;font-weight:bold;color:#7C3AED;margin:0 0 20px;">BotForge</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
        El bot <strong>${context.botName}</strong> derivó una conversación a atención humana.
      </p>
      <p style="font-size:14px;color:#333;margin:0 0 4px;">Cliente: <strong>${context.clientId}</strong> (${context.channel})</p>
      <p style="font-size:14px;color:#333;margin:0 0 20px;">Motivo: "${motivo.slice(0, 300)}"</p>
      <a href="${env.FRONTEND_URL}/dashboard/conversations"
         style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:10px 24px;border-radius:8px;">
        Ver la conversación
      </a>
    </div>
  </body>
</html>`,
        );
        return { derivado: true, message: 'El encargado ya fue notificado por email. Avisale al cliente que en breve lo contacta una persona.' };
      } catch (err) {
        console.error('[tenantAgent] Error notificando derivación:', err);
        return { derivado: false, message: 'No se pudo notificar al encargado; decile al cliente que igual un encargado va a revisar el chat.' };
      }
    }

    default:
      throw new Error(`Herramienta desconocida: ${toolName}`);
  }
}

// ─── LOOP DE FUNCTION CALLING NATIVO ──────────────────────────────────────────

async function runFallback(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
): Promise<{ content: string; tokensUsed: number }> {
  console.warn(`[tenantAgent] ${PRIMARY_MODEL} devolvió refusal, reintentando con ${FALLBACK_MODEL}`);
  const response = await anthropic.messages.create({
    model: FALLBACK_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  return {
    content: textBlock?.type === 'text' ? textBlock.text : '',
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
}

/**
 * Ejecuta el loop completo de tool use de Anthropic para el bot desplegado.
 * Devuelve el texto final; las imágenes de Drive quedan en context.pendingImage.
 */
/**
 * Marcar el último tool cachea todo el bloque de definiciones (Anthropic
 * procesa tools → system → messages).
 */
const CACHED_TENANT_TOOLS: Anthropic.Tool[] = TENANT_TOOLS.map((tool, i) =>
  i === TENANT_TOOLS.length - 1
    ? { ...tool, cache_control: { type: 'ephemeral' as const } }
    : tool,
);

/**
 * Arma los bloques de system para la API. Acepta el prompt entero (string) o
 * ya partido: así los llamadores que todavía pasan un string siguen andando,
 * solo que sin caché útil.
 */
function toSystemBlocks(systemPrompt: string | TenantSystemBlocks): Anthropic.TextBlockParam[] {
  if (typeof systemPrompt === 'string') {
    return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
  }
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt.stable, cache_control: { type: 'ephemeral' } },
  ];
  if (systemPrompt.context) blocks.push({ type: 'text', text: systemPrompt.context });
  return blocks;
}

/** El fallback va sin caché: corre una sola vez, escribirlo sería puro costo */
function toPlainSystem(systemPrompt: string | TenantSystemBlocks): string {
  return typeof systemPrompt === 'string'
    ? systemPrompt
    : [systemPrompt.stable, systemPrompt.context].filter(Boolean).join('\n\n');
}

/**
 * Enganches opcionales para entregar la respuesta a medida que se genera.
 *
 * El loop es el MISMO con streaming y sin streaming: solo cambia si la ronda se
 * pide con messages.stream o con messages.create. Es a proposito — tener un
 * "motor para el panel" y otro "motor para WhatsApp" fue justamente el bug que
 * hacia que el dueño aprobara un comportamiento distinto al que veian sus
 * clientes.
 */
export interface TenantStreamHooks {
  onDelta: (text: string) => void;
  /**
   * El modelo escribio texto y despues decidio usar una herramienta. Ese texto
   * no es la respuesta final —en WhatsApp el cliente nunca lo ve, porque el
   * loop solo devuelve el texto de la ronda final— asi que el canal tiene que
   * descartar lo emitido en esa ronda.
   */
  onDiscard?: () => void;
  /** Para que el canal muestre en que esta trabajando el bot */
  onToolUse?: (toolName: string) => void;
  signal?: AbortSignal;
}

/** Una ronda del loop, con o sin streaming segun haya hooks */
async function runRound(
  systemBlocks: Anthropic.TextBlockParam[],
  messages: Anthropic.MessageParam[],
  stream?: TenantStreamHooks,
): Promise<{ response: Anthropic.Message; emitioTexto: boolean }> {
  const request = {
    model: PRIMARY_MODEL,
    max_tokens: 1024,
    system: systemBlocks,
    tools: CACHED_TENANT_TOOLS,
    messages,
  };

  if (!stream) {
    return { response: await anthropic.messages.create(request), emitioTexto: false };
  }

  let emitioTexto = false;
  const s = anthropic.messages.stream(request);
  stream.signal?.addEventListener('abort', () => s.abort());
  s.on('text', (text) => {
    emitioTexto = true;
    stream.onDelta(text);
  });
  return { response: await s.finalMessage(), emitioTexto };
}

export async function runTenantAgentLoop(
  systemPrompt: string | TenantSystemBlocks,
  history: TenantChatMessage[],
  userMessage: string,
  context: TenantAgentContext,
  stream?: TenantStreamHooks,
): Promise<{ content: string; tokensUsed: number }> {
  let currentMessages: Anthropic.MessageParam[] = [
    ...history.map((m): Anthropic.MessageParam => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];
  let tokensUsed = 0;
  const systemBlocks = toSystemBlocks(systemPrompt);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const { response, emitioTexto } = await runRound(systemBlocks, currentMessages, stream);
    tokensUsed += response.usage.input_tokens + response.usage.output_tokens;
    logCacheUsage('tenant', response.usage);

    // El SDK 0.36 no tipa 'refusal' todavia; llega en runtime con fable-5
    if ((response.stop_reason as string) === 'refusal') {
      if (emitioTexto) stream?.onDiscard?.();
      const fallback = await runFallback(toPlainSystem(systemPrompt), currentMessages);
      if (stream) stream.onDelta(fallback.content);
      return { content: fallback.content, tokensUsed: tokensUsed + fallback.tokensUsed };
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      // Lo que se haya emitido en esta ronda es razonamiento previo a la
      // herramienta, no la respuesta: se descarta para que el canal muestre
      // exactamente lo mismo que recibiria un cliente de WhatsApp
      if (emitioTexto) stream?.onDiscard?.();

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        stream?.onToolUse?.(toolUse.name);
        try {
          const result = await executeTenantTool(toolUse.name, toolUse.input, context);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: err instanceof Error ? err.message : 'Error ejecutando la herramienta' }),
            is_error: true,
          });
        }
      }

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ];
      continue;
    }

    // end_turn / max_tokens: devolver el texto acumulado
    const textBlock = response.content.find((b) => b.type === 'text');
    const content = textBlock?.type === 'text' ? textBlock.text : '';
    if (content) return { content, tokensUsed };
    break;
  }

  const agotado = 'Disculpá, no pude procesar tu consulta. ¿Podés escribirla de nuevo?';
  if (stream) stream.onDelta(agotado);
  return { content: agotado, tokensUsed };
}

// ─── PUNTO DE ENTRADA UNICO DEL BOT ───────────────────────────────────────────

export interface TenantTurnParams {
  bot: { id: string; name: string; personality: string; language: string };
  /** Historial ya ordenado del mas viejo al mas nuevo, sin el mensaje actual */
  history: TenantChatMessage[];
  /** Texto del cliente, ya transcripto y con el contexto de imagen si lo hubo */
  message: string;
  /** Numero de WhatsApp o etiqueta del canal, para las notificaciones */
  clientId: string;
  channel: 'whatsapp' | 'web' | 'widget';
  /** Si viene, la respuesta se entrega token a token */
  stream?: TenantStreamHooks;
}

export interface TenantTurnResult {
  content: string;
  tokensUsed: number;
  /** Imagen de Drive que el agente quiere adjuntar, si la hubo */
  pendingImage?: { imageBase64: string; mimeType: string; fileName: string };
}

/**
 * Un turno completo del bot desplegado: RAG, system prompt, tools y fallback.
 *
 * ESTA es la unica forma de hacer hablar al bot. WhatsApp, el Chat de prueba
 * del panel y el widget publico entran todos por aca, con los mismos
 * parametros: mismo modelo, mismas herramientas, mismo limite de rondas, mismo
 * umbral de RAG y mismo prompt. Si alguien necesita un comportamiento distinto
 * para un canal, va como parametro de esta funcion — nunca como una segunda
 * implementacion, que es como se llego a que el panel y WhatsApp respondieran
 * distinto sin que nadie se diera cuenta.
 *
 * Lo unico que NO hace es persistir mensajes ni tocar el cupo del plan: eso
 * depende del canal y lo resuelve cada llamador.
 */
export async function runTenantTurn(params: TenantTurnParams): Promise<TenantTurnResult> {
  const { bot, history, message, clientId, channel, stream } = params;

  const chunks = await getRelevantChunks(bot.id, message);
  // Bloques partidos: las reglas y la personalidad se cachean, el RAG no
  const systemPrompt = buildTenantSystemBlocks(
    bot.name, bot.personality, bot.language, chunks.join('\n\n'),
  );

  const context: TenantAgentContext = {
    botId: bot.id,
    botName: bot.name,
    clientId,
    channel,
  };

  const { content, tokensUsed } = await runTenantAgentLoop(
    systemPrompt, history, message, context, stream,
  );

  return { content, tokensUsed, pendingImage: context.pendingImage };
}
