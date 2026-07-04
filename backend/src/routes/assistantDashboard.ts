import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { LIMITS } from '../middleware/planLimits';
import { uploadRawToCloudinary } from '../config/cloudinary';
import { documentQueue } from '../lib/queue';
import { deleteChunksByIds } from '../services/pinecone';

const router = Router();

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const PRIMARY_MODEL = 'claude-fable-5';
const FALLBACK_MODEL = 'claude-opus-4-8';
const MAX_TOOL_ROUNDS = 5;

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
// Nota: los limites de planes vienen de planLimits.ts (unica fuente de verdad)

const SYSTEM_TEMPLATE = `Sos el asistente de BotForge. Ayudás a los usuarios a gestionar sus bots de WhatsApp, crear instructivos y resolver dudas sobre la plataforma.

CÓMO HABLÁS:
Hablás como una persona real de Paraguay. Usás "vos" siempre.
Directo, cálido y útil. Sin frases de apertura vacías como "Claro que sí", "Por supuesto", "Entendido, con gusto".
Respondés lo que te preguntan, sin rodeos.

Si algo es fácil, lo explicás simple.
Si algo es complejo, lo explicás paso a paso.
Transmitís confianza porque sabés lo que hacés.

FORMATO OBLIGATORIO:
Texto plano puro. Completamente prohibido usar: asteriscos simples o dobles, guiones como bullets, almohadillas para títulos, backticks, guiones bajos para énfasis, corchetes de markdown, o cualquier otro símbolo de formato.

Si necesitás listar cosas, usás punto y coma o las separás con comas en una oración natural.
Si necesitás dar pasos, escribís "Primero X, después Y, por último Z."
Párrafos cortos, máximo 3 líneas cada uno.
Nunca repitas saludos si ya saludaste antes. La interfaz YA le mostró al usuario un mensaje de bienvenida tuyo: nunca digas "Hola" ni te presentes, respondé directo desde tu primer mensaje.

CONOCIMIENTO DE LA PLATAFORMA:
BotForge permite crear bots de WhatsApp con IA. El negocio sube documentos o un instructivo, el bot aprende y responde solo a los clientes las 24 horas.

Planes disponibles:
Free: 0 Gs, 1 bot, 100 mensajes por mes, 3 documentos, solo chat web.
Básico: 150.000 Gs, 1 bot, 1.000 mensajes por mes, 10 documentos, WhatsApp incluido.
Profesional: 350.000 Gs, 5 bots, 10.000 mensajes por mes, 50 documentos, estadísticas avanzadas.
Agencia: 750.000 Gs, bots ilimitados, 100.000 mensajes por mes, todo incluido.

Flujo de uso:
Registrarse, crear un bot eligiendo una personalidad, subir el instructivo o generarlo con vos haciendo preguntas, conectar WhatsApp mandando el código BF-XXXXXX al número de Twilio, y el bot empieza a responder solo.

Tabs de cada bot:
Documentos para subir archivos, Chat de prueba para testear, Configuración para cambiar nombre e idioma, WhatsApp para conectar el número, Instructivo para generar con IA.

{BOT_CONTEXT}

CAPACIDADES:
Podés ejecutar acciones reales en la plataforma usando las herramientas disponibles. Cuando el usuario pida algo que podés hacer, lo ejecutás directamente.
Para acciones destructivas (borrar, desconectar) siempre pedís confirmación antes.
Nunca inventás resultados de herramientas: si necesitás datos, llamá a la herramienta.

CONSTRUCCIÓN DE INSTRUCTIVOS:
Cuando el usuario quiere crear el instructivo de su bot, lo guiás con preguntas de a una, adaptadas al rubro. Al terminar, generás el instructivo con la señal ===INSTRUCTIVO_LISTO=== seguida del texto completo en formato plano, con secciones en MAYUSCULAS. Después podés ofrecerte a subirlo directo al bot.

REGLA FINAL INNEGOCIABLE:
Antes de enviar cada respuesta, revisala mentalmente. Si tiene algún asterisco, guion como bullet, almohadilla o símbolo de markdown, lo eliminás y reescribís esa parte en texto plano.`;

