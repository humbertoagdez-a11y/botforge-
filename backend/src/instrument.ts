/**
 * Inicializacion de Sentry. TIENE que importarse antes que cualquier otra cosa
 * en index.ts: el SDK parchea modulos (http, express, prisma) al arrancar, y si
 * ya se cargaron no puede instrumentarlos.
 *
 * Todo el archivo es opcional: sin SENTRY_DSN no se inicializa nada y el resto
 * del sistema se comporta exactamente igual que antes.
 *
 * PRIVACIDAD — que NO sale de acá jamas:
 *   - cuerpos de request (traen passwords, documentos y mensajes de clientes)
 *   - headers de autenticacion, cookies y firmas de webhooks
 *   - query strings (el token de reseteo de contraseña viaja ahi)
 *   - datos del comprador de Pagopar
 * Ver depurarEvento() mas abajo: es una lista blanca, no una lista negra, para
 * que un campo nuevo no se escape por olvido.
 */
import './config/env';
import * as Sentry from '@sentry/node';
import { env } from './config/env';

/** Headers que sí sirven para depurar y no identifican a nadie */
const HEADERS_PERMITIDOS = new Set([
  'content-type',
  'content-length',
  'user-agent',
  'accept',
  'accept-language',
  'referer',
  'origin',
]);

/**
 * Rutas cuyo path ya es sensible por sí mismo aunque se quiten los parámetros.
 * No se descarta el evento —queremos saber si falla el login—, pero se marca
 * para revisar que nunca lleve más que el path.
 */
const RUTAS_SENSIBLES = ['/auth/reset-password', '/auth/verify-email', '/auth/login'];

type EventoSentry = Sentry.ErrorEvent;

/**
 * Deja el evento con lo mínimo para depurar: método, path sin query, status y
 * stack trace. Todo lo demás se descarta.
 */
export function depurarEvento(evento: EventoSentry): EventoSentry {
  const req = evento.request;
  if (req) {
    // El cuerpo es lo más peligroso: password en /auth/login, el documento del
    // comprador en /pagopar/checkout, el mensaje del cliente en /chat
    delete req.data;
    delete req.cookies;

    // La query string lleva el token de reseteo de contraseña
    if (typeof req.url === 'string') {
      const corte = req.url.indexOf('?');
      if (corte !== -1) req.url = `${req.url.slice(0, corte)}?[filtrado]`;
    }
    delete req.query_string;

    // Lista blanca de headers: Authorization, Cookie y x-twilio-signature
    // quedan fuera por no estar en ella, y también cualquier header nuevo
    if (req.headers) {
      const limpios: Record<string, string> = {};
      for (const [clave, valor] of Object.entries(req.headers)) {
        if (HEADERS_PERMITIDOS.has(clave.toLowerCase()) && typeof valor === 'string') {
          limpios[clave] = valor;
        }
      }
      req.headers = limpios;
    }
  }

  // Del usuario solo el id (un uuid). Nunca email, nombre ni documento: sirve
  // para saber a quién le pasó sin exponer quién es.
  if (evento.user) {
    evento.user = evento.user.id ? { id: String(evento.user.id) } : {};
  }

  // Los breadcrumbs son la fuga menos obvia y la más peligrosa: el SDK anota
  // cada request HTTP con su query string COMPLETA, y ahí viaja el token de
  // reseteo de contraseña. Limpiar solo request.url no alcanza.
  if (Array.isArray(evento.breadcrumbs)) {
    evento.breadcrumbs = evento.breadcrumbs
      // Los de consola replican lo que imprimimos con console.*, que puede ser
      // cualquier cosa. No vale la pena auditar cada log: se descartan.
      .filter((b) => b.category !== 'console')
      .map((b) => {
        if (!b.data) return b;
        const data: Record<string, unknown> = { ...b.data };
        for (const clave of Object.keys(data)) {
          const valor = data[clave];
          if (typeof valor !== 'string') continue;
          // Cualquier campo que parezca una URL o una query pierde los parámetros
          if (clave === 'http.query' || clave === 'query') {
            data[clave] = '[filtrado]';
          } else if (valor.includes('?')) {
            data[clave] = `${valor.slice(0, valor.indexOf('?'))}?[filtrado]`;
          }
        }
        return { ...b, data };
      });
  }

  // Marca para poder filtrar en el panel las rutas donde hay que mirar con
  // más cuidado si algo se coló
  const url = evento.request?.url;
  if (typeof url === 'string' && RUTAS_SENSIBLES.some((r) => url.includes(r))) {
    evento.tags = { ...evento.tags, ruta_sensible: 'true' };
  }

  return evento;
}

export const sentryHabilitado = Boolean(env.SENTRY_DSN);

if (sentryHabilitado) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Permite ver en qué deploy apareció un error, igual que /health
    release: env.RAILWAY_GIT_COMMIT_SHA || undefined,

    // false es el default del SDK, pero se pone explícito porque es LA opción
    // que controla si se mandan cuerpos, cookies e IP del usuario
    sendDefaultPii: false,

    // Solo errores. El tracing de rendimiento consume del mismo cupo gratuito
    // y agrega instrumentación que no necesitamos para alertar de fallas.
    tracesSampleRate: 0,

    beforeSend: depurarEvento,

    // Ruido que no es un error del producto: el cliente cortó la conexión
    ignoreErrors: ['ECONNRESET', 'EPIPE', 'aborted', 'AbortError'],
  });

  console.log(`[sentry] monitoreo activo (${env.NODE_ENV})`);
} else {
  console.log('[sentry] SENTRY_DSN no configurado — los errores quedan solo en los logs');
}

export { Sentry };
