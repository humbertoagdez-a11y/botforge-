/**
 * Integración con Pagopar (flujo de pago simple, no recurrente).
 *
 * El cobro recurrente automático queda pendiente de que Pagopar apruebe el
 * contrato; por ahora cada upgrade es un pago único que el usuario repite.
 *
 * PAGOPAR_PRIVATE_KEY solo se usa para calcular firmas sha1: nunca viaja en
 * una URL, en un body ni en un log.
 */
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';

const API_BASE = 'https://api.pagopar.com/api';
const CHECKOUT_BASE = 'https://www.pagopar.com/pagos';
/** Categoría genérica de Pagopar para servicios */
const CATEGORIA = '909';
/** Ciudad por defecto (Asunción) */
const CIUDAD = '1';
const PAGO_TTL_MS = 24 * 60 * 60 * 1000;

export type PagoparPlan = 'STARTER' | 'PRO' | 'AGENCY';

export const PLAN_MONTOS: Record<PagoparPlan, number> = {
  STARTER: 150000,
  PRO: 350000,
  AGENCY: 750000,
};

export const PLAN_NOMBRES: Record<PagoparPlan, string> = {
  STARTER: 'BotForge Básico',
  PRO: 'BotForge Profesional',
  AGENCY: 'BotForge Agencia',
};

/** El frontend lo usa para saber que tiene que pedir la cédula antes de pagar */
export const DOCUMENTO_REQUERIDO = 'DOCUMENTO_REQUERIDO';

export function isPagoparConfigured(): boolean {
  return Boolean(env.PAGOPAR_PUBLIC_KEY && env.PAGOPAR_PRIVATE_KEY);
}

