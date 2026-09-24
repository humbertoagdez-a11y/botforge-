import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { reportarError } from '../lib/monitoring';
import { requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { env } from '../config/env';
import { escaparHtml, sendEmail } from '../services/email';
import {
  DOCUMENTO_REQUERIDO,
  PLAN_MONTOS,
  consultarPedido,
  iniciarTransaccion,
  validarNotificacion,
  type PagoparPlan,
} from '../services/pagopar';
import type { Plan } from '@prisma/client';

const router = Router();

/** Un pago cubre un mes; sin cobro recurrente el usuario lo repite cada mes */
const PLAN_DURACION_MS = 30 * 24 * 60 * 60 * 1000;

// ─── POST /checkout ───────────────────────────────────────────────────────────
const checkoutSchema = z.object({
  plan: z.enum(['STARTER', 'PRO', 'AGENCY']),
});

router.post('/checkout', requireAuth, requireVerifiedEmail, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { plan } = checkoutSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });

    // Pagopar exige el documento del comprador. Se avisa con un codigo propio
    // para que el frontend abra el modal en vez de mostrar un error suelto.
    if (!user.documento) {
      throw new AppError(
        400,
        'Necesitás cargar tu número de documento antes de pagar',
        DOCUMENTO_REQUERIDO,
      );
    }

    const { checkoutUrl, hashPedido } = await iniciarTransaccion(
      user.id,
      user.email,
      user.name,
      user.documento,
      plan as PagoparPlan,
      PLAN_MONTOS[plan as PagoparPlan],
    );

    res.json({ data: { checkoutUrl, hashPedido }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /webhook ────────────────────────────────────────────────────────────
// Público: Pagopar no manda credenciales nuestras, la autenticidad se prueba
// con el token sha1. Se responde con las MISMAS notificaciones recibidas, que
// es lo que Pagopar valida para dar la entrega por buena.

/**
 * Campos que usa el handler. La notificación trae bastantes más
 * (numero_comprobante_interno, forma_pago_identificador, monto, etc.) y todos
 * se devuelven tal cual: el índice de firma abierto es a propósito, para no
 * perder ninguno al hacer el eco.
 */
interface NotificacionPagopar {
  pagado?: boolean;
  hash_pedido?: string;
  token?: string;
  forma_pago?: string;
  fecha_pago?: string | null;
  [campo: string]: unknown;
}

/**
 * El `resultado` TAL CUAL vino en la notificación, sin pasar por la
 * normalización interna.
 *
 * Pagopar pidió expresamente que la respuesta sea el eco del contenido que
 * ellos notifican, sin rearmarlo: "de ese modo no arma de nuevo el Json...
 * además se asegura de que en caso de que añadamos algún dato adicional en
 * este Json, su sitio estará respondiendo siempre correctamente y con el
 * formato actualizado".
 *
 * Lo único que se hace acá es deshacer el envoltorio (cuando `resultado` viaja
 * como string con el JSON adentro, en form-urlencoded): los objetos de adentro
 * se devuelven por referencia, sin leer ni copiar un solo campo. Así cualquier
 * campo que Pagopar agregue mañana viaja de vuelta solo.
 *
 * Devuelve null si no se pudo aislar el `resultado`; ahí el handler cae al
 * array normalizado, que es lo mejor disponible.
 */
function extraerResultadoCrudo(raw: unknown): unknown[] | null {
  const desdeObjeto = (obj: Record<string, unknown>): unknown[] | null => {
    const r = obj.resultado;

    if (Array.isArray(r)) return r;

    if (typeof r === 'string') {
      // Envoltorio de form-urlencoded: el JSON viaja como texto. Se parsea solo
      // el envoltorio, nunca los objetos de adentro. Si no parsea era el texto
      // de estado ("Pedido encontrado") y no un envoltorio.
      try {
        const parsed: unknown = JSON.parse(r);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') return [parsed];
      } catch {
        // No era un envoltorio
      }
    } else if (r && typeof r === 'object') {
      return [r];
    }

    // Sin envoltorio: la notificación es el objeto mismo
    return obj.hash_pedido ? [obj] : null;
  };

  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) {
    return desdeObjeto(raw as Record<string, unknown>);
  }

  const texto = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : '';
  if (!texto.trim()) return null;

  try {
    const parsed: unknown = JSON.parse(texto);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return desdeObjeto(parsed as Record<string, unknown>);
  } catch {
    // No era JSON: puede ser form-urlencoded
  }

  try {
    const campo = new URLSearchParams(texto).get('resultado');
    if (campo) {
      const parsed: unknown = JSON.parse(campo);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
    }
  } catch {
    // `resultado` no traía JSON; queda la forma anidada, que sí hay que rearmar
  }

  return null;
}

/**
 * Recorta el valor JSON que empieza en `desde`, respetando anidamiento y
 * cadenas. Devuelve el texto exacto, sin normalizar nada.
 */
function recortarValorJson(texto: string, desde: number): string | null {
  const abre = texto[desde];
  if (abre !== '[' && abre !== '{') return null;
  const cierra = abre === '[' ? ']' : '}';

  let profundidad = 0;
  let enCadena = false;
  let escapado = false;

  for (let i = desde; i < texto.length; i++) {
    const c = texto[i];
    if (enCadena) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"') enCadena = true;
    else if (c === abre) profundidad++;
    else if (c === cierra && --profundidad === 0) return texto.slice(desde, i + 1);
  }
  return null;
}

/**
 * El TEXTO exacto del `resultado` tal cual vino en el cuerpo, sin parsearlo ni
 * volver a serializarlo.
 *
 * Devolver el array reserializado no alcanza: un round-trip por JSON.parse +
 * JSON.stringify normaliza cosas que en el texto crudo son distintas — los
 * escapes unicode (é pasa a é), los espacios, y el formato de los números
 * (350000.00 pasa a 350000). El validador de Pagopar compara la respuesta
 * contra lo que envió, así que cualquiera de esas normalizaciones la hace
 * fallar aunque el JSON sea equivalente.
 *
 * Reenviando el texto crudo la respuesta es idéntica byte a byte a lo que ellos
 * mandaron, sin depender de cómo lo serialicen.
 *
 * Devuelve null si no se pudo aislar; ahí el handler cae a serializar el array,
 * que es lo mejor disponible.
 */
function extraerResultadoTextoCrudo(raw: unknown): string | null {
  const texto = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : '';
  if (!texto.trim()) return null;

  const candidatos: string[] = [];

  // JSON: {"resultado": [...]}. Se recorta el valor sin tocar su contenido.
  const iClave = texto.indexOf('"resultado"');
  if (iClave !== -1) {
    const iDosPuntos = texto.indexOf(':', iClave + '"resultado"'.length);
    if (iDosPuntos !== -1) {
      let i = iDosPuntos + 1;
      while (i < texto.length && /\s/.test(texto[i]!)) i++;
      const recorte = recortarValorJson(texto, i);
      if (recorte) candidatos.push(recorte);
    }
  }

  // El cuerpo ya es el array pelado
  const podado = texto.trim();
  if (podado.startsWith('[')) candidatos.push(podado);

  // `resultado` como cadena con el JSON adentro: se parsea SOLO el envoltorio,
  // el texto de adentro viaja intacto.
  try {
    const envoltorio: unknown = JSON.parse(texto);
    if (envoltorio && typeof envoltorio === 'object' && !Array.isArray(envoltorio)) {
      const r = (envoltorio as Record<string, unknown>).resultado;
      if (typeof r === 'string' && r.trim()) candidatos.push(r.trim());
    }
  } catch {
    // No era JSON: puede ser form-urlencoded
  }

  // form-urlencoded: resultado=<json>
  try {
    const campo = new URLSearchParams(texto).get('resultado');
    if (campo?.trim()) candidatos.push(campo.trim());
  } catch {
    // No era form-urlencoded
  }

  for (const candidato of candidatos) {
    try {
      const parsed: unknown = JSON.parse(candidato);
      if (Array.isArray(parsed)) return candidato;
      // Notificación suelta sin array: se envuelve sin tocar el contenido
      if (parsed && typeof parsed === 'object') return `[${candidato}]`;
    } catch {
      // Candidato inválido, se prueba el siguiente
    }
  }

  return null;
}

/**
 * Saca las notificaciones del cuerpo, venga como venga.
 *
 * Pagopar no manda siempre application/json. Segun la integracion postea
 * form-urlencoded con el JSON adentro del campo `resultado`, o el JSON pelado
 * sin Content-Type. El cuerpo llega como texto crudo (ver index.ts) y acá se
 * normaliza a un array de objetos, que es lo único con lo que trabaja el resto
 * del handler.
 *
 * Devuelve [] si no se pudo interpretar: eso termina en 403, que es lo correcto
 * porque sin hash_pedido no hay forma de validar la firma.
 */
function extraerNotificaciones(raw: unknown): NotificacionPagopar[] {
  const comoArray = (valor: unknown): NotificacionPagopar[] => {
    if (Array.isArray(valor)) return valor as NotificacionPagopar[];
    // Una notificación suelta, sin envolver en array
    if (valor && typeof valor === 'object') return [valor as NotificacionPagopar];
    return [];
  };

  const desdeObjeto = (obj: Record<string, unknown>): NotificacionPagopar[] => {
    const r = obj.resultado;

    if (typeof r === 'string') {
      // Ojo: `resultado` es ambiguo. Como envoltorio de form-urlencoded trae el
      // JSON de las notificaciones, pero DENTRO de una notificación es el texto
      // de estado ("Pedido encontrado"). Solo se trata como envoltorio si
      // realmente parsea a objeto; si no, se sigue de largo y se evalúa el
      // objeto como la notificación misma.
      try {
        const parsed: unknown = JSON.parse(r);
        if (parsed && typeof parsed === 'object') return comoArray(parsed);
      } catch {
        // Era el texto de estado, no un JSON
      }
    } else if (r !== undefined) {
      const filas = comoArray(r);
      if (filas.length > 0) return filas;
    }

    // Sin envoltorio: la notificación es el objeto mismo
    return obj.hash_pedido ? [obj as NotificacionPagopar] : [];
  };

  /**
   * form-urlencoded con arrays anidados: `resultado[0][hash_pedido]=abc...`
   * Es como PHP serializa un array por defecto, así que es una forma probable
   * de que llegue. Los valores quedan todos como string —incluido `pagado`,
   * que llega "true"— y de eso ya se ocupa esPagoConfirmado.
   */
  const desdeFormAnidado = (texto: string): NotificacionPagopar[] => {
    const porIndice = new Map<string, Record<string, unknown>>();
    for (const [clave, valor] of new URLSearchParams(texto)) {
      const m = /^resultado\[(\d*)\]\[([^\]]+)\]$/.exec(clave);
      if (!m) continue;
      const idx = m[1] || '0';
      const fila = porIndice.get(idx) ?? {};
      fila[m[2]] = valor;
      porIndice.set(idx, fila);
    }
    return [...porIndice.values()] as NotificacionPagopar[];
  };

  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) {
    return desdeObjeto(raw as Record<string, unknown>);
  }

  const texto = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : '';
  if (!texto.trim()) return [];

  // JSON pelado
  try {
    const parsed: unknown = JSON.parse(texto);
    if (parsed && typeof parsed === 'object') {
      const filas = desdeObjeto(parsed as Record<string, unknown>);
      if (filas.length > 0) return filas;
    }
  } catch {
    // No era JSON: se intenta como form-urlencoded
  }

  try {
    const form = new URLSearchParams(texto);
    const campo = form.get('resultado');
    if (campo) {
      const filas = comoArray(JSON.parse(campo));
      if (filas.length > 0) return filas;
    }
  } catch {
    // `resultado` no traía JSON; puede ser la forma anidada
  }

  return desdeFormAnidado(texto);
}

