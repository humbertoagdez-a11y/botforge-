import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

const router = Router();

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const PRIMARY_MODEL = 'claude-fable-5';
const FALLBACK_MODEL = 'claude-opus-4-8';

const ARIA_SYSTEM = `Sos Aria, la asistente virtual de BotForge, una plataforma paraguaya de chatbots con IA para WhatsApp. Tu mision es ayudar a los visitantes del sitio web a entender el producto, responder sus dudas y orientarlos hacia el plan que mejor se adapta a su negocio.

Sobre BotForge:
- Permite crear bots de IA conectados a WhatsApp en minutos
- El cliente sube documentos con info de su negocio
- El bot aprende y responde solo, 24 horas, 7 dias
- Funciona para: restaurantes, clinicas, tiendas, peluquerias, inmobiliarias, academias, y cualquier negocio
- Planes: Free (Gs 0), Basico (Gs 150.000), Profesional (Gs 350.000), Agencia (Gs 750.000)
- Se conecta al WhatsApp actual del cliente en 2 minutos
- No requiere conocimientos tecnicos
- Impulsado por Claude AI de Anthropic
- Desarrollado en Paraguay para negocios de LATAM

Tu estilo:
- Hablás en español rioplatense/paraguayo, usando 'vos'
- Sos amigable, concisa y orientada a resolver dudas reales
- Despues de responder, siempre ofreces el siguiente paso natural
- Si el visitante muestra interes, los orientas hacia /auth/register
- Sin signos de apertura al inicio de frases
- Sin emojis en las respuestas
- Mensajes de 2 a 4 lineas, directos y utiles

Cuando no sepas algo especifico sobre BotForge, decis honestamente que lo van a poder confirmar registrandose o contactando al equipo.`;

const assistantLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
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
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(40)
    .refine((msgs) => msgs[0].role === 'user', {
      message: 'El primer mensaje debe ser del usuario',
    }),
});

async function callFallback(messages: Anthropic.MessageParam[]): Promise<string> {
  const response = await anthropic.messages.create({
    model: FALLBACK_MODEL,
    max_tokens: 1024,
    system: [{ type: 'text', text: ARIA_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  const block = response.content[0];
  return block?.type === 'text' ? block.text : '';
}

// POST /api/v1/assistant/chat — publico, responde por SSE
router.post('/chat', assistantLimiter, async (req: Request, res: Response, next: NextFunction) => {
  let streaming = false;
  try {
    const { messages } = chatSchema.parse(req.body);

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
      max_tokens: 1024,
      system: [{ type: 'text', text: ARIA_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages,
    });

    req.on('close', () => stream.abort());

    stream.on('text', (text) => send({ text }));

    const finalMessage = await stream.finalMessage();

    if ((finalMessage.stop_reason as string) === 'refusal') {
      console.warn(`[assistant] ${PRIMARY_MODEL} devolvió refusal, reintentando con ${FALLBACK_MODEL}`);
      const fallbackText = await callFallback(messages);
      send({ text: fallbackText });
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) {
      res.end();
      return;
    }
    if (streaming) {
      console.error('[assistant] error durante el stream:', err);
      res.write(`data: ${JSON.stringify({ error: 'Ocurrió un error, intentá de nuevo' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    next(err);
  }
});

export default router;
