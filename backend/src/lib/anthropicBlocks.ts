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

/**
 * Saca tambien el TEXTO que el modelo escribio antes de llamar a una
 * herramienta, ademas de los bloques de razonamiento.
 *
 * POR QUE EXISTE: el loop descarta ese texto para el cliente —es razonamiento
 * previo, no la respuesta— pero lo seguia mandando de vuelta a la API en la
 * ronda siguiente. El modelo leia ahi su propio parrafo, daba por dicho lo que
 * el cliente nunca recibio, y escribia solo lo que faltaba.
 *
 * Medido sobre el bot de ventas: preguntando "cuanto sale", el precio no salia
 * en 9 de 20 conversaciones. Las 9 coincidian con una llamada a marcar_lead, y
 * no fallaba ni una sola vez sin ella. Antes se habia intentado arreglarlo
 * diciendole al modelo en el tool_result que el cliente no vio nada; eso bajo
 * la frecuencia pero no la elimino, porque es una instruccion que puede
 * ignorar. Sacarle el texto del historial no.
 *
 * La invariante que deja: lo que el modelo ve como dicho es exactamente lo que
 * el cliente recibio. Los bloques tool_use se conservan, que son los que la
 * API exige para poder mandar el tool_result.
 */
export function sinTextoNiRazonamiento<T extends { type: string }>(content: T[]): T[] {
  return sinBloquesDeRazonamiento(content).filter((b) => b.type !== 'text');
}

/** Igual que la anterior, para el content ya tipado de un MessageParam. */
export function contentSinRazonamiento(
  content: Anthropic.MessageParam['content'],
): Anthropic.MessageParam['content'] {
  if (typeof content === 'string') return content;
  return sinBloquesDeRazonamiento(content as unknown as { type: string }[]) as unknown as Anthropic.MessageParam['content'];
}
