/**
 * Perfil de negocio de WhatsApp de cada bot (foto, descripcion, direccion,
 * email, sitios web, categoria).
 *
 * Vive aparte de bots.ts, que ya es grande, y aparte de whatsapp.ts, que se
 * ocupa de CONECTAR el numero: esto es "como te ven tus clientes".
 *
 * El phone-number-id sale SIEMPRE de Bot.metaPhoneNumberId, nunca de
 * env.META_PHONE_NUMBER_ID: esa variable es global y escribiria el perfil del
 * numero equivocado.
 *
 * Los tres endpoints hacen lo mismo en el mismo orden: pertenencia del bot,
 * despues numero conectado, despues integracion disponible, y recien ahi la
 * logica propia.
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { isMetaConfigured } from '../services/metaMessaging';
import {
  VERTICALES,
  getBusinessProfile,
  setProfilePictureHandle,
  updateBusinessProfile,
  uploadProfilePicture,
} from '../services/metaBusinessProfile';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireVerifiedEmail);

/** Meta rechaza cualquier foto de mas de 5MB. Se corta antes de leerla entera. */
const MAX_FOTO_BYTES = 5 * 1024 * 1024;
/** Lado del cuadrado que espera Meta. Es tambien el maximo que acepta. */
const LADO_FOTO = 640;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FOTO_BYTES },
});

/**
 * Los servicios de Graph lanzan Error comun con el detalle de Meta adentro.
 * Sin esto el errorHandler los convierte en "Error interno del servidor" y el
 * usuario no se entera de que paso. El token nunca viaja en esos mensajes:
 * describeError() solo lee el cuerpo del error que devuelve Meta.
 */
async function conErrorLegible<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion();
  } catch (err) {
    if (err instanceof AppError) throw err;
    const detalle = err instanceof Error ? err.message : 'Error desconocido';
    throw new AppError(502, detalle, 'META_PERFIL_ERROR');
  }
}

/** Mismo patron que en images.ts y assistantDashboard.ts */
async function getOwnedBot(botId: string, userId: string) {
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Ese bot no pertenece a tu cuenta');
  return bot;
}

/**
 * Pertenencia -> numero conectado -> integracion disponible, en ese orden.
 * Devuelve el phone-number-id de ESE bot, que es lo unico que las funciones de
 * Graph necesitan.
 */
async function resolverNumeroDelBot(botId: string, userId: string): Promise<string> {
  const bot = await getOwnedBot(botId, userId);

  if (!bot.metaPhoneNumberId) {
    throw new AppError(400, 'Conectá WhatsApp antes de configurar el perfil');
  }

  if (!isMetaConfigured()) {
    throw new AppError(503, 'La integración de WhatsApp no está disponible en este momento');
  }

  return bot.metaPhoneNumberId;
}

// ─── VALIDACION ───────────────────────────────────────────────────────────────
// Los limites son los de Meta. Se validan aca y no en Graph para que el error
// llegue en español y diga que campo fallo, en vez de un 400 cripico de Meta.

const sitioWeb = z
  .string()
  .max(256, 'Cada sitio web puede tener hasta 256 caracteres')
  .refine((v) => v.startsWith('http://') || v.startsWith('https://'), {
    message: 'Los sitios web tienen que empezar con http:// o https://',
  });

const perfilSchema = z
  .object({
    about: z
      .string()
      .min(1, 'El texto de estado no puede quedar vacío')
      .max(139, 'El texto de estado no puede superar los 139 caracteres')
      .optional(),
    description: z
      .string()
      .max(512, 'La descripción no puede superar los 512 caracteres')
      .optional(),
    address: z
      .string()
      .max(256, 'La dirección no puede superar los 256 caracteres')
      .optional(),
    email: z
      .string()
      .max(128, 'El email no puede superar los 128 caracteres')
      .email('El email no tiene un formato válido')
      .optional(),
    websites: z
      .array(sitioWeb)
      .max(2, 'WhatsApp acepta como máximo 2 sitios web')
      .optional(),
    vertical: z
      .enum(VERTICALES, {
        errorMap: () => ({ message: 'Esa categoría no está entre las que acepta WhatsApp' }),
      })
      .optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No se indicó ningún cambio',
  });

// ─── GET: perfil actual ───────────────────────────────────────────────────────

router.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const phoneNumberId = await resolverNumeroDelBot(req.params.botId, req.user!.userId);
      const perfil = await conErrorLegible(() => getBusinessProfile(phoneNumberId));
      res.json({ data: perfil, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  },
);

// ─── PATCH: actualizar los campos de texto ────────────────────────────────────

router.patch(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const phoneNumberId = await resolverNumeroDelBot(req.params.botId, req.user!.userId);
      const cambios = perfilSchema.parse(req.body);

      await conErrorLegible(() => updateBusinessProfile(phoneNumberId, cambios));

      // Se relee en vez de devolver lo que se mando: asi el panel muestra lo
      // que Meta guardo de verdad, que es lo que ve el cliente.
      const perfil = await conErrorLegible(() => getBusinessProfile(phoneNumberId));
      res.json({ data: perfil, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /picture: foto de perfil ────────────────────────────────────────────

router.post(
  '/picture',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const phoneNumberId = await resolverNumeroDelBot(req.params.botId, req.user!.userId);

      const archivo = req.file;
      if (!archivo) {
        throw new AppError(400, 'No llegó ninguna imagen');
      }
      if (archivo.size > MAX_FOTO_BYTES) {
        throw new AppError(400, 'La imagen no puede superar los 5MB');
      }

      // El tipo real sale de los bytes, no del nombre ni del content-type que
      // manda el navegador: los dos se pueden falsificar.
      let metadata: Metadata;
      try {
        metadata = await sharp(archivo.buffer).metadata();
      } catch {
        throw new AppError(400, 'El archivo no es una imagen válida');
      }
      if (metadata.format !== 'jpeg' && metadata.format !== 'png') {
        throw new AppError(400, 'La foto tiene que ser JPG o PNG');
      }

      // Recorte cuadrado centrado + 640x640, pase lo que pase con el original.
      // El navegador puede previsualizar, pero el que ajusta de verdad es esto.
      const normalizada = await sharp(archivo.buffer)
        .resize(LADO_FOTO, LADO_FOTO, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 90 })
        .toBuffer();

      // Sin app id no hay Resumable Upload posible. Se avisa antes de procesar
      // nada, con el motivo exacto: un 500 generico no le dice al usuario que
      // el problema es de configuracion y no de su imagen.
      if (!env.META_APP_ID) {
        throw new AppError(
          503,
          'Falta configurar META_APP_ID para poder cambiar la foto de perfil',
          'META_APP_ID_FALTANTE',
        );
      }

      // Los errores del servicio traen el paso exacto que fallo (1, 2 o 3) y
      // el detalle de Graph. Se envuelven en AppError para que ese mensaje
      // llegue al usuario en vez de convertirse en "Error interno del servidor".
      let handle: string;
      try {
        handle = await uploadProfilePicture(normalizada, 'image/jpeg');
        await setProfilePictureHandle(phoneNumberId, handle);
      } catch (err) {
        if (err instanceof AppError) throw err;
        const detalle = err instanceof Error ? err.message : 'Error desconocido';
        throw new AppError(502, `No se pudo actualizar la foto de perfil. ${detalle}`, 'META_FOTO_ERROR');
      }

      const perfil = await conErrorLegible(() => getBusinessProfile(phoneNumberId));
      res.json({ data: perfil, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