// ─── TOOL REGISTRY ────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_bot_details',
    description: 'Obtiene información completa del bot actual incluyendo documentos, estado de WhatsApp y últimas conversaciones',
    input_schema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: 'ID del bot' },
      },
      required: ['botId'],
    },
  },
  {
    name: 'update_bot_config',
    description: 'Actualiza nombre, idioma, personalidad o estado activo/inactivo del bot. REQUIERE CONFIRMACIÓN del usuario antes de ejecutar.',
    input_schema: {
      type: 'object',
      properties: {
        botId: { type: 'string' },
        name: { type: 'string', description: 'Nuevo nombre del bot' },
        personality: { type: 'string', description: 'Nueva personalidad/instrucciones' },
        language: { type: 'string', enum: ['es', 'en', 'pt'] },
        isActive: { type: 'boolean', description: 'Activar o pausar el bot' },
      },
      required: ['botId'],
    },
  },
  {
    name: 'upload_instructivo_text',
    description: 'Sube un texto como documento de entrenamiento al bot. El texto debe estar completo y listo.',
    input_schema: {
      type: 'object',
      properties: {
        botId: { type: 'string' },
        filename: { type: 'string', description: 'Nombre del archivo, ej: instructivo-mi-negocio.txt' },
        content: { type: 'string', description: 'Contenido completo del instructivo' },
      },
      required: ['botId', 'filename', 'content'],
    },
  },
  {
    name: 'disconnect_whatsapp',
    description: 'Desconecta WhatsApp del bot. ACCIÓN DESTRUCTIVA — requiere confirmación explícita.',
    input_schema: {
      type: 'object',
      properties: {
        botId: { type: 'string' },
      },
      required: ['botId'],
    },
  },
  {
    name: 'get_account_stats',
    description: 'Obtiene estadísticas de la cuenta: mensajes hoy/mes/total, conversaciones, uso del plan',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_conversations',
    description: 'Obtiene el historial de conversaciones del usuario con preview de cada una',
    input_schema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: 'Filtrar por bot específico (opcional)' },
        page: { type: 'number', description: 'Página (default 1)' },
      },
      required: [],
    },
  },
  {
    name: 'send_notification_email',
    description: 'Configura una notificación por email cuando ocurre un evento específico del bot',
    input_schema: {
      type: 'object',
      properties: {
        botId: { type: 'string' },
        event: {
          type: 'string',
          enum: ['human_requested', 'new_conversation', 'daily_summary'],
          description: 'human_requested: cuando el cliente pide hablar con humano; new_conversation: cada nueva conversación; daily_summary: resumen diario',
        },
        email: { type: 'string', description: 'Email donde enviar las notificaciones' },
      },
      required: ['botId', 'event', 'email'],
    },
  },
  {
    name: 'create_new_bot',
    description: 'Crea un nuevo bot con configuración básica',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        language: { type: 'string', enum: ['es', 'en', 'pt'] },
        personality: { type: 'string' },
      },
      required: ['name', 'language', 'personality'],
    },
  },
  {
    name: 'delete_document',
    description: 'Elimina un documento del bot. ACCIÓN DESTRUCTIVA — requiere confirmación.',
    input_schema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        botId: { type: 'string' },
      },
      required: ['documentId', 'botId'],
    },
  },
  {
    name: 'request_plan_upgrade',
    description: 'Inicia el proceso de upgrade de plan. Muestra info del plan objetivo y link de pago.',
    input_schema: {
      type: 'object',
      properties: {
        targetPlan: {
          type: 'string',
          enum: ['STARTER', 'PRO', 'AGENCY'],
          description: 'STARTER=Gs150k, PRO=Gs350k, AGENCY=Gs750k',
        },
      },
      required: ['targetPlan'],
    },
  },
];

// Tools que requieren confirmación explícita del usuario antes de ejecutar
const DESTRUCTIVE_TOOLS = new Set(['update_bot_config', 'disconnect_whatsapp', 'delete_document']);

