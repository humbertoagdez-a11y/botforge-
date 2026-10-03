/**
 * Embudo por origen.
 *
 *   POST /api/v1/origen          publico: una visita { origen, campana, anuncio, pagina, tipo: 'visita' }
 *   GET  /api/v1/origen/panel    solo el dueño de la plataforma (ADMIN_EMAIL)
 *
 * La visita no guarda nada que identifique a nadie: suma uno a un contador
 * del dia. El rate limit de abajo lleva la cuenta por IP en memoria del
 * proceso durante un minuto y no la escribe en ningun lado; es lo mismo que
 * hace el limite global de la API.
 */
import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { isAdminUser } from '../services/supportTickets';
import { ORIGENES, etiqueta, sumarEmbudo } from '../services/embudo';

const router = Router();

/** Paginas de entrada que cuentan como visita */
const PAGINAS = ['/', '/planes', '/auth/register'] as const;

const visita = z
  .object({
    tipo: z.literal('visita'),
    origen: z.enum(ORIGENES),
    campana: z.string().max(200).optional(),
    anuncio: z.string().max(200).optional(),
    pagina: z.enum(PAGINAS),
  })
  .strict();

/**
 * Una pestaña manda una visita por carga. Mas de 5 por minuto desde el mismo
 * lugar no es una persona navegando: es alguien inflando el contador.
 */
const limite = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

router.post('/', limite, async (req: Request, res: Response) => {
  // sendBeacon manda text/plain: se acepta el cuerpo como string o como JSON
  let datos: unknown = req.body;
  if (typeof datos === 'string') {
    try {
      datos = JSON.parse(datos);
    } catch {
      datos = null;
    }
  }
  const parsed = visita.safeParse(datos);
  if (!parsed.success) {
    res.status(400).json({ data: null, error: { code: 'INVALIDO', message: 'Visita invalida' }, meta: null });
    return;
  }
  const v = parsed.data;
  await sumarEmbudo({
    tipo: 'visita',
    origen: v.origen,
    campana: etiqueta(v.campana),
    anuncio: etiqueta(v.anuncio),
    pagina: v.pagina,
  });
  res.status(204).end();
});

const panelQuery = z.object({ dias: z.coerce.number().int().min(1).max(180).default(30) });

/** Fecha de Paraguay (UTC-3) de un instante, como YYYY-MM-DD */
const diaPy = (d: Date) => new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);

router.get('/panel', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdminUser(req.user!.userId))) throw new AppError(403, 'Acceso denegado');
    const { dias } = panelQuery.parse(req.query);
    const desde = new Date(diaPy(new Date(Date.now() - (dias - 1) * 86400000)));

    const filas = await prisma.embudoDiario.findMany({
      where: { fecha: { gte: desde } },
      orderBy: [{ fecha: 'desc' }, { origen: 'asc' }],
    });

    // El anuncio de WhatsApp no pasa por la web: se mide con lo que ya guarda
    // el bot de ventas. Solo lectura, el bot no se toca.
    const conversaciones = await prisma.conversation.findMany({
      where: { botId: env.BOT_VENTAS_ID, channel: 'whatsapp', createdAt: { gte: new Date(desde.getTime() + 3 * 3600 * 1000) } },
      select: { createdAt: true, adSourceId: true, leadAvisadoEn: true },
    });
    const porDia = new Map<string, { conversaciones: number; desdeAnuncio: number; leads: number }>();
    for (const c of conversaciones) {
      const d = diaPy(c.createdAt);
      const x = porDia.get(d) ?? { conversaciones: 0, desdeAnuncio: 0, leads: 0 };
      x.conversaciones += 1;
      if (c.adSourceId) x.desdeAnuncio += 1;
      if (c.leadAvisadoEn) x.leads += 1;
      porDia.set(d, x);
    }

    res.json({
      data: {
        desde: diaPy(new Date(desde.getTime() + 3 * 3600 * 1000)),
        filas: filas.map((f) => ({ ...f, fecha: f.fecha.toISOString().slice(0, 10) })),
        whatsapp: [...porDia.entries()]
          .map(([fecha, x]) => ({ fecha, ...x }))
          .sort((a, b) => b.fecha.localeCompare(a.fecha)),
      },
      error: null,
      meta: null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
