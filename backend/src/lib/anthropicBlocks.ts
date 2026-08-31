import Anthropic from '@anthropic-ai/sdk';

/**
 * Saca los bloques de razonamiento (`thinking` / `redacted_thinking`) de un
 * turno del asistente antes de volver a mandarlo a la API.
 *
 * POR QUE EXISTE: claude-sonnet-5 emite bloques `thinking` aunque nadie pida
 * extended thinking. El SDK 0.36.x es anterior a esa feature: su acumulador de
 * streaming no conoce `signature_delta`, asi que `stream().finalMessage()`
 * devuelve el bloque mutilado, con `thinking: ''` y `signature: ''`. Con
 * `messages.create()` (sin streaming) el mismo bloque viene entero.
 *
 * Al reenviar ese bloque mutilado en la ronda siguiente del loop de
 * herramientas, la API responde 400 "each thinking block must contain
 * thinking" y se cae el turno completo: el usuario ve "Ocurrio un error" y no
 * se guarda nada. Solo pasa cuando hace falta una segunda ronda, que es
 * justamente cuando el asistente esta consultando la base.
 *
 * Se descartan en vez de repararse porque en toda la plataforma el parametro
 * `thinking` no se pasa nunca: son bloques que no aportan contexto y que la
 * API acepta sin problema que no esten. Si algun dia se habilita extended
 * thinking hay que subir el SDK y sacar este filtro, no al reves.
 */
export function sinBloquesDeRazonamiento<T extends { type: string }>(content: T[]): T[] {
  return content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
}

/** Igual que la anterior, para el content ya tipado de un MessageParam. */
export function contentSinRazonamiento(
  content: Anthropic.MessageParam['content'],
): Anthropic.MessageParam['content'] {
  if (typeof content === 'string') return content;
  return sinBloquesDeRazonamiento(content as unknown as { type: string }[]) as unknown as Anthropic.MessageParam['content'];
}
