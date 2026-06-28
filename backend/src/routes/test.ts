import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';

const router = Router();

const storage = multer.diskStorage({
  destination: env.UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `test-${uuidv4()}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/upload', (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(400, `Multer error: ${err.message}`));
    }
    if (err) return next(err);
    if (!req.file) return next(new AppError(400, 'No se recibió ningún archivo'));

    res.json({
      data: {
        originalName: req.file.originalname,
        savedAs: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype,
        path: req.file.path,
      },
      error: null,
      meta: null,
    });
  });
});

export default router;
