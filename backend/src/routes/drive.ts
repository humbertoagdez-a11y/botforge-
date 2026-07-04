import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { getFilesFromFolder } from '../services/googleDrive';

const router = Router();

async function getOwnedBot(botId: string, userId: string) {
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Acceso denegado');
  return bot;
}

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

// GET /api/v1/drive/bots/:botId/files — lista archivos de la carpeta configurada
router.get('/bots/:botId/files', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bot = await getOwnedBot(req.params.botId, req.user!.userId);

    const connection = await prisma.driveConnection.findUnique({ where: { botId: bot.id } });
    if (!connection?.isActive) {
      throw new AppError(404, 'Este bot no tiene Google Drive conectado');
    }

    const files = await getFilesFromFolder(connection.accessToken, connection.folderName);
    res.json({ data: files, error: null, meta: { total: files.length, folderName: connection.folderName } });
  } catch (err) {
    next(err);
  }
});

export default router;
