/**
 * Catálogo de planes del frontend. Fuente única.
 *
 * Antes los precios y los límites estaban copiados a mano en la landing, en
 * /pricing y en los términos, y en el backend en otros cuatro lugares. Siete
 * espejos manuales: cambiar un límite obligaba a acertarle a los siete.
 *
 * Acá viven una sola vez para todo el frontend. El espejo del backend es
 * `backend/src/services/planCatalog.ts`, que a su vez deriva de `LIMITS`
 * (middleware/planLimits.ts) y de `PLAN_MONTOS` (services/pagopar.ts). El
 * frontend no puede importar del backend, así que esa frontera queda cubierta
 * por `npm run verificar:planes`, que compara los dos y falla si difieren.
 *
 * Si cambiás un límite: tocás `planLimits.ts`, después este archivo, y corrés
 * el verificador.
 */

export type PlanId = 'FREE' | 'STARTER' | 'PRO' | 'AGENCY';
export type PlanPago = Exclude<PlanId, 'FREE'>;

export interface Beneficio {
  texto: string;
  /** Lo que NO trae el plan anterior. Es lo que responde "por qué pagar más". */
  nuevo?: boolean;
}

export interface Plan {
  id: PlanId;
  nombre: string;
  precioGs: number;
  precioUsd: number;
  /** Para quién es, en una línea. */
  para: string;
  /** El número que decide la compra, arriba de todo. */
  mensajesPorMes: number;
  bots: number | null;
  docsPorBot: number | null;
  imagenesPorBot: number | null;
  whatsapp: boolean;
  nps: boolean;
  informeSemanal: boolean;
  informeConsolidado: boolean;
  asistentePorDia: number;
  pruebaPorDia: number;
  beneficios: Beneficio[];
  nota?: string;
  destacado: boolean;
}

export const PLANES: Plan[] = [
  {
    id: 'FREE',
    nombre: 'Free',
    precioGs: 0,
    precioUsd: 0,
    para: 'Para probar cómo responde tu bot antes de pagar nada',
    mensajesPorMes: 100,
    bots: 1,
    docsPorBot: 3,
    imagenesPorBot: 0,
    whatsapp: false,
    nps: false,
    informeSemanal: false,
    informeConsolidado: false,
    asistentePorDia: 5,
    pruebaPorDia: 25,
    beneficios: [
      { texto: '1 bot' },
      { texto: '100 mensajes por mes' },
      { texto: '3 documentos de entrenamiento' },
      { texto: '25 mensajes por día en el Chat de prueba' },
      { texto: 'Asistente de configuración: 5 mensajes por día' },
    ],
    nota: 'Sin WhatsApp: tu bot responde solo en el Chat de prueba del panel.',
    destacado: false,
  },
  {
    id: 'STARTER',
    nombre: 'Básico',
    precioGs: 150000,
    precioUsd: 20,
    para: 'Para un negocio que ya quiere atender por WhatsApp',
    mensajesPorMes: 1000,
    bots: 1,
    docsPorBot: 10,
    imagenesPorBot: 8,
    whatsapp: true,
    nps: true,
    informeSemanal: false,
    informeConsolidado: false,
    asistentePorDia: 15,
    pruebaPorDia: 60,
    beneficios: [
      { texto: 'Tu número de WhatsApp Business conectado', nuevo: true },
      { texto: 'Hasta 8 imágenes que tu bot le manda a los clientes', nuevo: true },
      { texto: 'Encuestas de satisfacción a tus clientes', nuevo: true },
      { texto: '1.000 mensajes por mes' },
      { texto: '1 bot' },
      { texto: '10 documentos de entrenamiento' },
      { texto: 'Asistente de configuración: 15 mensajes por día' },
    ],
    destacado: false,
  },
  {
    id: 'PRO',
    nombre: 'Profesional',
    precioGs: 350000,
    precioUsd: 47,
    para: 'Para varios locales, marcas o líneas de negocio',
    mensajesPorMes: 4000,
    bots: 5,
    docsPorBot: 50,
    imagenesPorBot: 30,
    whatsapp: true,
    nps: true,
    informeSemanal: true,
    informeConsolidado: false,
    asistentePorDia: 40,
    pruebaPorDia: 150,
    beneficios: [
      { texto: 'Informe semanal automático de cada uno de tus bots', nuevo: true },
      { texto: 'Hasta 5 bots', nuevo: true },
      { texto: '4.000 mensajes por mes' },
      { texto: 'Hasta 30 imágenes por bot' },
      { texto: '50 documentos por bot' },
      { texto: 'Tu número de WhatsApp Business conectado' },
      { texto: 'Encuestas de satisfacción a tus clientes' },
      { texto: 'Asistente de configuración: 40 mensajes por día' },
    ],
    destacado: true,
  },
  {
    id: 'AGENCY',
    nombre: 'Agencia',
    precioGs: 750000,
    precioUsd: 99,
    para: 'Para quien maneja los bots de varios clientes',
    mensajesPorMes: 10000,
    bots: null,
    docsPorBot: null,
    imagenesPorBot: null,
    whatsapp: true,
    nps: true,
    informeSemanal: true,
    informeConsolidado: true,
    asistentePorDia: 100,
    pruebaPorDia: 400,
    beneficios: [
      { texto: 'Informe consolidado que compara todos tus bots entre sí', nuevo: true },
      { texto: 'Bots ilimitados', nuevo: true },
      { texto: 'Documentos e imágenes sin límite', nuevo: true },
      { texto: '10.000 mensajes por mes' },
      { texto: 'Informe semanal de cada bot' },
      { texto: 'Tu número de WhatsApp Business conectado' },
      { texto: 'Encuestas de satisfacción a tus clientes' },
      { texto: 'Asistente de configuración: 100 mensajes por día' },
    ],
    nota: 'El informe consolidado rankea tus bots por volumen y satisfacción, y te dice cuál necesita atención primero.',
    destacado: false,
  },
];

export function plan(id: PlanId): Plan {
  const p = PLANES.find((x) => x.id === id);
  if (!p) throw new Error(`Plan desconocido: ${id}`);
  return p;
}

/** "Gs. 150.000". Mismo formato en toda la aplicación. */
export function precioTexto(p: Plan): string {
  return `Gs. ${p.precioGs.toLocaleString('es-PY')}`;
}

/** Los planes que se contratan, sin Free. */
export const PLANES_PAGOS = PLANES.filter((p) => p.id !== 'FREE');
