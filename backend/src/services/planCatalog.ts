/**
 * Catalogo de planes en texto, derivado de las dos fuentes de verdad.
 *
 * Los numeros salen de `middleware/planLimits.ts` (LIMITS) y los precios de
 * `services/pagopar.ts` (PLAN_MONTOS). Aca no se escribe ningun numero a mano.
 *
 * Existe porque el catalogo estaba copiado en cuatro lugares del backend y
 * tres del frontend, todos a mano: el prompt de Aria (la landing), el prompt
 * del asistente del panel, la herramienta `ver_planes` del asistente, y las
 * paginas de precios, landing y terminos. Cambiar un limite obligaba a tocar
 * siete archivos y bastaba olvidarse de uno para prometerle a un cliente algo
 * que el backend despues no le daba.
 *
 * El espejo del frontend vive en `frontend/lib/planes.ts` (no puede importar
 * de aca). `npm run verificar:planes` compara los dos y falla si difieren.
 */
import type { Plan } from '@prisma/client';
import { LIMITS } from '../middleware/planLimits';
import { PLAN_MONTOS, PLAN_NOMBRES } from './pagopar';

export const PLANES_ORDENADOS: Plan[] = ['FREE', 'STARTER', 'PRO', 'AGENCY'];

export const PLAN_LABEL: Record<Plan, string> = {
  FREE: 'Free',
  STARTER: 'Básico',
  PRO: 'Profesional',
  AGENCY: 'Agencia',
};

/** Precio mensual en guaranies. Free es el unico que no pasa por Pagopar. */
export function precioGs(plan: Plan): number {
  return plan === 'FREE' ? 0 : PLAN_MONTOS[plan];
}

/** "Gs. 150.000" o "Gs. 0". Un solo formato para todo el backend. */
export function precioTexto(plan: Plan): string {
  return `Gs. ${precioGs(plan).toLocaleString('es-PY')}`;
}

/**
 * Infinity se escribe en castellano, no como "Infinity".
 *
 * `ilimitado` va aparte del plural porque "documentos por bot ilimitados"
 * concuerda mal: el adjetivo se pega al sustantivo, no a la frase entera.
 */
function cantidad(n: number, singular: string, plural: string, ilimitado = `${plural} sin límite`): string {
  if (!Number.isFinite(n)) return ilimitado;
  return `${n.toLocaleString('es-PY')} ${n === 1 ? singular : plural}`;
}

/**
 * Una linea por plan, pensada para meterse en un prompt.
 * Ejemplo: "Básico: Gs. 150.000 — 1 bot, 1.000 mensajes por mes, ..."
 */
export function lineaDePlan(plan: Plan): string {
  const l = LIMITS[plan];
  const partes = [
    cantidad(l.bots, 'bot', 'bots', 'bots ilimitados'),
    `${l.monthlyMessages.toLocaleString('es-PY')} mensajes por mes`,
    cantidad(l.docsPerBot, 'documento por bot', 'documentos por bot', 'documentos sin límite'),
  ];
  if (l.imagesPerBot > 0) {
    partes.push(cantidad(l.imagesPerBot, 'imagen por bot', 'imágenes por bot', 'imágenes sin límite'));
  }
  partes.push(l.whatsapp ? 'WhatsApp incluido' : 'sin WhatsApp (solo chat web)');
  if (l.nps) partes.push('encuestas de satisfacción');
  if (l.weeklyReports) partes.push('informe semanal de cada bot');
  if (l.consolidatedReports) partes.push('informe consolidado que compara todos los bots');
  partes.push(`asistente: ${l.assistantDaily} mensajes por día`);
  return `${PLAN_LABEL[plan]}: ${precioTexto(plan)} — ${partes.join(', ')}.`;
}

/** El catalogo entero, una linea por plan. Es lo que entra a los prompts. */
export const CATALOGO_TEXTO: string = PLANES_ORDENADOS.map(lineaDePlan).join('\n');

/** Version corta de una sola linea, para donde no entra el catalogo completo. */
export const PRECIOS_TEXTO: string = PLANES_ORDENADOS.map(
  (p) => `${PLAN_LABEL[p]} (${precioTexto(p)})`,
).join(', ');

/** Lo que devuelve la herramienta `ver_planes` del asistente del panel. */
export interface PlanParaAsistente {
  label: string;
  price: string;
  incluye: string;
}

export function planesParaAsistente(): Record<string, PlanParaAsistente> {
  const salida: Record<string, PlanParaAsistente> = {};
  for (const plan of PLANES_ORDENADOS) {
    if (plan === 'FREE') continue; // la herramienta lista los planes que se contratan
    salida[plan] = {
      label: PLAN_NOMBRES[plan].replace(/^BotForge /, ''),
      price: `${precioTexto(plan)}/mes`,
      incluye: lineaDePlan(plan).split(' — ')[1]?.replace(/\.$/, '') ?? '',
    };
  }
  return salida;
}

/** Forma serializable del catalogo. La sirve el endpoint publico de planes. */
export interface PlanPublico {
  id: Plan;
  nombre: string;
  precioGs: number;
  bots: number | null;
  docsPorBot: number | null;
  imagenesPorBot: number | null;
  mensajesPorMes: number;
  whatsapp: boolean;
  nps: boolean;
  informeSemanal: boolean;
  informeConsolidado: boolean;
  asistentePorDia: number;
  pruebaPorDia: number;
}

/** null en vez de Infinity: JSON no sabe serializar Infinity. */
const finito = (n: number): number | null => (Number.isFinite(n) ? n : null);

export function catalogoPublico(): PlanPublico[] {
  return PLANES_ORDENADOS.map((id) => {
    const l = LIMITS[id];
    return {
      id,
      nombre: PLAN_LABEL[id],
      precioGs: precioGs(id),
      bots: finito(l.bots),
      docsPorBot: finito(l.docsPerBot),
      imagenesPorBot: finito(l.imagesPerBot),
      mensajesPorMes: l.monthlyMessages,
      whatsapp: l.whatsapp,
      nps: l.nps,
      informeSemanal: l.weeklyReports,
      informeConsolidado: l.consolidatedReports,
      asistentePorDia: l.assistantDaily,
      pruebaPorDia: l.testDaily,
    };
  });
}