function confirmMessage(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'update_bot_config': {
      const cambios = Object.entries(input)
        .filter(([k, v]) => k !== 'botId' && v !== undefined)
        .map(([k, v]) => `${k}: ${typeof v === 'string' && v.length > 80 ? `${v.slice(0, 80)}...` : String(v)}`)
        .join(' · ');
      return `Se va a actualizar la configuración del bot (${cambios || 'sin cambios'}).`;
    }
    case 'disconnect_whatsapp':
      return 'Se va a desconectar WhatsApp del bot. Dejará de responder mensajes por ese canal hasta que lo vuelvas a conectar.';
    case 'delete_document':
      return 'Se va a eliminar el documento y sus datos de entrenamiento. El bot dejará de conocer esa información. Esta acción no se puede deshacer.';
    default:
      return `Se va a ejecutar la acción ${tool}.`;
  }
}

// ─── VALIDADORES DE INPUT POR TOOL ────────────────────────────────────────────

const toolInputSchemas = {
  get_bot_details: z.object({ botId: z.string().min(1) }),
  update_bot_config: z.object({
    botId: z.string().min(1),
    name: z.string().min(1).max(100).optional(),
    personality: z.string().min(10).max(5000).optional(),
    language: z.enum(['es', 'en', 'pt']).optional(),
    isActive: z.boolean().optional(),
  }),
  upload_instructivo_text: z.object({
    botId: z.string().min(1),
    filename: z.string().min(1).max(120),
    content: z.string().min(20).max(200000),
  }),
  disconnect_whatsapp: z.object({ botId: z.string().min(1) }),
  get_account_stats: z.object({}),
  get_conversations: z.object({
    botId: z.string().optional(),
    page: z.number().int().min(1).optional(),
  }),
  send_notification_email: z.object({
    botId: z.string().min(1),
    event: z.enum(['human_requested', 'new_conversation', 'daily_summary']),
    email: z.string().email(),
  }),
  create_new_bot: z.object({
    name: z.string().min(1).max(100),
    language: z.enum(['es', 'en', 'pt']),
    personality: z.string().min(10).max(5000),
  }),
  delete_document: z.object({ documentId: z.string().min(1), botId: z.string().min(1) }),
  request_plan_upgrade: z.object({ targetPlan: z.enum(['STARTER', 'PRO', 'AGENCY']) }),
} as const;

type ToolName = keyof typeof toolInputSchemas;

// ─── EJECUCIÓN DE TOOLS (con verificación de propiedad SIEMPRE) ──────────────

async function getOwnedBot(botId: string, userId: string) {
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Ese bot no pertenece a tu cuenta');
  return bot;
}

