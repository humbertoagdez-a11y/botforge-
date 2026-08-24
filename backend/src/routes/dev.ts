import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { generateDailySummaries } from '../services/dailySummary';
import { downgradeExpiredPlans, notifyExpiringSoon } from '../services/planExpiration';
import { reportarError } from '../lib/monitoring';
import { sentryHabilitado } from '../instrument';

const router = Router();
router.use(requireAuth);
router.use(requireVerifiedEmail);

/**
 * Permite ejecutar tareas de mantenimiento manualmente. En producción solo lo
 * puede usar el primer usuario creado (dueño de la plataforma); en dev, cualquiera.
 */
async function assertCanRunDevTasks(userId: string): Promise<void> {
  if (env.NODE_ENV !== 'production') return;
  const firstUser = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!firstUser || firstUser.id !== userId) {
    throw new AppError(403, 'Solo el administrador puede ejecutar esta acción');
  }
}

// POST /api/v1/dev/trigger-daily-summary — dispara el resumen diario ahora
router.post('/trigger-daily-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertCanRunDevTasks(req.user!.userId);
    const sent = await generateDailySummaries();
    res.json({ data: { sent }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/dev/trigger-plan-expiration — corre el vencimiento de planes ahora
router.post('/trigger-plan-expiration', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertCanRunDevTasks(req.user!.userId);
    const notified = await notifyExpiringSoon();
    const downgraded = await downgradeExpiredPlans();
    res.json({ data: { downgraded, notified }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/dev/probar-monitoreo — dispara un error a propósito.
 *
 * Sirve para confirmar de punta a punta que Sentry está bien conectado: se
 * llama una vez después de cargar SENTRY_DSN en Railway y tiene que aparecer
 * el error en el panel en menos de un minuto.
 *
 * Vive acá y no como endpoint suelto porque este router ya exige sesión y, en
 * producción, que seas el dueño de la plataforma. No expone nada: solo tira una
 * excepción con un mensaje fijo.
 */
router.post('/probar-monitoreo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertCanRunDevTasks(req.user!.userId);

    if (!sentryHabilitado) {
      throw new AppError(
        503,
        'SENTRY_DSN no está configurado en este entorno, así que no hay a dónde reportar. Cargalo en Railway y reintentá.',
      );
    }

    const marca = new Date().toISOString();
    reportarError(
      'prueba-de-monitoreo',
      new Error(`Error de prueba disparado a mano — ${marca}`),
      { origen: 'endpoint-dev' },
    );

    res.json({
      data: {
        reportado: true,
        marca,
        mensaje:
          'Listo. Buscá en Sentry un issue llamado "Error de prueba disparado a mano". Si no aparece en un minuto, revisá que el DSN esté bien cargado.',
      },
      error: null,
      meta: null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/dev/my-outbound-ip — con qué IP pública sale este proceso a
 * internet ahora mismo.
 *
 * Temporal: se agregó para confirmar empíricamente la IP saliente de Railway
 * antes de cargarla como "IP habilitada" en el panel de Pagopar. Se puede
 * borrar una vez confirmada, o dejar — no expone nada sensible, solo pega a
 * un servicio público que devuelve la IP del que llama.
 */
router.get('/my-outbound-ip', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertCanRunDevTasks(req.user!.userId);

    const r = await fetch('https://api.ipify.org?format=json');
    if (!r.ok) {
      throw new AppError(502, 'No se pudo consultar el servicio externo de IP (api.ipify.org)');
    }
    const { ip } = (await r.json()) as { ip: string };

    res.json({ data: { ip }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

export default router;
