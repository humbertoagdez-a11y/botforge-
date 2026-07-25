/**
 * Clases compartidas por login y registro. Viven acá para que las dos
 * pantallas no repitan las mismas cadenas y no se desincronicen.
 *
 * El tamaño de fuente de los inputs en móvil lo resuelve la regla
 * `.theme-dashboard input` de globals.css (16px, evita el auto-zoom de iOS):
 * el layout de auth ya aplica esa clase.
 */

export const AUTH_INPUT =
  'h-11 rounded-lg border-white/10 bg-white/5 text-[#E8E8F0] placeholder:text-[#6E6E8E] focus:border-cyan-500/40';

/** Mismo gradiente que el botón de envío del asistente del dashboard */
export const AUTH_SUBMIT =
  'h-11 w-full rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 text-sm font-semibold text-white transition-opacity hover:opacity-90';

export const AUTH_LINK = 'font-medium text-cyan-400 transition-colors hover:text-cyan-300';

export const AUTH_CARD =
  'rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-8';

export const AUTH_LABEL = 'text-[#E8E8F0]';

export const AUTH_MUTED = 'text-[#6E6E8E]';
