/**
 * Informes semanales (individuales y consolidado de Agencia).
 *
 * Todo el router exige sesion con email verificado, y ademas cada endpoint
 * verifica dos cosas POR SEPARADO:
 *   1. pertenencia — que el bot / informe / consolidado sea del usuario
 *   2. plan — que su plan VIGENTE (effectivePlan, no user.plan) lo incluya
 * Son chequeos independientes a proposito: un Agencia no puede ver el informe
 * de un bot ajeno, y un Profesional no puede ver el consolidado ni pidiendolo
 * directo por API.
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
  getTrendHistory,
  planIncluyeConsolidado,
  planIncluyeReportes,
  semanaAnterior,
  type WeeklyReportContent,
} from '../services/weeklyReport';
import {
  generarYGuardarConsolidado,
  type ConsolidatedContent,
} from '../services/consolidatedReport';
import {
  nombreArchivoPdf,
  renderConsolidatedPdf,
  renderWeeklyReportPdf,
} from '../services/weeklyReportPdf';
import { agregarConocimiento, LimiteDocumentosError } from '../services/knowledge';

const router = Router();
router.use(requireAuth, requireVerifiedEmail);

// ─── Guardas ──────────────────────────────────────────────────────────────────

async function getUser(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
}

/** Corta si el plan vigente no incluye los informes semanales */
async function assertPlanConReportes(userId: string): Promise<void> {
  const user = await getUser(userId);
  if (planIncluyeReportes(user)) return;
  throw new AppError(
    403,
    user.plan !== 'FREE' && effectivePlan(user) === 'FREE'
      ? 'Tu plan venció. Renovalo desde Planes para volver a recibir los informes semanales.'
      : 'Los informes semanales están disponibles desde el plan Profesional. Actualizá tu plan para activarlos.',
    PLAN_LIMIT_CODE,
    { plan: effectivePlan(user), feature: 'weeklyReports' },
  );
}

