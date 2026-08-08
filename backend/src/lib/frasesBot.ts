/**
 * Frases con las que el bot admite que no supo responder.
 *
 * Viven acá porque las usan dos cosas distintas que no deberían tener cada
 * una su copia: el diagnóstico del asistente de plataforma
 * (leer_conversaciones_del_bot con soloConProblemas) y el reporte semanal,
 * que cuenta cuántas veces el bot se quedó sin respuesta.
 *
 * Si se agrega una frase nueva al prompt del tenant, sumarla también acá.
 */
export const FRASES_SIN_RESPUESTA = [
  'no tengo esa información',
  'no tengo esa informacion',
  'no puedo ayudarte con eso',
  'no cuento con esa',
  'voy a derivar',
  'te lo confirmo',
  'lo voy a consultar',
  'no manejo esa',
  'no sabría decirte',
  'no sabria decirte',
  'un encargado',
  'una persona del equipo',
];

/** ¿Este mensaje del bot es una admisión de que no supo responder? */
export function esNoRespuesta(contenido: string): boolean {
  const lower = contenido.toLowerCase();
  return FRASES_SIN_RESPUESTA.some((f) => lower.includes(f));
}