function assertConfigured(): void {
  if (!isPagoparConfigured()) {
    throw new AppError(503, 'Los pagos todavía no están habilitados', 'PAGOPAR_NOT_CONFIGURED');
  }
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

// ─── Tipos de la API ──────────────────────────────────────────────────────────

interface IniciarResultado {
  data?: string;
  pedido?: number;
}

interface IniciarResponse {
  respuesta?: boolean;
  resultado?: IniciarResultado[] | string;
}

export interface PedidoConsultado {
  pagado: boolean;
  hash_pedido?: string;
  monto?: string | number;
  numero_pedido?: string | number;
  forma_pago?: string;
  /** Comprobante que emite Pagopar al acreditar; null hasta que se paga */
  numero_comprobante_interno?: string | null;
  fecha_pago?: string | null;
  cancelado?: boolean;
}

interface ConsultaResponse {
  respuesta?: boolean;
  resultado?: PedidoConsultado[] | string;
}

/** Extrae el mensaje de error de Pagopar sin exponer nada nuestro */
function describeFallo(body: IniciarResponse | ConsultaResponse): string {
  if (typeof body.resultado === 'string') return body.resultado;
  return 'Pagopar rechazó la operación';
}

/** Deja ver que el dato viaja y con que largo, sin volcar el CI a los logs */
function enmascarar(valor: string): string {
  if (!valor) return '(vacío)';
  if (valor.length <= 3) return `***(${valor.length} chars)`;
  return `***${valor.slice(-3)} (${valor.length} chars)`;
}

/**
 * Vuelca TODO lo que hace falta para diagnosticar un rechazo de Pagopar:
 * status HTTP, body crudo completo, y el payload que se mando.
 *
 * El body crudo es lo importante: Pagopar devuelve el motivo real en
 * `resultado`, y antes solo se logueaba un resumen que se comia el detalle.
 *
 * Nunca se loguea PAGOPAR_PRIVATE_KEY. El token es un sha1 derivado, asi que
 * se enmascara igual, y el documento del comprador se enmascara por ser un
 * dato personal.
 */
function logFalloPagopar(
  operacion: string,
  status: number,
  rawBody: string,
  payload?: Record<string, unknown>,
): void {
  console.error(`[pagopar] ${operacion} — HTTP ${status}`);
  console.error(`[pagopar] respuesta cruda: ${rawBody.slice(0, 2000)}`);

  if (!payload) return;
  const comprador = payload.comprador as Record<string, unknown> | undefined;
  console.error(
    '[pagopar] payload enviado:',
    JSON.stringify(
      {
        ...payload,
        token: enmascarar(String(payload.token ?? '')),
        public_key: enmascarar(String(payload.public_key ?? '')),
        ...(comprador
          ? {
              comprador: {
                ...comprador,
                documento: enmascarar(String(comprador.documento ?? '')),
              },
            }
          : {}),
      },
      null,
      2,
    ),
  );
}

// ─── Iniciar transacción ──────────────────────────────────────────────────────

/**
 * Crea el pedido local, lo registra en Pagopar y devuelve la URL de checkout.
 * El PagoparOrder nace con pagado: false; solo el webhook lo marca pagado.
 */
export async function iniciarTransaccion(
  userId: string,
  userEmail: string,
  userName: string,
  userDocumento: string,
  plan: PagoparPlan,
  montoTotal: number,
): Promise<{ checkoutUrl: string; hashPedido: string; idPedidoComercio: string }> {
  assertConfigured();

  // Pagopar rechaza el pedido con "El documento debe estar presente"
  if (!userDocumento) {
    throw new AppError(
      400,
      'Necesitás cargar tu número de documento antes de pagar',
      DOCUMENTO_REQUERIDO,
    );
  }

  // Alfanumérico puro: el uuid con guiones puede no pasar la validación
  const idPedidoComercio = uuidv4().replace(/-/g, '');
  const monto = Math.round(montoTotal);
  const montoStr = monto.toFixed(0);

  const order = await prisma.pagoparOrder.create({
    data: { id: uuidv4(), userId, plan, montoTotal: monto, idPedidoComercio },
  });

  const fechaMaximaPago = new Date(Date.now() + PAGO_TTL_MS).toISOString();
  const descripcion = `Suscripción mensual ${PLAN_NOMBRES[plan]}`;

  const body = {
    token: sha1(`${env.PAGOPAR_PRIVATE_KEY}${idPedidoComercio}${montoStr}`),
    comprador: {
      ruc: '',
      email: userEmail,
      nombre: userName,
      telefono: '',
      documento: userDocumento,
      tipo_documento: 'CI',
      ciudad: CIUDAD,
      direccion: '',
      coordenadas: '',
      razon_social: userName,
      direccion_referencia: null,
    },
    public_key: env.PAGOPAR_PUBLIC_KEY,
    monto_total: monto,
    tipo_pedido: 'VENTA-COMERCIO',
    compras_items: [
      {
        nombre: PLAN_NOMBRES[plan],
        categoria: CATEGORIA,
        public_key: env.PAGOPAR_PUBLIC_KEY,
        precio_total: monto,
        ciudad: CIUDAD,
        url_imagen: '',
        descripcion,
        cantidad: 1,
        id_producto: plan,
        vendedor_telefono: '',
        vendedor_direccion: '',
        vendedor_direccion_referencia: '',
        vendedor_direccion_coordenadas: '',
      },
    ],
    fecha_maxima_pago: fechaMaximaPago,
    id_pedido_comercio: idPedidoComercio,
    descripcion_resumen: descripcion,
    // forma_pago se omite a propósito: así el cliente elige el medio de pago
    // en el checkout de Pagopar en vez de quedar forzado a uno.
  };

  const res = await fetch(`${API_BASE}/comercios/2.0/iniciar-transaccion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Se lee el body UNA vez como texto: antes, con un status != 2xx se tiraba
  // sin mirarlo, y ahi justamente viene el motivo real del rechazo
  const rawBody = await res.text();

  if (!res.ok) {
    logFalloPagopar('iniciar-transaccion rechazada', res.status, rawBody, body);
    throw new AppError(502, `Pagopar no respondió correctamente (HTTP ${res.status})`);
  }

  let data: IniciarResponse;
  try {
    data = JSON.parse(rawBody) as IniciarResponse;
  } catch {
    logFalloPagopar('iniciar-transaccion devolvió algo que no es JSON', res.status, rawBody, body);
    throw new AppError(502, 'No se pudo iniciar el pago. Intentá de nuevo.');
  }

  if (data.respuesta !== true || !Array.isArray(data.resultado)) {
    logFalloPagopar('iniciar-transaccion falló', res.status, rawBody, body);
    console.error(`[pagopar] motivo: ${describeFallo(data)}`);
    throw new AppError(502, 'No se pudo iniciar el pago. Intentá de nuevo.');
  }

  const hashPedido = data.resultado[0]?.data;
  if (!hashPedido) {
    console.error('[pagopar] iniciar-transaccion sin hash en la respuesta');
    throw new AppError(502, 'No se pudo iniciar el pago. Intentá de nuevo.');
  }

  await prisma.pagoparOrder.update({
    where: { id: order.id },
    data: { hashPedido },
  });

  return {
    checkoutUrl: `${CHECKOUT_BASE}/${hashPedido}`,
    hashPedido,
    idPedidoComercio,
  };
}

// ─── Validación de la notificación ────────────────────────────────────────────

/**
 * El token que manda Pagopar en el webhook es sha1(private_key + hash_pedido).
 * Si no coincide, la notificación no es de Pagopar y no se toca nada.
 */
export function validarNotificacion(hashPedido: string, tokenRecibido: string): boolean {
  if (!isPagoparConfigured() || !hashPedido || !tokenRecibido) return false;
  // Se comparan en minusculas: un digest hex es el mismo valor sea cual sea la
  // caja, y asi no depende de como lo serialice Pagopar.
  const esperado = sha1(`${env.PAGOPAR_PRIVATE_KEY}${hashPedido}`);
  return esperado === tokenRecibido.trim().toLowerCase();
}

// ─── Consulta de estado ───────────────────────────────────────────────────────

/** Estado real del pedido según Pagopar, para cuando el usuario vuelve del checkout */
export async function consultarPedido(hashPedido: string): Promise<PedidoConsultado | null> {
  assertConfigured();

  const res = await fetch(`${API_BASE}/pedidos/1.1/traer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hash_pedido: hashPedido,
      token: sha1(`${env.PAGOPAR_PRIVATE_KEY}CONSULTA`),
      token_publico: env.PAGOPAR_PUBLIC_KEY,
    }),
  });

  const rawBody = await res.text();

  if (!res.ok) {
    logFalloPagopar('consulta de pedido rechazada', res.status, rawBody);
    throw new AppError(502, `Pagopar no respondió correctamente (HTTP ${res.status})`);
  }

  let data: ConsultaResponse;
  try {
    data = JSON.parse(rawBody) as ConsultaResponse;
  } catch {
    logFalloPagopar('consulta de pedido devolvió algo que no es JSON', res.status, rawBody);
    return null;
  }

  if (data.respuesta !== true || !Array.isArray(data.resultado)) {
    logFalloPagopar('consulta de pedido falló', res.status, rawBody);
    console.error(`[pagopar] motivo: ${describeFallo(data)}`);
    return null;
  }

  return data.resultado[0] ?? null;
}