/** Corta si el plan vigente no incluye el consolidado. Solo Agencia. */
async function assertPlanConConsolidado(userId: string): Promise<void> {
  const user = await getUser(userId);
  if (planIncluyeConsolidado(user)) return;
  throw new AppError(
    403,
    user.plan !== 'FREE' && effectivePlan(user) === 'FREE'
      ? 'Tu plan venció. Renovalo desde Planes para volver a ver el informe consolidado.'
      : 'El informe consolidado que compara todos tus bots está disponible en el plan Agencia.',
    PLAN_LIMIT_CODE,
    { plan: effectivePlan(user), feature: 'consolidatedReports' },
  );
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
 * Informe + su bot, verificando pertenencia. Se resuelve el bot DESDE el
 * informe y recién ahí se compara el dueño: nunca se confía en un botId que
 * venga del cliente.
 */
async function getOwnedReport(reportId: string, userId: string) {
  const report = await prisma.weeklyReport.findUnique({
    where: { id: reportId },
    select: {
      id: true, botId: true, weekStart: true, weekEnd: true,
      content: true, generatedAt: true,
      bot: { select: { id: true, name: true, userId: true } },
    },
  });
  if (!report) throw new AppError(404, 'Informe no encontrado');
  if (report.bot.userId !== userId) throw new AppError(403, 'Ese informe no pertenece a tu cuenta');
  return report;
}

/** Consolidado, verificando que sea del usuario que lo pide */
async function getOwnedConsolidated(id: string, userId: string) {
  const rep = await prisma.consolidatedReport.findUnique({
    where: { id },
    select: { id: true, userId: true, weekStart: true, weekEnd: true, content: true, generatedAt: true },
  });
  if (!rep) throw new AppError(404, 'Informe consolidado no encontrado');
  if (rep.userId !== userId) throw new AppError(403, 'Ese informe no pertenece a tu cuenta');
  return rep;
}

/** Envía un PDF ya renderizado como descarga */
function enviarPdf(res: Response, pdf: Buffer, filename: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.send(pdf);
}

// ─── GET /reports?botId=X — listado de individuales ───────────────────────────
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConReportes(userId);
      const user = await getUser(userId);

      const botId = typeof req.query.botId === 'string' ? req.query.botId : undefined;
      if (botId) await getOwnedBot(botId, userId);

      const [reports, bots] = await Promise.all([
        prisma.weeklyReport.findMany({
          // Sin botId, solo los de bots del usuario: nunca un findMany abierto
          where: botId ? { botId } : { bot: { userId } },
          orderBy: { weekStart: 'desc' },
          take: 60,
          select: {
            id: true, botId: true, weekStart: true, weekEnd: true,
            generatedAt: true, content: true,
            bot: { select: { name: true } },
          },
        }),
        prisma.bot.findMany({
          where: { userId, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
        }),
      ]);

      res.json({
        data: {
          bots,
          // El frontend no infiere de user.plan: eso ignoraría el vencimiento
          capabilities: { consolidated: planIncluyeConsolidado(user) },
          reports: reports.map((r) => {
            const c = r.content as unknown as Partial<WeeklyReportContent>;
            return {
              id: r.id,
              botId: r.botId,
              botName: r.bot.name,
              weekStart: r.weekStart,
              weekEnd: r.weekEnd,
              generatedAt: r.generatedAt,
              // Solo lo necesario para las tarjetas del listado
              resumen: {
                totalConversations: c.totalConversations ?? 0,
                totalMessages: c.totalMessages ?? 0,
                humanRequestedCount: c.humanRequestedCount ?? 0,
                npsAverage: c.npsAverage ?? null,
                unansweredCount: c.unansweredQuestions?.length ?? 0,
                titulo: c.resumen?.titulo ?? null,
                tono: c.resumen?.tono ?? null,
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

// ─── Consolidado ──────────────────────────────────────────────────────────────
// Va ANTES de /:id: si no, "consolidated" entraría como id de un informe.

router.get('/consolidated', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConConsolidado(userId);

      const reports = await prisma.consolidatedReport.findMany({
        where: { userId },
        orderBy: { weekStart: 'desc' },
        take: 26,
        select: { id: true, weekStart: true, weekEnd: true, generatedAt: true, content: true },
      });

      res.json({
        data: {
          reports: reports.map((r) => {
            const c = r.content as unknown as Partial<ConsolidatedContent>;
            return {
              id: r.id,
              weekStart: r.weekStart,
              weekEnd: r.weekEnd,
              generatedAt: r.generatedAt,
              resumen: {
                totalBots: c.totalBots ?? 0,
                totalConversations: c.totalConversations ?? 0,
                totalUnanswered: c.totalUnanswered ?? 0,
                npsAverage: c.npsAverage ?? null,
                titulo: c.resumen?.titulo ?? null,
                tono: c.resumen?.tono ?? null,
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

router.get('/consolidated/:id', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConConsolidado(userId);
      const rep = await getOwnedConsolidated(req.params.id, userId);
      res.json({
        data: {
          id: rep.id,
          weekStart: rep.weekStart,
          weekEnd: rep.weekEnd,
          generatedAt: rep.generatedAt,
          content: rep.content,
        },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  })();
});

router.get('/consolidated/:id/export', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConConsolidado(userId);
      const rep = await getOwnedConsolidated(req.params.id, userId);

      const pdf = await renderConsolidatedPdf({
        weekStart: rep.weekStart,
        weekEnd: rep.weekEnd,
        content: rep.content as unknown as ConsolidatedContent,
      });
      enviarPdf(res, pdf, nombreArchivoPdf('informe-consolidado', rep.weekStart));
    } catch (err) {
      next(err);
    }
  })();
});

// ─── Generación a demanda ─────────────────────────────────────────────────────
// También va antes de /:id por la misma razón de ruteo.

const generateSchema = z.object({
  /** Sin botId genera el de todos los bots del usuario, más el consolidado */
  botId: z.string().uuid().optional(),
  /** Lunes 00:00 UTC de la semana a cubrir. Por defecto, la que terminó. */
  weekStart: z.string().datetime().optional(),
});

router.post('/generate', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConReportes(userId);
      const user = await getUser(userId);

      const parsed = generateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'Datos inválidos', 'VALIDATION_ERROR', parsed.error.flatten());
      }

      let { weekStart, weekEnd } = semanaAnterior();
      if (parsed.data.weekStart) {
        // Semanas arbitrarias solo en desarrollo: en producción, que el usuario
        // pueda pedir cualquier rango es trabajo de base sin límite claro
        if (env.NODE_ENV === 'production') {
          throw new AppError(400, 'Solo se puede generar el informe de la semana pasada');
        }
        weekStart = new Date(parsed.data.weekStart);
        weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);
      }

      const bots = parsed.data.botId
        ? [await getOwnedBot(parsed.data.botId, userId)]
        : await prisma.bot.findMany({
            where: { userId, isActive: true },
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true, userId: true },
          });

      if (bots.length === 0) throw new AppError(400, 'Todavía no tenés ningún bot activo');

      // Un bot que falla no frena a los demás, igual que en el cron
      const generados: Array<{ id: string; botId: string; botName: string }> = [];
      const fallidos: string[] = [];
      for (const bot of bots) {
        try {
          const { id } = await generarYGuardar(bot.id, weekStart, weekEnd);
          generados.push({ id, botId: bot.id, botName: bot.name });
        } catch (err) {
          fallidos.push(bot.name);
          console.error(`[reports] Falló el informe a demanda del bot ${bot.id}:`, err);
        }
      }
      if (generados.length === 0) {
        throw new AppError(500, 'No se pudo generar ningún informe. Probá de nuevo en un rato.');
      }

      // El consolidado necesita los individuales como insumo, así que va después
      let consolidatedId: string | null = null;
      if (planIncluyeConsolidado(user) && bots.length > 1) {
        try {
          const c = await generarYGuardarConsolidado(userId, weekStart, weekEnd);
          consolidatedId = c?.id ?? null;
        } catch (err) {
          console.error(`[reports] Falló el consolidado a demanda de ${userId}:`, err);
        }
      }

      res.status(201).json({
        data: { weekStart, weekEnd, reports: generados, fallidos, consolidatedId },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  })();
});

// ─── GET /reports/:id — detalle del individual ────────────────────────────────
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConReportes(userId);
      const report = await getOwnedReport(req.params.id, userId);
      const historial = await getTrendHistory(report.botId, report.weekStart);

      res.json({
        data: {
          id: report.id,
          botId: report.botId,
          botName: report.bot.name,
          weekStart: report.weekStart,
          weekEnd: report.weekEnd,
          generatedAt: report.generatedAt,
          content: report.content,
          historial,
        },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  })();
});

// ─── GET /reports/:id/export — PDF del individual ─────────────────────────────
router.get('/:id/export', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.userId;
      await assertPlanConReportes(userId);
      const report = await getOwnedReport(req.params.id, userId);
      const historial = await getTrendHistory(report.botId, report.weekStart);

      const pdf = await renderWeeklyReportPdf({
        botName: report.bot.name,
        weekStart: report.weekStart,
        weekEnd: report.weekEnd,
        content: report.content as unknown as WeeklyReportContent,
        historial,
      });
      enviarPdf(res, pdf, nombreArchivoPdf(`informe-${report.bot.name}`, report.weekStart));
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
      // El bot sale del informe, no del body: el cliente no elige a qué bot escribe
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

export default router;
