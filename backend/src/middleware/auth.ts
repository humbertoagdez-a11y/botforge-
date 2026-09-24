import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from './errorHandler';
import { prisma } from '../lib/prisma';

interface JwtPayload {
  userId: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      /** Cuerpo tal cual llego, para verificar firmas HMAC (webhook de Meta) */
      rawBody?: Buffer;
    }
  }
}

/** Metodos que no cambian estado: para ellos la cookie sola es aceptable. */
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  // El header manda. El frontend SIEMPRE lo manda (guarda el token en
  // localStorage y lo pone en cada fetch), asi que este es el camino real.
  const authHeader = req.headers.authorization;
  let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  // La cookie es el respaldo, y solo para metodos que no cambian estado.
  //
  // Por que: las cookies salen con SameSite=None (frontend y backend viven en
  // dominios distintos en Railway), asi que el navegador las adjunta tambien
  // en una request disparada desde OTRO sitio. Con express.urlencoded montado
  // globalmente, un formulario oculto en una pagina cualquiera puede hacer un
  // POST simple —sin preflight, que es lo unico que CORS habria frenado— y la
  // cookie viaja igual. CORS impide LEER la respuesta, no impide el efecto.
  // Aceptando la cookie solo en GET/HEAD/OPTIONS, ese POST cruzado se queda
  // sin credencial y muere en 401.
  if (!token && METODOS_SEGUROS.has(req.method)) {
    token = req.cookies?.accessToken as string | undefined;
  }

  if (!token) {
    return next(new AppError(401, 'No autenticado'));
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    next(new AppError(401, 'Token inválido o expirado'));
  }
}

/**
 * Exige email verificado. Corre SIEMPRE despues de requireAuth (necesita
 * req.user). Es defensa en profundidad: desde este deploy los tokens solo se
 * emiten al verificar, pero cubre sesiones legadas y cualquier via de emision
 * futura que se olvide del chequeo.
 */
export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { emailVerified: true },
      });
      if (!user?.emailVerified) {
        throw new AppError(
          403,
          'Verificá tu email para usar BotForge. Revisá tu casilla o pedí un código nuevo.',
          'EMAIL_NOT_VERIFIED',
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  })();
}