async function executeToolCall(
  toolName: string,
  rawInput: unknown,
  userId: string,
): Promise<unknown> {
  if (!(toolName in toolInputSchemas)) {
    throw new Error(`Herramienta desconocida: ${toolName}`);
  }
  const name = toolName as ToolName;
  const parsed = toolInputSchemas[name].safeParse(rawInput ?? {});
  if (!parsed.success) {
    throw new Error(`Parámetros inválidos para ${name}: ${parsed.error.issues.map((i) => i.message).join(', ')}`);
  }

  switch (name) {
    case 'get_bot_details': {
      const { botId } = parsed.data as z.infer<typeof toolInputSchemas.get_bot_details>;
      const bot = await getOwnedBot(botId, userId);
      const [docs, connections, conversations] = await Promise.all([
        prisma.document.findMany({
          where: { botId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, name: true, status: true, fileSize: true, createdAt: true },
        }),
        prisma.whatsAppConnection.findFirst({
          where: { botId, status: 'ACTIVE' },
          select: { phoneNumber: true, status: true },
        }),
        prisma.conversation.findMany({
          where: { botId },
          orderBy: { updatedAt: 'desc' },
          take: 3,
          include: {
            _count: { select: { messages: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, role: true } },
          },
        }),
      ]);
      return {
        bot: {
          id: bot.id,
          name: bot.name,
          language: bot.language,
          isActive: bot.isActive,
          whatsappNumber: bot.whatsappNumber,
          personality: bot.personality,
        },
        documents: docs,
        whatsappConnection: connections,
        recentConversations: conversations.map((c) => ({
          channel: c.channel,
          messages: c._count.messages,
          lastMessage: c.messages[0]?.content.slice(0, 120) ?? null,
        })),
      };
    }

    case 'update_bot_config': {
      const input = parsed.data as z.infer<typeof toolInputSchemas.update_bot_config>;
      await getOwnedBot(input.botId, userId);
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.personality !== undefined) data.personality = input.personality;
      if (input.language !== undefined) data.language = input.language;
      if (input.isActive !== undefined) data.isActive = input.isActive;
      if (Object.keys(data).length === 0) return { updated: false, reason: 'No se indicó ningún cambio' };
      const updated = await prisma.bot.update({ where: { id: input.botId }, data });
      return {
        updated: true,
        bot: { id: updated.id, name: updated.name, language: updated.language, isActive: updated.isActive },
      };
    }

    case 'upload_instructivo_text': {
      const input = parsed.data as z.infer<typeof toolInputSchemas.upload_instructivo_text>;
      const bot = await getOwnedBot(input.botId, userId);

      // Limite de documentos del plan
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const docCount = await prisma.document.count({ where: { botId: bot.id } });
      const limit = LIMITS[user.plan].docsPerBot;
      if (docCount >= limit) {
        throw new Error(`Límite de documentos alcanzado (${docCount}/${limit} del plan ${user.plan}). Eliminá alguno o mejorá el plan.`);
      }

      const safeName = path.basename(input.filename).replace(/[^a-zA-Z0-9._-]/g, '-');
      const finalName = safeName.endsWith('.txt') ? safeName : `${safeName}.txt`;
      const docId = uuidv4();
      const filePath = path.join(env.UPLOADS_DIR, `${docId}.txt`);
      await fs.mkdir(env.UPLOADS_DIR, { recursive: true });
      await fs.writeFile(filePath, input.content, 'utf-8');

      let doc = await prisma.document.create({
        data: {
          id: docId,
          botId: bot.id,
          name: finalName,
          mimeType: 'text/plain',
          filePath,
          fileSize: Buffer.byteLength(input.content, 'utf-8'),
          status: 'PENDING',
        },
      });

      const url = await uploadRawToCloudinary(filePath, doc.id);
      if (url) {
        doc = await prisma.document.update({ where: { id: doc.id }, data: { url } });
        try { await fs.unlink(filePath); } catch { /* limpieza best-effort */ }
      }

      await documentQueue.add({ documentId: doc.id });
      return { uploaded: true, documentId: doc.id, name: doc.name, status: doc.status, note: 'El documento se está procesando; en 1-2 minutos queda listo.' };
    }

    case 'disconnect_whatsapp': {
      const { botId } = parsed.data as z.infer<typeof toolInputSchemas.disconnect_whatsapp>;
      const bot = await getOwnedBot(botId, userId);
      if (!bot.whatsappNumber) return { disconnected: false, reason: 'El bot no tiene WhatsApp conectado' };
      await prisma.whatsAppConnection.updateMany({
        where: { botId: bot.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });
      await prisma.bot.update({ where: { id: bot.id }, data: { whatsappNumber: null } });
      return { disconnected: true, previousNumber: bot.whatsappNumber };
    }

    case 'get_account_stats': {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [user, totalBots, totalConversations, readyDocs, messagesToday, monthlyMessages, totalMessages] =
        await Promise.all([
          prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true, messagesUsedThisMonth: true } }),
          prisma.bot.count({ where: { userId } }),
          prisma.conversation.count({ where: { bot: { userId } } }),
          prisma.document.count({ where: { bot: { userId }, status: 'READY' } }),
          prisma.message.count({ where: { role: 'ASSISTANT', createdAt: { gte: startOfToday }, conversation: { bot: { userId } } } }),
          prisma.message.count({ where: { role: 'ASSISTANT', createdAt: { gte: startOfMonth }, conversation: { bot: { userId } } } }),
          prisma.message.count({ where: { role: 'ASSISTANT', conversation: { bot: { userId } } } }),
        ]);

      const limits = LIMITS[user.plan];
      return {
        plan: user.plan,
        monthlyLimit: limits.monthlyMessages,
        messagesUsedThisMonth: user.messagesUsedThisMonth,
        messagesToday,
        monthlyMessages,
        totalMessages,
        totalBots,
        totalConversations,
        readyDocs,
      };
    }

    case 'get_conversations': {
      const input = parsed.data as z.infer<typeof toolInputSchemas.get_conversations>;
      if (input.botId) await getOwnedBot(input.botId, userId);
      const page = input.page ?? 1;
      const take = 10;
      const conversations = await prisma.conversation.findMany({
        where: { bot: { userId }, ...(input.botId ? { botId: input.botId } : {}) },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * take,
        take,
        include: {
          bot: { select: { name: true } },
          _count: { select: { messages: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, role: true } },
        },
      });
      return {
        page,
        conversations: conversations.map((c) => ({
          id: c.id,
          bot: c.bot.name,
          channel: c.channel,
          messages: c._count.messages,
          updatedAt: c.updatedAt,
          preview: c.messages[0]?.content.slice(0, 120) ?? null,
        })),
      };
    }

    case 'send_notification_email': {
      const input = parsed.data as z.infer<typeof toolInputSchemas.send_notification_email>;
      await getOwnedBot(input.botId, userId);
      const config = await prisma.notificationConfig.upsert({
        where: { botId_event: { botId: input.botId, event: input.event } },
        create: {
          id: uuidv4(),
          userId,
          botId: input.botId,
          event: input.event,
          email: input.email,
          isActive: true,
        },
        update: { email: input.email, isActive: true },
      });
      const note =
        input.event === 'human_requested'
          ? 'Notificación activa: cuando un cliente pida hablar con una persona, llega un email.'
          : 'Configuración guardada. Este tipo de evento se activará próximamente.';
      return { configured: true, event: config.event, email: config.email, note };
    }

    case 'create_new_bot': {
      const input = parsed.data as z.infer<typeof toolInputSchemas.create_new_bot>;
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: { _count: { select: { bots: true } } },
      });
      const limit = LIMITS[user.plan].bots;
      if (user._count.bots >= limit) {
        throw new Error(`Límite de bots alcanzado (${user._count.bots}/${limit} del plan ${user.plan}). Mejorá el plan para crear más.`);
      }
      const bot = await prisma.bot.create({
        data: { id: uuidv4(), userId, name: input.name, language: input.language, personality: input.personality },
      });
      return { created: true, bot: { id: bot.id, name: bot.name, language: bot.language }, url: `/dashboard/bots/${bot.id}` };
    }

    case 'delete_document': {
      const input = parsed.data as z.infer<typeof toolInputSchemas.delete_document>;
      await getOwnedBot(input.botId, userId);
      const doc = await prisma.document.findUnique({ where: { id: input.documentId } });
      if (!doc || doc.botId !== input.botId) throw new Error('Documento no encontrado en ese bot');
      const chunks = await prisma.chunk.findMany({
        where: { documentId: doc.id },
        select: { pineconeId: true },
      });
      await deleteChunksByIds(chunks.map((c) => c.pineconeId));
      try { await fs.unlink(doc.filePath); } catch { /* puede no existir */ }
      await prisma.document.delete({ where: { id: doc.id } });
      return { deleted: true, name: doc.name };
    }

    case 'request_plan_upgrade': {
      const input = parsed.data as z.infer<typeof toolInputSchemas.request_plan_upgrade>;
      const info = {
        STARTER: { label: 'Básico', price: 'Gs. 150.000/mes', incluye: '1 bot, 1.000 mensajes/mes, 10 documentos por bot, WhatsApp' },
        PRO: { label: 'Profesional', price: 'Gs. 350.000/mes', incluye: '5 bots, 10.000 mensajes/mes, 50 documentos por bot, WhatsApp + estadísticas' },
        AGENCY: { label: 'Agencia', price: 'Gs. 750.000/mes', incluye: 'Bots ilimitados, 100.000 mensajes/mes, documentos ilimitados, soporte prioritario' },
      }[input.targetPlan];
      return {
        targetPlan: input.targetPlan,
        ...info,
        checkoutUrl: '/pricing',
        note: 'El pago se completa desde /pricing con el botón Contratar del plan elegido.',
      };
    }
  }
}

