import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const PRIMARY_MODEL = 'claude-fable-5';
const FALLBACK_MODEL = 'claude-opus-4-8';

const SYSTEM_TEMPLATE = `Sos el Asistente BotForge, el soporte técnico y consultor experto de la plataforma BotForge. Tu función es resolver absolutamente cualquier problema o duda que tenga el usuario.

CONTEXTO DE LA PLATAFORMA:
BotForge permite crear chatbots de IA conectados a WhatsApp.
El flujo completo es:
1. Registrarse en /auth/register
2. Crear un bot en el dashboard (nombre, idioma, personalidad)
3. Subir documentos o generar un instructivo con el wizard
4. Conectar WhatsApp desde el tab WhatsApp del bot
5. El bot empieza a responder solo

Secciones del dashboard:
- Mis Bots: lista y gestión de bots
- Conversaciones: historial de chats del bot
- Estadísticas: métricas de uso
- Perfil: datos y contraseña
- Planes: Free/Básico/Profesional/Agencia
- Asistente: este chat (vos)

Cada bot tiene tabs:
- Documentos: subir archivos que el bot aprende
- Chat de prueba: probar el bot antes de conectar WhatsApp
- Configuración: cambiar nombre, idioma, personalidad
- WhatsApp: conectar el número via código de verificación
- Instructivo: wizard guiado o subir archivo propio

{BOT_CONTEXT}

TUS CAPACIDADES:

1. GENERAR INSTRUCTIVO COMPLETO:
   Cuando el usuario quiere crear el instructivo de su bot, hacé preguntas específicas de a una para conocer:
   - Nombre y rubro del negocio
   - Productos/servicios con precios si los tiene
   - Horarios de atención
   - Zona/ciudad y política de envíos
   - Formas de pago (incluir Tigo Money, Billetera Personal, QR Bancard si aplica)
   - Política de cambios/devoluciones
   - Diferencial del negocio
   - Tono preferido (formal/cercano/divertido)
   - Preguntas frecuentes que recibe
   - Cuándo derivar a un humano

   Cuando tengas suficiente info, generá el instructivo con la línea ===INSTRUCTIVO_LISTO=== seguida del texto completo.

   El instructivo debe ser extenso y detallado, cubriendo todos los escenarios posibles del negocio. Sin markdown, sin asteriscos, solo texto plano con secciones en MAYUSCULAS.

2. SOPORTE TÉCNICO PASO A PASO:
   Para cualquier problema con la plataforma, guiá al usuario con pasos numerados claros. Si adjunta una captura de pantalla, identificá exactamente qué ve y qué tiene que hacer.

   Problemas comunes y sus soluciones:
   - Bot no responde en WhatsApp: verificar que WhatsApp esté conectado en el tab WhatsApp, que el número mandó el código de verificación, y que el documento esté en estado LISTO
   - El bot responde mal: mejorar el instructivo con más detalle sobre los casos que maneja mal
   - Error 401: la sesión expiró, hay que volver a iniciar sesión
   - Documento en estado PROCESANDO: esperar 1-2 minutos, es normal
   - No llega el código de verificación WhatsApp: el código expira en 10 minutos, generar uno nuevo desde el tab WhatsApp

3. CONSULTOR DE NEGOCIO:
   Podés aconsejar sobre cómo optimizar el bot según el rubro, qué información incluir en el instructivo, cómo responder mejor ciertos tipos de clientes, etc.

4. ANÁLISIS DE IMÁGENES:
   Si el usuario adjunta una imagen (captura de pantalla de la plataforma, de su negocio, o de cualquier otra cosa), analizala con detalle y respondé en base a lo que ves. Si es una captura de BotForge, identificá exactamente en qué sección está y orientalo paso a paso. Si es una imagen de su negocio (local, menú, productos), usala para enriquecer el instructivo que estás armando.

COMPORTAMIENTO:
- Siempre hablás de vos, nunca de usted
- Mensajes cortos (3-4 líneas) salvo el instructivo final
- Nunca decís 'Como asistente de IA' ni frases robóticas
- Si no sabés algo específico de la cuenta del usuario, pedile que te cuente más o que adjunte una captura
- Terminás cada respuesta con una pregunta o acción concreta
- Nunca repetís el saludo si ya saludaste antes`;

