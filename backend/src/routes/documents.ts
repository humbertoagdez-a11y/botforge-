import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { env } from '../config/env';
import { documentQueue } from '../lib/queue';
import { deleteChunksByIds } from '../services/pinecone';
import { checkDocLimit } from '../middleware/planLimits';

const router = Router({ mergeParams: true });

router.use(requireAuth);

const storage = multer.diskStorage({
  destination: env.UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/plain',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(400, 'Tipo de archivo no soportado. Use PDF, Word, Excel o TXT.'));
    }
  },
});

async function getOwnedBot(botId: string, userId: string) {
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Acceso denegado');
  return bot;
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOwnedBot(req.params.botId, req.user!.userId);
    const docs = await prisma.document.findMany({
      where: { botId: req.params.botId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
    res.json({ data: docs, error: null, meta: { total: docs.length } });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  checkDocLimit,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return next(new AppError(400, `Error al subir archivo: ${err.message}`));
      }
      next(err);
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new AppError(400, 'No se recibió ningún archivo');
      await getOwnedBot(req.params.botId, req.user!.userId);

      const doc = await prisma.document.create({
        data: {
          id: uuidv4(),
          botId: req.params.botId,
          name: req.file.originalname,
          mimeType: req.file.mimetype,
          filePath: req.file.path,
          fileSize: req.file.size,
          status: 'PENDING',
        },
      });

      await documentQueue.add({ documentId: doc.id });
      res.status(201).json({ data: doc, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/:docId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOwnedBot(req.params.botId, req.user!.userId);
    const doc = await prisma.document.findUnique({ where: { id: req.params.docId } });
    if (!doc || doc.botId !== req.params.botId) throw new AppError(404, 'Documento no encontrado');

    const chunks = await prisma.chunk.findMany({
      where: { documentId: req.params.docId },
      select: { pineconeId: true },
    });
    await deleteChunksByIds(chunks.map((c) => c.pineconeId));
    await prisma.document.delete({ where: { id: req.params.docId } });
    res.json({ data: { ok: true }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

export default router;
