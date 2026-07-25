import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
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

router.post('/checkout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { plan } = checkoutSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });

    const { checkoutUrl, hashPedido } = await iniciarTransaccion(
      user.id,
      user.email,
      user.name,
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
// con el token sha1. Se responde el MISMO JSON recibido, que es lo que Pagopar
// espera para dar la notificación por entregada.

interface NotificacionPagopar {
  pagado?: boolean;
  hash_pedido?: string;
  token?: string;
  forma_pago?: string;
  fecha_pago?: string | null;
}

router.post('/webhook', async (req: Request, res: Response) => {
  const body = req.body as { resultado?: NotificacionPagopar[] };
  const notif = Array.isArray(body?.resultado) ? body.resultado[0] : undefined;

  const hashPedido = notif?.hash_pedido ?? '';
  const token = notif?.token ?? '';

  // Validar SIEMPRE antes de tocar la base
  if (!validarNotificacion(hashPedido, token)) {
    console.warn('[pagopar] Notificación rechazada: token inválido');
    res.status(403).send('Forbidden');
    return;
  }

  try {
    const order = await prisma.pagoparOrder.findUnique({ where: { hashPedido } });

    if (!order) {
      console.warn('[pagopar] Notificación de un pedido desconocido');
    } else if (!notif?.pagado) {
      console.log('[pagopar] Notificación recibida sin pago confirmado:', order.idPedidoComercio);
    } else if (order.pagado) {
      // Pagopar reintenta si no recibe el 200: no volver a aplicar el plan
      console.log('[pagopar] Notificación duplicada ignorada:', order.idPedidoComercio);
    } else {
      const fechaPago = notif.fecha_pago ? new Date(notif.fecha_pago) : new Date();
      const validaHasta = new Date(Date.now() + PLAN_DURACION_MS);

      await prisma.$transaction([
        prisma.pagoparOrder.update({
          where: { id: order.id },
          data: { pagado: true, fechaPago },
        }),
        prisma.user.update({
          where: { id: order.userId },
          data: { plan: order.plan as Plan, planExpiresAt: validaHasta },
        }),
      ]);

      console.log('[pagopar] Pago confirmado, plan actualizado:', order.plan);
    }
  } catch (err) {
    console.error('[pagopar] Error procesando la notificación:', err);
  }

  // Devolver el mismo JSON con 200, aunque algo haya fallado de nuestro lado:
  // si no, Pagopar reintenta indefinidamente
  res.status(200).json(body);
});

// ─── GET /consultar/:hashPedido ───────────────────────────────────────────────
router.get(
  '/consultar/:hashPedido',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { hashPedido } = req.params;

      const order = await prisma.pagoparOrder.findUnique({ where: { hashPedido } });
      if (!order) throw new AppError(404, 'Pedido no encontrado');
      // Sin esta comprobación cualquier usuario logueado podría consultar
      // el pedido de otro con solo tener el hash
      if (order.userId !== req.user!.userId) throw new AppError(403, 'Acceso denegado');

      const remoto = await consultarPedido(hashPedido);

      res.json({
        data: {
          plan: order.plan,
          montoTotal: order.montoTotal,
          // La base manda: la marca el webhook tras validar el token
          pagado: order.pagado || remoto?.pagado === true,
          confirmadoPorWebhook: order.pagado,
          fechaPago: order.fechaPago,
          formaPago: remoto?.forma_pago ?? null,
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
