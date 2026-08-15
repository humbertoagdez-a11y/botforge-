/**
 * Imagenes que el bot le manda a los clientes por WhatsApp.
 *
 * Reemplaza el caso de uso que iba a cubrir Google Drive (catalogos, fotos de
 * producto, menus) sin depender de la verificacion de Google: el dueño las sube
 * directo y quedan en Cloudinary, que es donde igual terminaban las de Drive
 * antes de mandarse.
 *
 * El envio NO se implementa aca: lo resuelve la herramienta enviar_imagen del
 * agente tenant, que reusa el mismo mecanismo que ya existia.
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary';
import { LIMITS, PLAN_LIMIT_CODE, effectivePlan } from '../middleware/planLimits';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireVerifiedEmail);

const MAX_BYTES = 5 * 1024 * 1024;
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * En memoria y no en disco: la imagen va derecho a Cloudinary, nunca se
 * procesa localmente. En Railway el disco es efímero, así que escribirla
 * primero solo sumaría un archivo que hay que limpiar.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (TIPOS_PERMITIDOS.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new AppError(400, 'Formato no soportado. Subí una imagen JPG, PNG o WEBP.'));
  },
});

/** Multer corta por tamaño con su propio error; se traduce a uno del producto */
function manejarErrorDeSubida(
  err: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (err instanceof Error && 'code' in err && err.code === 'LIMIT_FILE_SIZE') {
    next(new AppError(400, 'La imagen no puede pesar más de 5 MB.'));
    return;
  }
  next(err);
}

async function getOwnedBot(botId: string, userId: string) {
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Ese bot no pertenece a tu cuenta');
  return bot;
}

/** Cupo de imágenes del plan vigente (un plan vencido vale FREE) */
async function limiteDelPlan(userId: string): Promise<{ limite: number; plan: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
  const plan = effectivePlan(user);
  return { limite: LIMITS[plan].imagesPerBot, plan };
}

const metaSchema = z.object({
  name: z.string().trim().min(2, 'Poné un nombre de al menos 2 caracteres').max(60),
  description: z
    .string()
    .trim()
    .min(10, 'La descripción tiene que ser más específica: es lo que el bot usa para elegir la imagen')
    .max(500),
});

// ─── GET / — listar ───────────────────────────────────────────────────────────
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await getOwnedBot(req.params.botId, userId);
      const { limite, plan } = await limiteDelPlan(userId);

      const images = await prisma.botImage.findMany({
        where: { botId: req.params.botId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, name: true, description: true, url: true,
          mimeType: true, fileSize: true, createdAt: true,
        },
      });

      res.json({
        data: {
          images,
          plan,
          // Infinity no sobrevive a JSON.stringify: viaja como null
          limit: Number.isFinite(limite) ? limite : null,
          used: images.length,
        },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  })();
});

// ─── POST / — subir ───────────────────────────────────────────────────────────
router.post(
  '/',
  upload.single('file'),
  manejarErrorDeSubida,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const userId = req.user!.userId;
        const bot = await getOwnedBot(req.params.botId, userId);

        const { limite, plan } = await limiteDelPlan(userId);
        if (limite === 0) {
          throw new AppError(
            403,
            'Las imágenes están disponibles desde el plan Básico. Actualizá tu plan para que tu bot pueda mandarle fotos a tus clientes.',
            PLAN_LIMIT_CODE,
            { limit: 0, used: 0, plan, feature: 'images' },
          );
        }

        const usadas = await prisma.botImage.count({ where: { botId: bot.id } });
        if (usadas >= limite) {
          throw new AppError(
            403,
            `Llegaste al límite de ${limite} imágenes de tu plan ${plan}. Borrá alguna o mejorá el plan.`,
            PLAN_LIMIT_CODE,
            { limit: limite, used: usadas, plan, feature: 'images' },
          );
        }

        if (!req.file) throw new AppError(400, 'Falta el archivo de la imagen');
        // El fileFilter ya filtró, pero el mimetype lo declara el cliente:
        // se revalida acá para no confiar en lo que mandó el navegador
        if (!TIPOS_PERMITIDOS.includes(req.file.mimetype)) {
          throw new AppError(400, 'Formato no soportado. Subí una imagen JPG, PNG o WEBP.');
        }
        if (req.file.size > MAX_BYTES) {
          throw new AppError(400, 'La imagen no puede pesar más de 5 MB.');
        }

        const parsed = metaSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(400, 'Datos inválidos', 'VALIDATION_ERROR', parsed.error.flatten());
        }

        if (!isCloudinaryConfigured()) {
          throw new AppError(503, 'El almacenamiento de imágenes no está disponible en este momento.');
        }

        const id = uuidv4();
        const publicId = `botforge/bot-images/img_${id}`;
        const subida = await cloudinary.uploader.upload(
          `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`,
          {
            public_id: publicId,
            resource_type: 'image',
            // Meta descarga la imagen de esta URL: se acota el tamaño para que
            // baje rápido sin que se note en el teléfono del cliente
            transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto:good' }],
          },
        );

        const image = await prisma.botImage.create({
          data: {
            id,
            botId: bot.id,
            name: parsed.data.name,
            description: parsed.data.description,
            url: subida.secure_url,
            publicId: subida.public_id,
            mimeType: req.file.mimetype,
            fileSize: subida.bytes ?? req.file.size,
          },
          select: {
            id: true, name: true, description: true, url: true,
            mimeType: true, fileSize: true, createdAt: true,
          },
        });

        res.status(201).json({ data: image, error: null, meta: null });
      } catch (err) {
        next(err);
      }
    })();
  },
);

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      const bot = await getOwnedBot(req.params.botId, userId);

      // El botId va en el where: un id de imagen de otro bot no matchea
      const image = await prisma.botImage.findFirst({
        where: { id: req.params.id, botId: bot.id },
      });
      if (!image) throw new AppError(404, 'Imagen no encontrada');

      if (isCloudinaryConfigured()) {
        try {
          await cloudinary.uploader.destroy(image.publicId, { resource_type: 'image' });
        } catch (err) {
          // Que quede huérfana en Cloudinary es preferible a dejarla visible
          // en el panel: el borrado en la base sigue igual
          console.error('[images] No se pudo borrar de Cloudinary:', err);
        }
      }

      await prisma.botImage.delete({ where: { id: image.id } });

      res.json({ data: { deleted: true }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  })();
});

export default router;
