/**
 * Reporte de errores a Sentry, con el log de siempre como respaldo.
 *
 * Todos los call sites llaman a reportarError() en vez de console.error a
 * secas. Sin SENTRY_DSN se comporta EXACTAMENTE como antes: escribe en el log
 * y nada más. Con DSN, además lo manda a Sentry con contexto acotado.
 */
import { Sentry, sentryHabilitado } from '../instrument';

/**
 * Contexto adicional del error. Va a Sentry como tags, así que sirve para
 * filtrar en el panel.
 *
 * NO poner acá datos personales: ni emails, ni números de teléfono, ni el
 * contenido de un mensaje. Ids opacos (botId, userId, hashPedido) sí.
 */
export type ContextoError = Record<string, string | number | boolean | null | undefined>;

/**
 * Loguea el error y, si Sentry está configurado, lo reporta.
 *
 * Nunca lanza: un fallo del monitoreo no puede romper el flujo que estaba
 * intentando reportar un fallo.
 */
export function reportarError(
  ambito: string,
  error: unknown,
  contexto: ContextoError = {},
): void {
  const detalle = error instanceof Error ? error.message : String(error);
  console.error(`[${ambito}] ${detalle}`, error);

  if (!sentryHabilitado) return;

  try {
    Sentry.withScope((scope) => {
      scope.setTag('ambito', ambito);
      for (const [clave, valor] of Object.entries(contexto)) {
        if (valor !== undefined && valor !== null) scope.setTag(clave, String(valor));
      }
      Sentry.captureException(error instanceof Error ? error : new Error(detalle));
    });
  } catch (fallo) {
    console.error('[sentry] no se pudo reportar el error:', fallo);
  }
}

/**
 * Para situaciones que no son excepciones pero conviene saber que pasaron:
 * un pago que llega sin poder interpretarse, una notificación descartada.
 */
export function reportarAviso(
  ambito: string,
  mensaje: string,
  contexto: ContextoError = {},
): void {
  console.warn(`[${ambito}] ${mensaje}`);

  if (!sentryHabilitado) return;

  try {
    Sentry.withScope((scope) => {
      scope.setTag('ambito', ambito);
      scope.setLevel('warning');
      for (const [clave, valor] of Object.entries(contexto)) {
        if (valor !== undefined && valor !== null) scope.setTag(clave, String(valor));
      }
      Sentry.captureMessage(mensaje, 'warning');
    });
  } catch (fallo) {
    console.error('[sentry] no se pudo reportar el aviso:', fallo);
  }
}

/** Asocia el error al usuario (solo el id) cuando hay sesión */
export function marcarUsuario(userId: string | undefined): void {
  if (!sentryHabilitado) return;
  try {
    Sentry.setUser(userId ? { id: userId } : null);
  } catch {
    // El monitoreo nunca puede romper una request
  }
}
