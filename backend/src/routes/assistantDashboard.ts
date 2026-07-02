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

const SYSTEM_TEMPLATE = `Sos el Asistente BotForge, un experto en configuración de chatbots de IA para negocios latinoamericanos. Tu rol principal es ayudar a los usuarios a crear el instructivo de entrenamiento perfecto para su bot, pero también resolvés cualquier duda sobre la plataforma.

CONTEXTO DEL BOT ACTUAL (si está disponible):
{BOT_CONTEXT}

TUS CAPACIDADES:
1. CREAR INSTRUCTIVO: Podés generar el instructivo completo de entrenamiento para el bot. Para hacerlo bien, primero indagá con preguntas específicas según el rubro. Hacé las preguntas de a una, esperando cada respuesta. Cuando tengas suficiente info, generá el instructivo completo en formato de texto plano.

   El instructivo siempre debe incluir:
   - Presentación del negocio y misión del bot
   - Catálogo completo de productos/servicios con precios
   - Horarios, zona de cobertura y formas de pago
   - Políticas de cambio y garantía
   - Tono y personalidad del bot
   - Respuestas a preguntas frecuentes
   - Cuándo y cómo derivar a un humano
   - Información adicional relevante del rubro

   Cuando el instructivo esté listo, indicá claramente con la línea: ===INSTRUCTIVO_LISTO=== seguido del instructivo completo.

2. RESOLVER DUDAS sobre BotForge:
   - Cómo subir documentos al bot
   - Cómo conectar WhatsApp
   - Por qué el bot no responde bien
   - Cómo mejorar las respuestas
   - Diferencias entre los planes

3. DIAGNÓSTICO: Si el usuario dice que su bot no responde bien, preguntá qué tipo de preguntas le hacen y sugerí mejoras concretas al instructivo.

ESTILO:
- Español rioplatense/paraguayo usando 'vos'
- Directo y útil, sin relleno
- Preguntas cortas y específicas
- Nunca más de 4 líneas por mensaje salvo el instructivo final
- Sin signos de apertura al inicio de frases`;

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
        content: z.string().min(1).max(6000),
      }),
    )
    .min(1)
    .max(60)
    .refine((msgs) => msgs[0].role === 'user', {
      message: 'El primer mensaje debe ser del usuario',
    }),
  botId: z.string().uuid().optional(),
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

  let context = `El usuario está trabajando con el bot '${bot.name}' (${personalityBrief}).
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

// POST /api/v1/assistant/dashboard — autenticado, responde por SSE
router.post(
  '/',
  requireAuth,
  dashboardLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    let streaming = false;
    try {
      const { messages, botId } = chatSchema.parse(req.body);

      const botContext = botId
        ? await buildBotContext(botId, req.user!.userId)
        : 'El usuario no tiene ningún bot seleccionado actualmente.';

      const systemText = SYSTEM_TEMPLATE.replace('{BOT_CONTEXT}', botContext);

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
        messages,
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
          messages,
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
