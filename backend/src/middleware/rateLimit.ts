import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes, intenta más tarde' },
    meta: null,
  },
});

/**
 * Recuperacion de contraseña: 3 solicitudes cada 15 minutos POR EMAIL, no por
 * IP, para que nadie pueda llenarle la casilla a otro. El limiter global por
 * IP sigue aplicando por encima de este.
 */
export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req): string => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    if (typeof email === 'string' && email.trim()) return `email:${email.trim().toLowerCase()}`;
    // Sin email valido el schema lo va a rechazar igual; se agrupa aparte
    return 'email:invalido';
  },
  message: {
    data: null,
    error: {
      code: 'RATE_LIMIT',
      message: 'Ya pediste varios enlaces de recuperación. Esperá unos minutos e intentá de nuevo.',
    },
    meta: null,
  },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: 'RATE_LIMIT', message: 'Demasiados intentos de autenticación' },
    meta: null,
  },
});
