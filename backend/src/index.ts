import './config/env';
import './jobs/processDocument';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import cron from 'node-cron';
import path from 'path';
import fs from 'fs';

import { env } from './config/env';
import { globalLimiter } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';

import authRouter from './routes/auth';
import botsRouter from './routes/bots';
import documentsRouter from './routes/documents';
import chatRouter from './routes/chat';
import whatsappRouter from './routes/whatsapp';
import metaWhatsappRouter from './routes/metaWhatsapp';
import stripeRouter from './routes/stripe';
import pagoparRouter from './routes/pagopar';
import publicRouter from './routes/public';
import assistantRouter from './routes/assistant';
import assistantDashboardRouter from './routes/assistantDashboard';
import testRouter from './routes/test';
import statsRouter from './routes/stats';
import activityRouter from './routes/activity';
import driveRouter, { googleOAuthRouter } from './routes/drive';
import devRouter from './routes/dev';
import { requireAuth } from './middleware/auth';
import { generateDailySummaries } from './services/dailySummary';
import { downgradeExpiredPlans, notifyExpiringSoon } from './services/planExpiration';

const uploadsDir = path.resolve(env.UPLOADS_DIR);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();

// Stripe dado de baja: Pagopar es la pasarela activa. El codigo queda intacto
// para poder volver atras; solo se desmontan las rutas.
// Stripe webhook necesita el raw body ANTES de express.json()
// app.post(
//   '/api/v1/stripe/webhook',
//   express.raw({ type: 'application/json' }),
//   (req, res, next) => { void stripeRouter(req, res, next); },
// );
void stripeRouter;

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Whitelist explicita, nunca '*': las requests viajan con credentials y el
// navegador rechaza el comodin cuando se mandan cookies.
// La URL de Railway esta mientras dura la transicion de DNS a mibotforge.com;
// para sacarla despues alcanza con borrar la linea o usar CORS_EXTRA_ORIGINS.
const ALLOWED_ORIGINS = new Set(
  [
    env.FRONTEND_URL,
    'https://protective-kindness-production-024f.up.railway.app',
    'http://localhost:3000',
    ...env.CORS_EXTRA_ORIGINS.split(','),
  ]
    // El header Origin nunca trae barra final: sin normalizar, un FRONTEND_URL
    // escrito como "https://mibotforge.com/" no matchearia nunca
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Sin header Origin: curl, el healthcheck de Railway y los webhooks de
      // Meta, Twilio y Pagopar. No son requests de navegador, CORS no aplica.
      if (!origin || ALLOWED_ORIGINS.has(origin)) {
        callback(null, true);
        return;
      }
      // false en vez de un Error: no manda los headers de CORS (el navegador
      // bloquea, que es lo correcto) sin convertir la request en un 500.
      console.warn(`[cors] Origen rechazado: ${origin}`);
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(globalLimiter);
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// 10mb: las imagenes del asistente llegan como base64 en el body (~6.7mb max)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ data: { status: 'ok', timestamp: new Date().toISOString() }, error: null, meta: null });
});

// Rutas autenticadas
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/bots', botsRouter);
app.use('/api/v1/bots/:botId/documents', documentsRouter);
app.use('/api/v1/bots/:botId/chat', chatRouter);
// Meta Cloud API: solo define GET /webhook. Va antes del router de Twilio para
// que el GET lo resuelva Meta; el POST /webhook cae al router de Twilio.
app.use('/api/v1/whatsapp', metaWhatsappRouter);
app.use('/api/v1/whatsapp', whatsappRouter);
// app.use('/api/v1/stripe', stripeRouter);
app.use('/api/v1/pagopar', pagoparRouter);
app.use('/api/v1/stats', statsRouter);
app.use('/api/v1/activity', activityRouter);
app.use('/api/v1/drive', requireAuth, driveRouter);
app.use('/api/v1/dev', devRouter);

// Rutas públicas (widget embebido)
app.use('/api/v1/public', publicRouter);

// Callback OAuth2 de Google (público: la identidad viaja en el state firmado)
app.use('/api/auth/google', googleOAuthRouter);

// Asistente del dashboard (autenticado) — registrar antes que el público
app.use('/api/v1/assistant/dashboard', assistantDashboardRouter);

// Asistente Aria de la landing (público)
app.use('/api/v1/assistant', assistantRouter);

if (env.NODE_ENV !== 'production') {
  app.use('/api/v1/test', testRouter);
}

app.use(errorHandler);

// Resumen diario por email: todos los días a las 21:00 hora Paraguay.
// El .catch garantiza que un fallo del cron nunca tire abajo el servidor.
cron.schedule(
  '0 21 * * *',
  () => {
    generateDailySummaries().catch((err) =>
      console.error('[dailySummary] Error en el cron:', err),
    );
  },
  { timezone: 'America/Asuncion' },
);

// Vencimiento de planes: todos los días a las 03:00 hora Paraguay (bajo tráfico).
// Primero avisa a los que están por vencer y después degrada a los ya vencidos,
// en ese orden para no avisarle a alguien que en la misma corrida pasa a Free.
// Ninguna de las dos lanza, pero el .catch cubre un fallo inesperado del cron.
cron.schedule(
  '0 3 * * *',
  () => {
    void (async () => {
      try {
        await notifyExpiringSoon();
        await downgradeExpiredPlans();
      } catch (err) {
        console.error('[planExpiration] Error en el cron:', err);
      }
    })();
  },
  { timezone: 'America/Asuncion' },
);

app.listen(env.PORT, () => {
  console.log(`BotForge backend en http://localhost:${env.PORT} [${env.NODE_ENV}]`);
});

export default app;