/** Campos de la notificación que traen datos personales del comprador */
const CAMPOS_SENSIBLES = new Set([
  'token',
  'documento_comprador',
  'email_comprador',
  'telefono_comprador',
  'nombre_comprador',
  'direccion_comprador',
]);

/**
 * Deja el payload COMPLETO en los logs, que es la única forma de saber qué
 * manda Pagopar de verdad en cada tipo de pago (la doc no detalla el formato
 * exacto de cada medio). Los datos del comprador y el token van enmascarados:
 * el resto se imprime tal cual, con su tipo, porque justamente el tipo es lo
 * que importa — Pagopar puede mandar `pagado` como booleano, como "1" o como
 * "true" según el medio de pago, y en JavaScript el string "false" es truthy.
 */
function logNotificacion(notif: NotificacionPagopar): void {
  const visible: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(notif)) {
    visible[clave] = CAMPOS_SENSIBLES.has(clave)
      ? `«oculto»(${typeof valor})`
      : `${JSON.stringify(valor)} (${typeof valor})`;
  }
  console.log('[pagopar] notificación recibida:', JSON.stringify(visible, null, 2));
}

/**
 * ¿Esta notificación confirma un pago?
 *
 * Pagopar es PHP y no serializa los booleanos de forma consistente: según el
 * medio de pago el mismo campo puede llegar como `true`, `"true"`, `1` o `"1"`.
 * El chequeo anterior era `!notif.pagado`, que además de perderse esos casos
 * tenía el problema inverso y peor: el string `"false"` es truthy en
 * JavaScript, así que un pago NO realizado se habría dado por bueno.
 *
 * Se acepta también `estado`/`pagado_monto` como respaldo, pero se loguea
 * cuando el campo esperado no vino, para poder confirmarlo contra un payload
 * real en vez de seguir adivinando.
 */
