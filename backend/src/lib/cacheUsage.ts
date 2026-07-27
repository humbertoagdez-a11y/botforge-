/**
 * Log del uso de prompt caching de Anthropic.
 *
 * Sin esto no hay forma de saber si el cache acierta: un prefijo que cambia
 * entre llamadas falla en silencio, cobrando el 25% extra de escritura sin
 * leer nunca. Si "leidos" queda siempre en 0, algo variable se coló en el
 * bloque cacheado.
 */
interface CacheUsage {
  input_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function logCacheUsage(scope: string, usage: CacheUsage): void {
  const creados = usage.cache_creation_input_tokens ?? 0;
  const leidos = usage.cache_read_input_tokens ?? 0;
  console.log(
    `[cache] ${scope} — creados: ${creados}, leidos: ${leidos}, sin cachear: ${usage.input_tokens}`,
  );
}
