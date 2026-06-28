import './config/env';
import './jobs/processDocument';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
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
import stripeRouter from './routes/stripe';
import publicRouter from './routes/public';
import testRouter from './routes/test';
import statsRouter from './routes/stats';

const uploadsDir = path.resolve(env.UPLOADS_DIR);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();

// Stripe webhook necesita el raw body ANTES de express.json()
app.post(
  '/api/v1/stripe/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => { void stripeRouter(req, res, next); },
);

app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(globalLimiter);
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
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
app.use('/api/v1/whatsapp', whatsappRouter);
app.use('/api/v1/stripe', stripeRouter);
app.use('/api/v1/stats', statsRouter);

// Rutas públicas (widget embebido)
app.use('/api/v1/public', publicRouter);

if (env.NODE_ENV !== 'production') {
  app.use('/api/v1/test', testRouter);
}

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`BotForge backend en http://localhost:${env.PORT} [${env.NODE_ENV}]`);
});

export default app;