// ─── CONTEXTO DEL BOT ─────────────────────────────────────────────────────────

async function buildBotContext(botId: string, userId: string): Promise<string> {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    include: {
      documents: { select: { name: true, status: true } },
      whatsappConnections: { where: { status: 'ACTIVE' }, select: { phoneNumber: true }, take: 1 },
      conversations: {
        orderBy: { updatedAt: 'desc' },
        take: 3,
        include: {
          _count: { select: { messages: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, role: true } },
        },
      },
    },
  });

  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Acceso denegado');

  const personalityBrief =
    bot.personality.length > 200 ? `${bot.personality.slice(0, 200)}...` : bot.personality;
  const langLabel = bot.language === 'es' ? 'español' : bot.language === 'pt' ? 'portugués' : 'inglés';
  const readyDocs = bot.documents.filter((d) => d.status === 'READY').length;

  let context = `CONTEXTO DEL BOT ACTUAL (botId: ${bot.id}):
Bot '${bot.name}' (${personalityBrief}).
Estado: ${bot.isActive ? 'activo' : 'pausado'}. Idioma: ${langLabel}.
Documentos: ${bot.documents.length} (${readyDocs} listos)${bot.documents.length > 0 ? ` — ${bot.documents.map((d) => `${d.name} [${d.status}]`).join(', ')}` : ''}.
WhatsApp: ${bot.whatsappNumber ? `conectado (${bot.whatsappNumber})` : 'no conectado'}.`;

  const previews = bot.conversations
    .map((c) => {
      const last = c.messages[0];
      if (!last) return null;
      return `- [${c.channel}] ${c._count.messages} mensajes, último (${last.role === 'USER' ? 'cliente' : 'bot'}): ${last.content.slice(0, 100)}`;
    })
    .filter((p): p is string => p !== null);
  if (previews.length > 0) context += `\nÚltimas conversaciones:\n${previews.join('\n')}`;

  return context;
}