const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
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

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(20000),
      }),
    )
    .min(1)
    .max(60)
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
});

async function buildBotContext(botId: string, userId: string): Promise<string> {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    include: {
      _count: { select: { documents: true } },
      conversations: {
        orderBy: { updatedAt: 'desc' },
        take: 3,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, role: true },
          },
        },
      },
    },
  });

  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Acceso denegado');

  const personalityBrief =
    bot.personality.length > 200 ? `${bot.personality.slice(0, 200)}...` : bot.personality;

  const langLabel =
    bot.language === 'es' ? 'español' : bot.language === 'pt' ? 'portugués' : 'inglés';

  let context = `CONTEXTO DEL BOT ACTUAL:
El usuario está trabajando con el bot '${bot.name}' (${personalityBrief}).
Tiene ${bot._count.documents} documento${bot._count.documents === 1 ? '' : 's'} cargado${bot._count.documents === 1 ? '' : 's'}.
WhatsApp: ${bot.whatsappNumber ? `conectado (${bot.whatsappNumber})` : 'no conectado'}.
Idioma: ${langLabel}.`;

  const previews = bot.conversations
    .map((c) => {
      const last = c.messages[0];
      if (!last) return null;
      const who = last.role === 'USER' ? 'cliente' : 'bot';
      const text = last.content.length > 120 ? `${last.content.slice(0, 120)}...` : last.content;
      return `- [${c.channel}] último mensaje (${who}): ${text}`;
    })
    .filter((p): p is string => p !== null);

  if (previews.length > 0) {
    context += `\nÚltimas conversaciones del bot:\n${previews.join('\n')}`;
  }

  return context;
}

type ChatInput = z.infer<typeof chatSchema>;

function buildAnthropicMessages(
  messages: ChatInput['messages'],
  image: ChatInput['image'],
): Anthropic.MessageParam[] {
  return messages.map((m, i): Anthropic.MessageParam => {
    // La imagen adjunta se agrega como content block al ultimo mensaje del usuario
    if (image && i === messages.length - 1 && m.role === 'user') {
      return {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType, data: image.data },
          },
          { type: 'text', text: m.content },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

// POST /api/v1/assistant/dashboard — autenticado, responde por SSE
router.post(
  '/',
  requireAuth,
  dashboardLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    let streaming = false;
    try {
      const { messages, botId, image } = chatSchema.parse(req.body);

      const botContext = botId
        ? await buildBotContext(botId, req.user!.userId)
        : 'CONTEXTO DEL BOT ACTUAL:\nEl usuario no tiene ningún bot seleccionado actualmente.';

      const systemText = SYSTEM_TEMPLATE.replace('{BOT_CONTEXT}', botContext);
      const anthropicMessages = buildAnthropicMessages(messages, image);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      streaming = true;

      const send = (payload: unknown) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      const stream = anthropic.messages.stream({
        model: PRIMARY_MODEL,
        max_tokens: 4096,
        system: systemText,
        messages: anthropicMessages,
      });

      req.on('close', () => stream.abort());

      stream.on('text', (text) => send({ text }));

      const finalMessage = await stream.finalMessage();

      if ((finalMessage.stop_reason as string) === 'refusal') {
        console.warn(`[assistant-dashboard] ${PRIMARY_MODEL} devolvió refusal, reintentando con ${FALLBACK_MODEL}`);
        const fallback = await anthropic.messages.create({
          model: FALLBACK_MODEL,
          max_tokens: 4096,
          system: systemText,
          messages: anthropicMessages,
        });
        const block = fallback.content[0];
        send({ text: block?.type === 'text' ? block.text : '' });
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) {
        res.end();
        return;
      }
      if (streaming) {
        console.error('[assistant-dashboard] error durante el stream:', err);
        res.write(`data: ${JSON.stringify({ error: 'Ocurrió un error, intentá de nuevo' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      next(err);
    }
  },
);

export default router;
