import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { getFilesFromFolder, getValidAccessToken } from '../services/googleDrive';

const router = Router();

// ─── OAUTH2 DE GOOGLE DRIVE ───────────────────────────────────────────────────

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const OAUTH_STATE_TTL = '10m';

function oauthRedirectUri(): string {
  return `${env.BACKEND_URL}/api/auth/google/callback`;
}

function newOAuthClient() {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, oauthRedirectUri());
}

interface OAuthState {
  botId: string;
  userId: string;
  purpose: 'drive_oauth';
}

async function getOwnedBot(botId: string, userId: string) {
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Acceso denegado');
  return bot;
}

// GET /api/v1/drive/bots/:botId/authorize — genera la URL de consentimiento
router.get('/bots/:botId/authorize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bot = await getOwnedBot(req.params.botId, req.user!.userId);

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new AppError(503, 'Google Drive no está configurado en el servidor');
    }

    // state firmado: el callback verifica que nadie interceptó el flujo
    const state = jwt.sign(
      { botId: bot.id, userId: req.user!.userId, purpose: 'drive_oauth' } satisfies OAuthState,
      env.JWT_SECRET,
      { expiresIn: OAUTH_STATE_TTL },
    );

    const authUrl = newOAuthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // fuerza refresh_token también en re-autorizaciones
      scope: [DRIVE_SCOPE],
      state,
    });

    res.json({ data: { authUrl }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/drive/bots/:botId/status — estado de la conexión (sin tokens)
router.get('/bots/:botId/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bot = await getOwnedBot(req.params.botId, req.user!.userId);
    const connection = await prisma.driveConnection.findUnique({
      where: { botId: bot.id },
      select: { folderName: true, isActive: true, createdAt: true },
    });
    res.json({
      data: connection
        ? { connected: connection.isActive, folderName: connection.folderName, since: connection.createdAt }
        : { connected: false, folderName: null, since: null },
      error: null,
      meta: null,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/drive/bots/:botId/folder — cambia la carpeta del catálogo
const folderSchema = z.object({ folderName: z.string().min(1).max(100) });

router.patch('/bots/:botId/folder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bot = await getOwnedBot(req.params.botId, req.user!.userId);
    const { folderName } = folderSchema.parse(req.body);

    const connection = await prisma.driveConnection.findUnique({ where: { botId: bot.id } });
    if (!connection) throw new AppError(404, 'Este bot no tiene Google Drive conectado');

    // Verifica que la carpeta nueva exista antes de guardar
    const accessToken = await getValidAccessToken(connection);
    let files;
    try {
      files = await getFilesFromFolder(accessToken, folderName);
    } catch (err) {
      throw new AppError(400, err instanceof Error ? err.message : 'No se pudo acceder a esa carpeta');
    }

    await prisma.driveConnection.update({ where: { id: connection.id }, data: { folderName } });
    res.json({ data: { folderName, files: files.length }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

const connectSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  folderName: z.string().min(1).max(100).default('catálogo'),
});

// POST /api/v1/drive/bots/:botId/connect — vincula la carpeta de Drive del bot
router.post('/bots/:botId/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bot = await getOwnedBot(req.params.botId, req.user!.userId);
    const { accessToken, refreshToken, folderName } = connectSchema.parse(req.body);

    // Verificacion real de acceso antes de guardar
    let files;
    try {
      files = await getFilesFromFolder(accessToken, folderName);
    } catch (err) {
      throw new AppError(
        400,
        err instanceof Error ? err.message : 'No se pudo acceder a la carpeta de Drive',
      );
    }

    await prisma.driveConnection.upsert({
      where: { botId: bot.id },
      create: {
        id: uuidv4(),
        botId: bot.id,
        accessToken,
        refreshToken,
        folderName,
        isActive: true,
      },
      update: { accessToken, refreshToken, folderName, isActive: true },
    });

    res.json({ data: { connected: true, folderName, files }, error: null, meta: { total: files.length } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/drive/bots/:botId/disconnect — desvincula la carpeta de Drive
router.delete('/bots/:botId/disconnect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bot = await getOwnedBot(req.params.botId, req.user!.userId);
    const deleted = await prisma.driveConnection.deleteMany({ where: { botId: bot.id } });
    if (deleted.count === 0) {
      throw new AppError(404, 'Este bot no tiene Google Drive conectado');
    }
    res.json({ data: { disconnected: true }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/drive/bots/:botId/files — lista archivos de la carpeta configurada
router.get('/bots/:botId/files', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bot = await getOwnedBot(req.params.botId, req.user!.userId);

    const connection = await prisma.driveConnection.findUnique({ where: { botId: bot.id } });
    if (!connection?.isActive) {
      throw new AppError(404, 'Este bot no tiene Google Drive conectado');
    }

    const accessToken = await getValidAccessToken(connection);
    const files = await getFilesFromFolder(accessToken, connection.folderName);
    res.json({ data: files, error: null, meta: { total: files.length, folderName: connection.folderName } });
  } catch (err) {
    next(err);
  }
});

export default router;

// ─── CALLBACK PÚBLICO DE GOOGLE ───────────────────────────────────────────────
// Google redirige acá sin Authorization header: la identidad viene en el
// state firmado. Se monta en /api/auth/google (index.ts), fuera de /api/v1.

export const googleOAuthRouter = Router();

googleOAuthRouter.get('/callback', async (req: Request, res: Response) => {
  const fail = (botId?: string) => {
    const target = botId
      ? `${env.FRONTEND_URL}/dashboard/bots/${botId}?drive=error`
      : `${env.FRONTEND_URL}/dashboard?drive=error`;
    res.redirect(target);
  };

  let state: OAuthState | null = null;
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const rawState = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !rawState) return fail();

    state = jwt.verify(rawState, env.JWT_SECRET) as OAuthState;
    if (state.purpose !== 'drive_oauth') return fail();

    // La propiedad se re-verifica: el state podría ser de otro usuario
    const bot = await prisma.bot.findUnique({ where: { id: state.botId } });
    if (!bot || bot.userId !== state.userId) return fail(state.botId);

    const { tokens } = await newOAuthClient().getToken(code);
    if (!tokens.access_token) return fail(state.botId);

    const existing = await prisma.driveConnection.findUnique({ where: { botId: bot.id } });
    // Google solo manda refresh_token en el primer consent; conservar el previo
    const refreshToken = tokens.refresh_token ?? existing?.refreshToken;
    if (!refreshToken) return fail(state.botId);

    await prisma.driveConnection.upsert({
      where: { botId: bot.id },
      create: {
        id: uuidv4(),
        botId: bot.id,
        accessToken: tokens.access_token,
        refreshToken,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        isActive: true,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        isActive: true,
      },
    });

    res.redirect(`${env.FRONTEND_URL}/dashboard/bots/${bot.id}?drive=connected`);
  } catch (err) {
    // Nunca loguear tokens: solo el tipo de error
    console.error('[drive-oauth] Callback falló:', err instanceof Error ? err.message : 'error desconocido');
    fail(state?.botId);
  }
});