function esPagoConfirmado(notif: NotificacionPagopar): boolean {
  const interpretar = (valor: unknown): boolean | null => {
    if (typeof valor === 'boolean') return valor;
    if (typeof valor === 'number') return valor === 1;
    if (typeof valor === 'string') {
      const v = valor.trim().toLowerCase();
      if (['true', '1', 't', 'si', 'sí', 'yes'].includes(v)) return true;
      if (['false', '0', 'f', 'no', ''].includes(v)) return false;
    }
    return null;
  };

  const directo = interpretar(notif.pagado);
  if (directo !== null) return directo;

  console.warn(
    `[pagopar] la notificación no trae un campo 'pagado' interpretable ` +
      `(llegó ${JSON.stringify(notif.pagado)}). Campos presentes: ` +
      `${Object.keys(notif).join(', ')}`,
  );
  return false;
}

/**
 * El monto que informa Pagopar, como número.
 *
 * Viene a veces como número y a veces como string, y según el medio de pago
 * puede traer decimales ("350000.00"). El guaraní no usa centavos, así que se
 * redondea: lo que importa es que sean los mismos 350.000, no el formato.
 *
 * Devuelve null cuando el campo no vino o no se puede interpretar. Ahí NO se
 * bloquea el pago: un campo ausente es un problema de formato de Pagopar, y
 * dejar a un cliente que pagó sin su plan es peor que activar sin comparar.
 */
