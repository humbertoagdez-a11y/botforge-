/**
 * Jerarquía de capas del dashboard. Usar como style={{ zIndex: Z.fab }}
 * en elementos fixed en lugar de clases Tailwind arbitrarias, para que
 * el orden de apilamiento viva en un solo lugar.
 */
export const Z = {
  base: 0,
  content: 10,
  fab: 30,
  sidebar: 40,
  overlay: 49,
  assistant: 50,
  modal: 60,
  toast: 70,
} as const;
