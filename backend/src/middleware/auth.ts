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
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  // Acepta cookie (web) o Authorization: Bearer <token> (scripts/API)
  let token = req.cookies?.accessToken as string | undefined;

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
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
