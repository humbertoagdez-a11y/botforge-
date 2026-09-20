import rateLimit from 'express-rate-limit';

/**
 * Techo general por IP. Hasta ahora nunca se aplico —faltaba trust proxy— asi
 * que 100 cada 15 minutos jamas se puso a prueba contra el uso real. Al
 * activarlo se sube a 600: el panel consulta seguido (la pantalla de pago
 * sondea cada 3s, el asistente, las estadisticas) y 100 dejaria afuera a un
 * usuario legitimo. El freno fino contra fuerza bruta es authLimiter, que
 * sigue en 10.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes, intenta más tarde' },
    meta: null,
  },
});

/**
 * Limite para los webhooks entrantes (Meta y Pagopar).
 *
 * El limite global es de 100 cada 15 minutos por IP, pensado para un humano
 * navegando. Meta y Pagopar entregan desde un rango acotado de IPs, asi que
 * todas sus notificaciones comparten ese mismo cupo: con varios bots activos
 * se agota, ellos empiezan a recibir 429 y, tras reintentar un rato, DESCARTAN
 * el mensaje. El cliente escribe y nadie le responde.
 *
 * Este techo es mucho mas alto porque ahi la proteccion real contra abuso no
 * es el limite por IP sino la firma: HMAC-SHA256 en Meta y sha1 en Pagopar.
 * Igual se deja un tope, para que un flood no llegue a la base de datos.
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: 'RATE_LIMIT', message: 'Demasiadas notificaciones' },
    meta: null,
  },
});

/**
 * Limita POR EMAIL en vez de por IP, para que nadie pueda llenarle la casilla
 * a otro desde IPs distintas. El limiter global por IP sigue aplicando encima.
 */
function emailKeyedLimiter(max: number, message: string) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
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
      error: { code: 'RATE_LIMIT', message },
      meta: null,
    },
  });
}

/** Recuperacion de contraseña: 3 solicitudes cada 15 minutos por email */
export const forgotPasswordLimiter = emailKeyedLimiter(
  3,
  'Ya pediste varios enlaces de recuperación. Esperá unos minutos e intentá de nuevo.',
);

/** Reenvio del codigo de verificacion: 3 cada 15 minutos por email */
export const resendVerificationLimiter = emailKeyedLimiter(
  3,
  'Ya pediste varios códigos. Esperá unos minutos e intentá de nuevo.',
);

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