// ─── RATE LIMIT ───────────────────────────────────────────────────────────────

const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // requireAuth corre antes, asi que userId siempre esta presente
  keyGenerator: (req: Request) => req.user?.userId ?? 'anon',
  message: {
    data: null,
    error: { code: 'RATE_LIMIT', message: 'Demasiados mensajes, esperá un momento' },
    meta: null,
  },
});

// ─── SCHEMA DEL REQUEST ───────────────────────────────────────────────────────

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        // string (texto) o array de content blocks (turnos con tool_use/tool_result)
        content: z.union([z.string().min(1).max(200000), z.array(z.record(z.unknown())).min(1)]),
      }),
    )
    .min(1)
    .max(80)
    .refine((msgs) => msgs[0].role === 'user', {
      message: 'El primer mensaje debe ser del usuario',
    }),
  botId: z.string().uuid().optional(),
  image: z
    .object({
      data: z.string().min(1).max(8_000_000),
      mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    })
    .optional(),
  // IDs de tool_use destructivos que el usuario confirmó explícitamente
  confirmedToolUseIds: z.array(z.string()).max(10).optional(),
});

type ChatInput = z.infer<typeof chatSchema>;

function buildAnthropicMessages(
  messages: ChatInput['messages'],
  image: ChatInput['image'],
): Anthropic.MessageParam[] {
  return messages.map((m, i): Anthropic.MessageParam => {
    if (typeof m.content !== 'string') {
      return { role: m.role, content: m.content as unknown as Anthropic.MessageParam['content'] };
    }
    if (image && i === messages.length - 1 && m.role === 'user') {
      return {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
          { type: 'text', text: m.content },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

// ─── ENDPOINT ─────────────────────────────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  dashboardLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    let streaming = false;
    try {
      const { messages, botId, image, confirmedToolUseIds } = chatSchema.parse(req.body);
      const userId = req.user!.userId;

      const botContext = botId
        ? await buildBotContext(botId, userId)
        : 'CONTEXTO DEL BOT ACTUAL:\nEl usuario no tiene ningún bot seleccionado. Si necesita operar sobre un bot, podés listar sus bots con get_conversations/get_account_stats o pedirle que abra el asistente desde la página del bot.';

      const systemText = SYSTEM_TEMPLATE.replace('{BOT_CONTEXT}', botContext);
      const anthropicMessages = buildAnthropicMessages(messages, image);
      const confirmed = new Set(confirmedToolUseIds ?? []);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      streaming = true;

      const send = (payload: unknown) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      const finish = () => {
        send({ type: 'done' });
        res.end();
      };

      let aborted = false;
      req.on('close', () => { aborted = true; });

      // Ejecuta los tool_use de un turno assistant y devuelve los tool_results
      const runTools = async (
        toolUses: Anthropic.ToolUseBlock[],
      ): Promise<Anthropic.ToolResultBlockParam[]> => {
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          send({ type: 'tool_start', tool: tu.name, input: tu.input });
          try {
            const result = await executeToolCall(tu.name, tu.input, userId);
            send({ type: 'tool_end', tool: tu.name, success: true, result });
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error desconocido';
            send({ type: 'tool_end', tool: tu.name, success: false, result: msg });
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${msg}`, is_error: true });
          }
        }
        return results;
      };

      let rounds = 0;
      while (rounds < MAX_TOOL_ROUNDS && !aborted) {
        rounds++;

        // Caso de reanudación tras confirmación: la conversación termina en un
        // turno assistant con tool_use pendientes → ejecutarlos primero
        const last = anthropicMessages[anthropicMessages.length - 1];
        if (
          last.role === 'assistant' &&
          Array.isArray(last.content) &&
          last.content.some((b) => (b as { type?: string }).type === 'tool_use')
        ) {
          const pending = (last.content as Anthropic.ContentBlock[]).filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          );
          const unconfirmed = pending.find((t) => DESTRUCTIVE_TOOLS.has(t.name) && !confirmed.has(t.id));
          if (unconfirmed) {
            send({
              type: 'confirm_required',
              toolUseId: unconfirmed.id,
              tool: unconfirmed.name,
              input: unconfirmed.input,
              message: confirmMessage(unconfirmed.name, unconfirmed.input as Record<string, unknown>),
            });
            finish();
            return;
          }
          const results = await runTools(pending);
          anthropicMessages.push({ role: 'user', content: results });
          continue;
        }

        const stream = anthropic.messages.stream({
          model: PRIMARY_MODEL,
          max_tokens: 4096,
          system: systemText,
          tools: TOOLS,
          messages: anthropicMessages,
        });

        req.on('close', () => stream.abort());
        stream.on('text', (text) => send({ type: 'text', text }));

        const finalMessage = await stream.finalMessage();

        if ((finalMessage.stop_reason as string) === 'refusal') {
          console.warn(`[assistant-dashboard] ${PRIMARY_MODEL} devolvió refusal, reintentando con ${FALLBACK_MODEL}`);
          const fallback = await anthropic.messages.create({
            model: FALLBACK_MODEL,
            max_tokens: 4096,
            system: systemText,
            messages: anthropicMessages.filter((m) => typeof m.content === 'string'),
          });
          const block = fallback.content[0];
          send({ type: 'text', text: block?.type === 'text' ? block.text : '' });
          break;
        }

        if (finalMessage.stop_reason !== 'tool_use') break;

        const toolUses = finalMessage.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );

        // Tool destructiva sin confirmar: cortar el turno y pedir confirmación.
        // Se mandan los content blocks para que el frontend pueda reanudar.
        const unconfirmed = toolUses.find((t) => DESTRUCTIVE_TOOLS.has(t.name) && !confirmed.has(t.id));
        if (unconfirmed) {
          send({ type: 'assistant_blocks', blocks: finalMessage.content });
          send({
            type: 'confirm_required',
            toolUseId: unconfirmed.id,
            tool: unconfirmed.name,
            input: unconfirmed.input,
            message: confirmMessage(unconfirmed.name, unconfirmed.input as Record<string, unknown>),
          });
          finish();
          return;
        }

        const results = await runTools(toolUses);
        anthropicMessages.push({ role: 'assistant', content: finalMessage.content });
        anthropicMessages.push({ role: 'user', content: results });
      }

      finish();
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) {
        res.end();
        return;
      }
      if (streaming) {
        console.error('[assistant-dashboard] error durante el stream:', err);
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'text', text: 'Ocurrió un error, intentá de nuevo.' })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          res.end();
        }
        return;
      }
      next(err);
    }
  },
);

export default router;
