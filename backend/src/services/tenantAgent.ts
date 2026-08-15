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

/** Lo mínimo que el modelo necesita para elegir una imagen */
export interface ImagenDisponible {
  id: string;
  name: string;
  description: string;
}

export function buildTenantSystemBlocks(
  botName: string,
  personality: string,
  language: string,
  documentsContent: string,
  imagenes: ImagenDisponible[] = [],
): TenantSystemBlocks {
  return {
    stable: buildTenantStablePrompt(botName, personality, language, imagenes),
    context: documentsContent
      ? `INFORMACIÓN DEL NEGOCIO Y BASE DE CONOCIMIENTO:
${documentsContent}`
      : '',
  };
}

/**
 * Catálogo de imágenes para el prompt. Va en el bloque ESTABLE, no en el de
 * contexto: cambia por bot pero es idéntico en todos los mensajes de ese bot,
 * que es justo la condición para que el caché sirva. Si fuera al bloque
 * variable se reescribiría en cada mensaje sin acertar nunca.
 *
 * Va la descripción, no la URL: la URL no le sirve al modelo para decidir y
 * solo gastaría tokens. El envío lo resuelve la herramienta contra la base.
 */
function bloqueImagenes(imagenes: ImagenDisponible[]): string {
  if (imagenes.length === 0) return '';
  const lista = imagenes
    .map((i) => `- id: ${i.id} | ${i.name}: ${i.description}`)
    .join('\n');
  return `

IMÁGENES QUE PODÉS ENVIAR:
Tenés estas imágenes cargadas. Cuando el cliente pida ver algo que coincida con una de estas descripciones, mandásela con la herramienta enviar_imagen usando su id. No inventes ids ni prometas imágenes que no estén en esta lista.
${lista}`;
}

