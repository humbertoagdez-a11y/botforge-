import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
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
 * Marca el pedido como pagado y activa el plan. Idempotente: el `pagado: false`
 * en el where hace que solo gane el primero que llegue, así el webhook y la
 * consulta al volver del checkout no pueden aplicar el plan dos veces.
 *
 * Devuelve true si esta llamada fue la que lo activó.
 */
async function activarPlan(
  order: { id: string; userId: string; plan: string; idPedidoComercio: string },
  fechaPago: Date,
  origen: 'webhook' | 'consulta',
  /** Datos del cobro que informa Pagopar. Se guardan para conciliar después. */
  cobro: { formaPago?: string | null; numeroComprobante?: string | null } = {},
): Promise<boolean> {
  const validaHasta = new Date(Date.now() + PLAN_DURACION_MS);

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
        },
      );
    }
  } catch (err) {
    console.error('[pagopar] Error procesando la notificación:', err);
  }

  // Eco de las MISMAS notificaciones que llegaron, con 200 aunque algo haya
  // fallado de nuestro lado: si no, Pagopar reintenta indefinidamente.
  //
  // Va el array de objetos ya normalizado, no el body crudo: cuando Pagopar
  // postea form-urlencoded, `resultado` viaja como un string con el JSON
  // adentro, y devolver eso tal cual hacía que Pagopar leyera un string donde
  // espera objetos — de ahí que no encontrara forma_pago ni
  // numero_comprobante_interno en la respuesta.
  res.status(200).json({ resultado: notificaciones });
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
