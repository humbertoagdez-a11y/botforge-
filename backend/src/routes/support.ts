import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  addMessage,
  createTicket,
  getTicket,
  isAdminUser,
  listAllTickets,
  listUserTickets,
  updateStatus,
} from '../services/supportTickets';

const router = Router();

// Todo el router exige sesión con email verificado
router.use(requireAuth, requireVerifiedEmail);

const CATEGORIES = ['CONSULTA', 'RECLAMO', 'INTEGRACION', 'BOT_MAL_RESPONDE', 'FACTURACION', 'OTRO'] as const;
const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED'] as const;
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;

/** Corta si el usuario no es el admin de la plataforma */
async function assertAdmin(req: Request): Promise<void> {
  if (!(await isAdminUser(req.user!.userId))) {
    throw new AppError(403, 'Solo el administrador puede ver esto');
  }
}

// ─── GET /tickets — los míos ──────────────────────────────────────────────────
router.get('/tickets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [tickets, admin] = await Promise.all([
      listUserTickets(req.user!.userId),
      isAdminUser(req.user!.userId),
    ]);
    // isAdmin viaja acá para que el frontend sepa si mostrar la vista de admin
    res.json({ data: { tickets, isAdmin: admin }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /tickets — crear a mano ─────────────────────────────────────────────
const createSchema = z.object({
  category: z.enum(CATEGORIES),
  subject: z.string().trim().min(5).max(120),
  body: z.string().trim().min(10).max(5000),
  priority: z.enum(PRIORITIES).optional(),
  botId: z.string().uuid().optional(),
});

router.post('/tickets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createSchema.parse(req.body);
    const ticket = await createTicket({ ...input, userId: req.user!.userId });
    res.status(201).json({
      data: { id: ticket.id, ref: ticket.ref, status: ticket.status },
      error: null,
      meta: null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /tickets/:id — hilo completo ─────────────────────────────────────────
router.get('/tickets/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = await isAdminUser(req.user!.userId);
    const ticket = await getTicket(req.params.id, req.user!.userId, admin);
    res.json({ data: { ticket, isAdmin: admin }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /tickets/:id/messages — responder ───────────────────────────────────
const messageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

router.post('/tickets/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { body } = messageSchema.parse(req.body);
    const admin = await isAdminUser(req.user!.userId);
    // getTicket vuelve a validar pertenencia: nadie escribe en un hilo ajeno
    await getTicket(req.params.id, req.user!.userId, admin);
    const message = await addMessage(req.params.id, admin ? 'admin' : 'client', body);
    res.status(201).json({ data: message, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// ─── GET /admin/tickets — todos ───────────────────────────────────────────────
router.get('/admin/tickets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertAdmin(req);
    const raw = typeof req.query.status === 'string' ? req.query.status : undefined;
    const status = STATUSES.find((s) => s === raw);
    const tickets = await listAllTickets(status);
    res.json({ data: { tickets }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /admin/tickets/:id — estado y prioridad ────────────────────────────
const patchSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
  })
  .refine((d) => d.status !== undefined || d.priority !== undefined, {
    message: 'Indicá status o priority',
  });

router.patch('/admin/tickets/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertAdmin(req);
    const data = patchSchema.parse(req.body);
    const ticket = await updateStatus(req.params.id, data);
    res.json({ data: ticket, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

export default router;