export function montoInformado(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return Math.round(valor);
  if (typeof valor === 'string') {
    let limpio = valor.trim().replace(/\s/g, '');
    if (!limpio) return null;
    // Coma como separador decimal ("350000,00"). Se acepta solo con uno o dos
    // decimales: asi no se confunde con una coma de miles, donde interpretar
    // mal daria un monto distinto y bloquearia un pago legitimo.
    if (/^-?\d+,\d{1,2}$/.test(limpio)) limpio = limpio.replace(',', '.');
    const n = Number(limpio);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

export type VeredictoMonto = 'coincide' | 'distinto' | 'sin-dato';

/**
 * Qué hacer con el monto que informó Pagopar.
 *
 * 'sin-dato' activa igual: un campo ausente es un problema de formato de
 * Pagopar, y dejar sin plan a alguien que pagó es peor que activar sin
 * comparar. 'distinto' no activa nada.
 */
export function veredictoMonto(esperado: number, informadoCrudo: unknown): VeredictoMonto {
  const informado = montoInformado(informadoCrudo);
  if (informado === null) return 'sin-dato';
  return informado === Math.round(esperado) ? 'coincide' : 'distinto';
}

/**
 * Avisa que llegó un pago por un monto distinto al del pedido.
 *
 * Va por email y no solo al log porque es plata: alguien pagó algo y su plan
 * no se activó, así que hay una persona esperando del otro lado. Nunca lanza.
 */
async function avisarMontoDistinto(
  order: { idPedidoComercio: string; plan: string; montoTotal: number; userId: string },
  informado: number,
  origen: string,
): Promise<void> {
  const linea = (k: string, v: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#666;">${escaparHtml(k)}</td>` +
    `<td style="padding:6px 0;"><strong>${escaparHtml(v)}</strong></td></tr>`;
  try {
    await sendEmail(
      env.ADMIN_EMAIL,
      `Pagopar informó un monto distinto — pedido ${order.idPedidoComercio}`,
      `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <p style="font-size:20px;font-weight:bold;color:#7C3AED;margin:0 0 20px;">BotForge</p>
    <p style="background:#FEF2F2;border:1px solid #FECACA;color:#B91C1C;font-size:14px;font-weight:bold;border-radius:8px;padding:10px 14px;margin:0 0 20px;">
      El plan NO se activó. Llegó una confirmación de pago por un monto que no coincide con el pedido.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333333;margin:0 0 20px;">
      ${linea('Pedido', order.idPedidoComercio)}
      ${linea('Plan', order.plan)}
      ${linea('Monto del pedido', `Gs. ${order.montoTotal.toLocaleString('es-PY')}`)}
      ${linea('Monto informado', `Gs. ${informado.toLocaleString('es-PY')}`)}
      ${linea('Origen', origen)}
      ${linea('Usuario', order.userId)}
    </table>
    <p style="font-size:14px;line-height:1.6;color:#333333;margin:0;">
      Revisalo en el panel de Pagopar antes de activar nada a mano. Si el pago es legítimo,
      el cliente está esperando su plan.
    </p>
  </div>
</body></html>`,
    );
  } catch (err) {
    console.error('[pagopar] no se pudo avisar del monto distinto:', err);
  }
}

/**
 * Marca el pedido como pagado y activa el plan. Idempotente: el `pagado: false`
 * en el where hace que solo gane el primero que llegue, así el webhook y la
 * consulta al volver del checkout no pueden aplicar el plan dos veces.
 *
 * Devuelve true si esta llamada fue la que lo activó.
 */
async function activarPlan(
  order: { id: string; userId: string; plan: string; idPedidoComercio: string; montoTotal: number },
  fechaPago: Date,
  origen: 'webhook' | 'consulta',
  /** Datos del cobro que informa Pagopar. Se guardan para conciliar después. */
  cobro: { formaPago?: string | null; numeroComprobante?: string | null; monto?: unknown } = {},
): Promise<boolean> {
  // El monto se compara ANTES de tocar la base.
  //
  // La firma de la notificación liga el token al hash del pedido, así que el
  // comprador no elige cuánto pagar. Lo que esto cubre es el caso de un pago
  // parcial que Pagopar reporte igual como pagado: sin comparar, unos pocos
  // guaraníes activaban un plan de 750.000.
  const veredicto = veredictoMonto(order.montoTotal, cobro.monto);
  if (veredicto === 'distinto') {
    const informado = montoInformado(cobro.monto)!;
    console.error(
      `[pagopar] MONTO DISTINTO — pedido ${order.idPedidoComercio} (${origen}): ` +
        `esperado ${order.montoTotal}, informado ${informado}. El plan NO se activa.`,
    );
    await avisarMontoDistinto(order, informado, origen);
    return false;
  }
  if (veredicto === 'sin-dato') {
    // No bloquea, pero queda el rastro para poder mirarlo contra un payload real
    console.warn(
      `[pagopar] la notificación del pedido ${order.idPedidoComercio} no trae un monto ` +
        `interpretable (llegó ${JSON.stringify(cobro.monto)}); se activa sin comparar`,
    );
  }

  const marcado = await prisma.pagoparOrder.updateMany({
    where: { id: order.id, pagado: false },
    data: {
      pagado: true,
      fechaPago,
      // Solo se escriben si vinieron: un undefined dejaría la columna intacta,
      // pero un null explícito borraría lo que ya se había guardado
      ...(cobro.formaPago ? { formaPago: cobro.formaPago } : {}),
      ...(cobro.numeroComprobante ? { numeroComprobante: cobro.numeroComprobante } : {}),
    },
  });

  if (marcado.count === 0) {
    console.log(`[pagopar] pedido ${order.idPedidoComercio} ya estaba pagado (${origen})`);
    return false;
  }

  // El vencimiento se APILA sobre lo que le quedaba, no lo pisa: quien renueva
  // antes de tiempo perdia los dias que ya habia pagado.
  //
  // Solo se apila si renueva el MISMO plan. Al cambiar de plan se arranca de
  // cero: sumarle a un Basico los dias que le quedaban de Profesional, o al
  // reves, seria regalar o cobrar de mas segun el caso.
  const usuario = await prisma.user.findUnique({
    where: { id: order.userId },
    select: { plan: true, planExpiresAt: true },
  });

  const vigenteHasta = usuario?.planExpiresAt?.getTime() ?? 0;
  const mismoPlan = usuario?.plan === order.plan;
  const base = mismoPlan && vigenteHasta > Date.now() ? vigenteHasta : Date.now();
  const validaHasta = new Date(base + PLAN_DURACION_MS);

  await prisma.user.update({
    where: { id: order.userId },
    data: { plan: order.plan as Plan, planExpiresAt: validaHasta },
  });

  console.log(
    `[pagopar] pago confirmado por ${origen} — pedido ${order.idPedidoComercio}, ` +
      `plan ${order.plan} activo hasta ${validaHasta.toISOString()}`,
  );
  return true;
}

router.post('/webhook', async (req: Request, res: Response) => {
  const notificaciones = extraerNotificaciones(req.body);
  const resultadoCrudo = extraerResultadoCrudo(req.body);
  const notif = notificaciones[0];

  const hashPedido = typeof notif?.hash_pedido === 'string' ? notif.hash_pedido : '';
  const token = typeof notif?.token === 'string' ? notif.token : '';

  if (notificaciones.length === 0) {
    // Sin cuerpo interpretable no se puede ni validar la firma. Se loguea el
    // tipo (nunca el contenido: trae datos del comprador) para poder ver desde
    // los logs si Pagopar cambió cómo postea.
    console.warn(
      `[pagopar] Notificación ilegible — content-type: ${req.headers['content-type'] ?? 'ninguno'}, ` +
        `body: ${typeof req.body}`,
    );
  }

  // Validar SIEMPRE antes de tocar la base
  if (!validarNotificacion(hashPedido, token)) {
    console.warn('[pagopar] Notificación rechazada: token inválido');
    res.status(403).send('Forbidden');
    return;
  }

  // El payload completo va al log SIEMPRE, incluso si después no confirma
  // pago: es lo único que permite ver qué manda Pagopar en cada medio
  if (notif) logNotificacion(notif);

  try {
    const order = await prisma.pagoparOrder.findUnique({ where: { hashPedido } });

    if (!order) {
      console.warn('[pagopar] Notificación de un pedido desconocido');
    } else if (!esPagoConfirmado(notif!)) {
      console.log('[pagopar] Notificación recibida sin pago confirmado:', order.idPedidoComercio);
    } else {
      const fechaPago = notif!.fecha_pago ? new Date(String(notif!.fecha_pago)) : new Date();
      // Fecha inválida (Pagopar la manda como "YYYY-MM-DD HH:mm:ss", que algunos
      // motores no parsean): no puede impedir que se active el plan
      const texto = (campo: unknown): string | null =>
        typeof campo === 'string' && campo.trim() ? campo.trim()
          : typeof campo === 'number' ? String(campo)
            : null;

      await activarPlan(
        order,
        Number.isNaN(fechaPago.getTime()) ? new Date() : fechaPago,
        'webhook',
        {
          formaPago: texto(notif!.forma_pago),
          // Pagopar lo manda como string, pero según el medio puede venir
          // numérico; se normaliza a texto para no perder ceros a la izquierda
          numeroComprobante: texto(notif!.numero_comprobante_interno),
          monto: notif!.monto,
        },
      );
    }
  } catch (err) {
    // Un fallo acá significa un pago cobrado que no activó el plan: es de los
    // errores más caros del sistema y tiene que avisar, no solo loguear.
    reportarError('pagopar-webhook', err, { hashPedido: hashPedido.slice(0, 12) });
  }

  // Eco del `resultado` que llegó, TAL CUAL, con 200 aunque algo haya fallado
  // de nuestro lado: si no, Pagopar reintenta indefinidamente.
  //
  // Se reenvía `resultadoCrudo`, que son los objetos originales de la
  // notificación sin tocar un solo campo, y no `notificaciones`, que pasa por
  // la normalización interna. La normalización existe para poder leer la
  // notificación venga como venga, pero rearma los objetos campo por campo
  // cuando el cuerpo llega como form anidado, y ahí se pierde todo lo que no
  // sea un campo plano — los sub-objetos y cualquier campo nuevo.
  //
  // Es lo que pidió Pagopar para cerrar el paso 2 del circuito: reenviar su
  // JSON sin rearmarlo, así la respuesta sigue siendo correcta aunque ellos
  // agreguen campos más adelante.
  //
  // Va el ARRAY PELADO, no envuelto en { resultado: ... }. La documentación de
  // Pagopar muestra la respuesta esperada como `[ { ... } ]` y pide "devolver
  // directamente el contenido de resultado del JSON enviado por Pagopar".
  // Envolverlo era lo que mantenía el paso 2 del circuito sin cerrar.
  //
  // Y va como TEXTO CRUDO, no reserializado: así la respuesta es idéntica byte
  // a byte a lo que ellos mandaron, sin que un round-trip por JSON les cambie
  // los escapes unicode, los espacios ni el formato de los números.
  const cuerpoRespuesta =
    extraerResultadoTextoCrudo(req.body) ?? JSON.stringify(resultadoCrudo ?? notificaciones);

  res.status(200).type('application/json; charset=utf-8').send(cuerpoRespuesta);
});

// ─── GET /consultar/:hashPedido ───────────────────────────────────────────────
router.get(
  '/consultar/:hashPedido',
  requireAuth,
  requireVerifiedEmail,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { hashPedido } = req.params;

      const order = await prisma.pagoparOrder.findUnique({ where: { hashPedido } });
      if (!order) throw new AppError(404, 'Pedido no encontrado');
      // Sin esta comprobación cualquier usuario logueado podría consultar
      // el pedido de otro con solo tener el hash
      if (order.userId !== req.user!.userId) throw new AppError(403, 'Acceso denegado');

      const remoto = await consultarPedido(hashPedido);

      // Si Pagopar dice que está pagado y nuestra base no, se activa acá.
      //
      // Antes esta consulta calculaba `pagado` para mostrarlo y no escribía
      // nada: si el webhook no llegaba —URL mal configurada, caída, timeout,
      // Pagopar sin reintentar— el usuario pagaba, esta pantalla le decía
      // "pagado", y el plan nunca se le activaba. El webhook sigue siendo el
      // camino principal; esto es la red de contención.
      let pagado = order.pagado;
      if (!pagado && remoto?.pagado === true) {
        const fecha = remoto.fecha_pago ? new Date(remoto.fecha_pago) : new Date();
        await activarPlan(
          order,
          Number.isNaN(fecha.getTime()) ? new Date() : fecha,
          'consulta',
          {
            formaPago: remoto.forma_pago ?? null,
            numeroComprobante: remoto.numero_comprobante_interno ?? null,
            monto: remoto.monto,
          },
        );
        pagado = true;
      }

      res.json({
        data: {
          plan: order.plan,
          montoTotal: order.montoTotal,
          pagado,
          confirmadoPorWebhook: order.pagado,
          fechaPago: order.fechaPago,
          // Lo guardado manda; si el pedido es viejo y no tiene nada, se cae a
          // lo que responda Pagopar en esta consulta
          formaPago: order.formaPago ?? remoto?.forma_pago ?? null,
          numeroComprobante: order.numeroComprobante ?? remoto?.numero_comprobante_interno ?? null,
          cancelado: remoto?.cancelado ?? false,
        },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
