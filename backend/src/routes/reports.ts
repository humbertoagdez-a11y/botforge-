/**
 * Reportes semanales. Todo el router exige sesion con email verificado, y
 * ademas cada endpoint verifica dos cosas por separado:
 *   1. que el bot sea del usuario (pertenencia)
 *   2. que su plan vigente incluya reportes (effectivePlan, no user.plan)
 * Son chequeos independientes a proposito: un PRO no puede ver el reporte de un
 * bot ajeno, y un STARTER no puede ver ni el de los propios.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { PLAN_LIMIT_CODE, effectivePlan } from '../middleware/planLimits';
import { env } from '../config/env';
import {
  generarYGuardar,
  planIncluyeReportes,
  semanaAnterior,
  type WeeklyReportContent,
} from '../services/weeklyReport';
import { nombreArchivoPdf, renderWeeklyReportPdf } from '../services/weeklyReportPdf';
import { agregarConocimiento, LimiteDocumentosError } from '../services/knowledge';

const router = Router();
router.use(requireAuth, requireVerifiedEmail);

/** Corta si el plan vigente del usuario no incluye reportes semanales */
async function assertPlanConReportes(userId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
  if (!planIncluyeReportes(user)) {
    const plan = effectivePlan(user);
    throw new AppError(
      403,
      user.plan !== 'FREE' && plan === 'FREE'
        ? 'Tu plan venció. Renovalo desde Planes para volver a recibir los reportes semanales.'
        : 'Los reportes semanales están disponibles desde el plan Profesional. Actualizá tu plan para activarlos.',
      PLAN_LIMIT_CODE,
      { plan, feature: 'weeklyReports' },
    );
  }
}

/** Devuelve el bot solo si es del usuario. 404 si no existe, 403 si es ajeno. */
async function getOwnedBot(botId: string, userId: string) {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { id: true, name: true, userId: true },
  });
  if (!bot) throw new AppError(404, 'Bot no encontrado');
  if (bot.userId !== userId) throw new AppError(403, 'Ese bot no pertenece a tu cuenta');
  return bot;
}

/**
 * Reporte + su bot, verificando pertenencia. Se resuelve el bot desde el
 * reporte y recien ahi se compara el dueño: nunca se confia en un botId que
 * venga del cliente.
 */
async function getOwnedReport(reportId: string, userId: string) {
  const report = await prisma.weeklyReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      botId: true,
      weekStart: true,
      weekEnd: true,
      content: true,
      generatedAt: true,
      bot: { select: { id: true, name: true, userId: true } },
    },
  });
  if (!report) throw new AppError(404, 'Reporte no encontrado');
  if (report.bot.userId !== userId) throw new AppError(403, 'Ese reporte no pertenece a tu cuenta');
  return report;
}

// ─── GET /reports?botId=X — listado ───────────────────────────────────────────
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConReportes(userId);

      const botId = typeof req.query.botId === 'string' ? req.query.botId : undefined;
      if (botId) await getOwnedBot(botId, userId);

      const reports = await prisma.weeklyReport.findMany({
        // Sin botId, solo los de bots del usuario: nunca un findMany abierto
        where: botId ? { botId } : { bot: { userId } },
        orderBy: { weekStart: 'desc' },
        take: 26, // medio año de historial es suficiente para la pantalla
        select: {
          id: true,
          botId: true,
          weekStart: true,
          weekEnd: true,
          generatedAt: true,
          content: true,
          bot: { select: { name: true } },
        },
      });

      res.json({
        data: {
          reports: reports.map((r) => {
            const c = r.content as unknown as WeeklyReportContent;
            return {
              id: r.id,
              botId: r.botId,
              botName: r.bot.name,
              weekStart: r.weekStart,
              weekEnd: r.weekEnd,
              generatedAt: r.generatedAt,
              // Solo lo necesario para las tarjetas del listado
              resumen: {
                totalConversations: c.totalConversations,
                totalMessages: c.totalMessages,
                humanRequestedCount: c.humanRequestedCount,
                npsAverage: c.npsAverage,
                unansweredCount: c.unansweredQuestions.length,
              },
            };
          }),
        },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  })();
});

// ─── GET /reports/:id — detalle ───────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConReportes(userId);
      const report = await getOwnedReport(req.params.id, userId);

      res.json({
        data: {
          id: report.id,
          botId: report.botId,
          botName: report.bot.name,
          weekStart: report.weekStart,
          weekEnd: report.weekEnd,
          generatedAt: report.generatedAt,
          content: report.content,
        },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  })();
});

// ─── GET /reports/:id/export — PDF ────────────────────────────────────────────
router.get('/:id/export', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConReportes(userId);
      const report = await getOwnedReport(req.params.id, userId);

      const pdf = await renderWeeklyReportPdf({
        botName: report.bot.name,
        weekStart: report.weekStart,
        weekEnd: report.weekEnd,
        content: report.content as unknown as WeeklyReportContent,
      });

      const filename = nombreArchivoPdf(report.bot.name, report.weekStart);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(pdf.length));
      res.send(pdf);
    } catch (err) {
      next(err);
    }
  })();
});

// ─── POST /reports/:id/knowledge — "Agregar esta información" ─────────────────
const knowledgeSchema = z.object({
  titulo: z.string().min(3).max(120),
  contenido: z.string().min(10).max(5000),
});

router.post('/:id/knowledge', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConReportes(userId);
      // El bot sale del reporte, no del body: el cliente no elige a qué bot escribe
      const report = await getOwnedReport(req.params.id, userId);

      const parsed = knowledgeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'Datos inválidos', 'VALIDATION_ERROR', parsed.error.flatten());
      }

      const doc = await agregarConocimiento({
        botId: report.botId,
        userId,
        titulo: parsed.data.titulo,
        contenido: parsed.data.contenido,
      });

      res.status(201).json({
        data: {
          documentId: doc.documentId,
          name: doc.name,
          mensaje: 'Listo. En uno o dos minutos tu bot ya va a poder responder esto.',
        },
        error: null,
        meta: null,
      });
    } catch (err) {
      if (err instanceof LimiteDocumentosError) {
        next(new AppError(403, err.message, PLAN_LIMIT_CODE));
        return;
      }
      next(err);
    }
  })();
});

// ─── POST /reports/generate — generar a demanda ───────────────────────────────
// Sirve para probar sin esperar al lunes y para que el usuario se genere el
// reporte de la semana pasada si su bot se creó después de la corrida.
const generateSchema = z.object({
  botId: z.string().uuid(),
  /** Lunes 00:00 UTC de la semana a cubrir. Por defecto, la que terminó. */
  weekStart: z.string().datetime().optional(),
});

router.post('/generate', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConReportes(userId);

      const parsed = generateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'Datos inválidos', 'VALIDATION_ERROR', parsed.error.flatten());
      }
      const bot = await getOwnedBot(parsed.data.botId, userId);

      let { weekStart, weekEnd } = semanaAnterior();
      if (parsed.data.weekStart) {
        // Semanas arbitrarias solo en desarrollo: en producción, que el usuario
        // pueda pedir cualquier rango es trabajo de base sin límite claro
        if (env.NODE_ENV === 'production') {
          throw new AppError(400, 'Solo se puede generar el reporte de la semana pasada');
        }
        weekStart = new Date(parsed.data.weekStart);
        weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);
      }

      const { id, content } = await generarYGuardar(bot.id, weekStart, weekEnd);
      res.status(201).json({
        data: { id, botId: bot.id, botName: bot.name, weekStart, weekEnd, content },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  })();
});

export default router;