/** Parte cacheable: todo lo que no depende del mensaje puntual */
export function buildTenantStablePrompt(
  botName: string,
  personality: string,
  language: string,
  imagenes: ImagenDisponible[] = [],
): string {
  return `${buildTenantSystemPrompt(botName, personality, language, '')}${bloqueImagenes(imagenes)}`;
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

const TOOL_ENVIAR_IMAGEN: Anthropic.Tool = {
  name: 'enviar_imagen',
  description:
    'Envía una imagen al cliente cuando la conversación lo amerite: pidió ver un producto, un catálogo, un menú, o cualquier cosa que tengas como imagen disponible. Revisá las descripciones de las imágenes disponibles en tu contexto para elegir la correcta. Si ninguna corresponde a lo que pidió, no uses esta herramienta.',
  input_schema: {
    type: 'object',
    properties: {
      imageId: {
        type: 'string',
        description: 'El id de la imagen a enviar, tal como figura en la lista de imágenes disponibles',
      },
    },
    required: ['imageId'],
  },
};

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

/**
 * Herramientas que ve ESTE bot.
 *
 * La lista es por bot y no global por dos motivos:
 *
 * - `enviar_imagen` solo tiene sentido si el dueño subió imágenes. Ofrecérsela
 *   a un bot sin imágenes es invitarlo a llamarla para que le devuelvan "no hay
 *   ninguna", gastando una ronda.
 * - `buscar_archivos_drive` tiene casi la misma descripción que `enviar_imagen`
 *   ("fotos de productos, el menú, el catálogo"). Con las dos presentes el
 *   modelo elige medio al azar, y como Drive quedó fuera de la hoja de ruta,
 *   la mayoría de los bots no la tiene conectada. Se muestra solo si el bot
 *   realmente tiene Drive activo.
 *
 * No afecta el prompt caching: para un bot dado la lista es idéntica en todos
 * sus mensajes, igual que el bloque estable del system. Cambia cuando el dueño
 * sube o borra una imagen, que es exactamente cuando el prompt también cambia.
 */
export function buildTenantTools(opts: {
  tieneImagenes: boolean;
  driveActivo: boolean;
}): Anthropic.Tool[] {
  const tools = [TENANT_TOOLS[0]]; // buscar_en_documentos, siempre
  if (opts.driveActivo) tools.push(TENANT_TOOLS[1]);
  if (opts.tieneImagenes) tools.push(TOOL_ENVIAR_IMAGEN);
  tools.push(TENANT_TOOLS[2]); // derivar_a_humano, siempre al final

  // El cache_control va en la ÚLTIMA herramienta: marca el corte del bloque
  // entero de definiciones (Anthropic procesa tools → system → messages)
  return tools.map((tool, i) =>
    i === tools.length - 1
      ? { ...tool, cache_control: { type: 'ephemeral' as const } }
      : tool,
  );
}

// ─── CONTEXTO DE EJECUCIÓN ────────────────────────────────────────────────────

export interface TenantAgentContext {
  botId: string;
  botName: string;
  /** Identificador del cliente: número de WhatsApp o etiqueta del canal web */
  clientId: string;
  /** Canal por el que llegó el mensaje */
  channel: 'whatsapp' | 'web' | 'widget';
  /** Salida lateral: imagen lista para enviarle al cliente. El binario nunca
      viaja en el tool_result (reventaría el contexto del modelo); el canal la
      manda con su propio sendPendingImage. */
  pendingImage?: PendingImage;
}

/**
 * Imagen que el agente decidió mandarle al cliente.
 *
 * Dos origenes con el mismo destino: las que el dueño subio al panel ya viven
 * en Cloudinary y solo hace falta pasar la URL, mientras que las de Drive se
 * bajan como binario y hay que hospedarlas primero. El canal resuelve cual
 * usar; ninguno de los dos caminos duplica el envio.
 */
export type PendingImage =
  | { source: 'url'; url: string; caption: string }
  | { source: 'base64'; imageBase64: string; mimeType: string; caption: string };

// ─── EXECUTOR DE TOOLS ────────────────────────────────────────────────────────

const toolSchemas = {
  buscar_en_documentos: { query: 'string' },
  buscar_archivos_drive: { query: 'string' },
  enviar_imagen: { imageId: 'string' },
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
        context.pendingImage = { source: 'base64', imageBase64: data, mimeType, caption: match.name };

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

    case 'enviar_imagen': {
      const imageId = readStringField(input, 'imageId');
      // Se lee de la base filtrando por botId: aunque el modelo alucine un id,
      // nunca puede mandar una imagen de otro negocio
      const imagen = await prisma.botImage.findFirst({
        where: { id: imageId, botId: context.botId },
        select: { id: true, name: true, url: true },
      });
      if (!imagen) {
        return {
          enviada: false,
          message: 'Esa imagen no existe. Revisá la lista de imágenes disponibles en tu contexto y usá uno de esos ids.',
        };
      }

      // El canal la manda al entregar la respuesta, con el mismo mecanismo que
      // ya usaba Drive. La URL de Cloudinary va directo: no se vuelve a subir.
      context.pendingImage = { source: 'url', url: imagen.url, caption: imagen.name };

      return {
        enviada: true,
        nombre: imagen.name,
        message: `La imagen "${imagen.name}" se envía junto con tu respuesta. No incluyas ningún link ni describas la imagen: el cliente la va a ver.`,
      };
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
 * Fallback si el llamador no arma la lista por bot. Equivale a un bot sin
 * imágenes y sin Drive, que es el caso más común.
 */
const CACHED_TENANT_TOOLS = buildTenantTools({ tieneImagenes: false, driveActivo: false });

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
  tools: Anthropic.Tool[],
  stream?: TenantStreamHooks,
): Promise<{ response: Anthropic.Message; emitioTexto: boolean }> {
  const request = {
    model: PRIMARY_MODEL,
    max_tokens: 1024,
    system: systemBlocks,
    tools,
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
  /** Herramientas de ESTE bot. Sin esto, las del bot más simple. */
  tools: Anthropic.Tool[] = CACHED_TENANT_TOOLS,
): Promise<{ content: string; tokensUsed: number }> {
  let currentMessages: Anthropic.MessageParam[] = [
    ...history.map((m): Anthropic.MessageParam => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];
  let tokensUsed = 0;
  const systemBlocks = toSystemBlocks(systemPrompt);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const { response, emitioTexto } = await runRound(systemBlocks, currentMessages, tools, stream);
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
  /** Imagen que el agente quiere adjuntar a esta respuesta, si la hubo */
  pendingImage?: PendingImage;
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

  const [chunks, imagenes, drive] = await Promise.all([
    getRelevantChunks(bot.id, message),
    prisma.botImage.findMany({
      where: { botId: bot.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, description: true },
    }),
    prisma.driveConnection.findUnique({
      where: { botId: bot.id },
      select: { isActive: true },
    }),
  ]);

  // Bloques partidos: reglas, personalidad e imágenes se cachean; el RAG no
  const systemPrompt = buildTenantSystemBlocks(
    bot.name, bot.personality, bot.language, chunks.join('\n\n'), imagenes,
  );
  const tools = buildTenantTools({
    tieneImagenes: imagenes.length > 0,
    driveActivo: Boolean(drive?.isActive),
  });

  const context: TenantAgentContext = {
    botId: bot.id,
    botName: bot.name,
    clientId,
    channel,
  };

  const { content, tokensUsed } = await runTenantAgentLoop(
    systemPrompt, history, message, context, stream, tools,
  );

  return { content, tokensUsed, pendingImage: context.pendingImage };
}
