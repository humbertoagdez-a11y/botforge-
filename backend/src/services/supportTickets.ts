/**
 * Tickets de soporte: el cliente los abre desde el asistente (o a mano), le
 * llegan por email al creador de la plataforma, y el hilo se sigue de los dos
 * lados.
 *
 * Ningun fallo de email impide crear el ticket ni guardar un mensaje: sendEmail
 * ya devuelve false en vez de lanzar, y ademas se dispara sin await.
 */
import { v4 as uuidv4 } from 'uuid';
import type { TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { sendEmail } from './email';

/** Arranca en BF-1001 para no exponer lo chico que es el volumen todavia */
const REF_OFFSET = 1000;
const MAX_REF_INTENTOS = 5;

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  CONSULTA: 'Consulta',
  RECLAMO: 'Reclamo',
  INTEGRACION: 'Integración',
  BOT_MAL_RESPONDE: 'El bot responde mal',
  FACTURACION: 'Facturación',
  OTRO: 'Otro',
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: 'Baja',
  NORMAL: 'Normal',
  HIGH: 'Alta',
};

const PLAN_LABEL: Record<string, string> = {
  FREE: 'Free',
  STARTER: 'Básico',
  PRO: 'Profesional',
  AGENCY: 'Agencia',
};

/** ¿Este email es el del admin? Comparación laxa: sin espacios y en minúsculas */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email || !env.ADMIN_EMAIL) return false;
  return email.trim().toLowerCase() === env.ADMIN_EMAIL.trim().toLowerCase();
}

/** Lee el email real de la base, no el del JWT, que puede estar viejo */
export async function isAdminUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return isAdminEmail(user?.email);
}

// ─── Contexto automático ──────────────────────────────────────────────────────

/**
 * Arma el contexto de la cuenta leyendo la base. Lo hace el backend a
 * proposito: si lo escribiera el modelo podria inventar plan, bots o estados.
 */
async function buildTicketContext(userId: string, botId?: string | null): Promise<string> {
  const [user, botCount, bot] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, planExpiresAt: true, messagesUsedThisMonth: true, createdAt: true },
    }),
    prisma.bot.count({ where: { userId } }),
    botId ? prisma.bot.findUnique({ where: { id: botId } }) : Promise.resolve(null),
  ]);

  const partes: string[] = [];
  if (user) {
    partes.push(`Plan: ${PLAN_LABEL[user.plan] ?? user.plan}`);
    if (user.planExpiresAt) {
      const vencido = user.planExpiresAt < new Date();
      partes.push(`Vencimiento del plan: ${user.planExpiresAt.toISOString().slice(0, 10)}${vencido ? ' (VENCIDO)' : ''}`);
    }
    partes.push(`Mensajes usados este mes: ${user.messagesUsedThisMonth}`);
    partes.push(`Cliente desde: ${user.createdAt.toISOString().slice(0, 10)}`);
  }
  partes.push(`Bots en la cuenta: ${botCount}`);

  if (bot && bot.userId === userId) {
    const [docs, docsListos] = await Promise.all([
      prisma.document.count({ where: { botId: bot.id } }),
      prisma.document.count({ where: { botId: bot.id, status: 'READY' } }),
    ]);
    const wa = bot.metaPhoneNumberId ?? bot.whatsappNumber;
    partes.push(
      `Bot involucrado: "${bot.name}" (${bot.isActive ? 'activo' : 'pausado'}), ` +
        `idioma ${bot.language}, ${docsListos}/${docs} documentos listos, ` +
        `WhatsApp ${wa ? 'conectado' : 'sin conectar'}`,
    );
  }

  return partes.join('\n');
}

// ─── Creación ─────────────────────────────────────────────────────────────────

/**
 * Genera el siguiente ref. El conteo + offset puede colisionar si entran dos
 * tickets a la vez, asi que se reintenta ante la violacion de unicidad en vez
 * de perder el ticket.
 */
async function createWithRef<T>(
  intento: (ref: string) => Promise<T>,
): Promise<T> {
  for (let i = 0; i < MAX_REF_INTENTOS; i++) {
    const total = await prisma.supportTicket.count();
    const ref = `BF-${REF_OFFSET + total + 1 + i}`;
    try {
      return await intento(ref);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'P2002') throw err; // P2002 = unique constraint
      console.warn(`[support] ref ${ref} ya existía, reintentando`);
    }
  }
  throw new AppError(500, 'No se pudo generar el número de ticket. Intentá de nuevo.');
}

export interface CreateTicketInput {
  userId: string;
  botId?: string | null;
  category: TicketCategory;
  subject: string;
  body: string;
  priority?: TicketPriority;
}

export async function createTicket(input: CreateTicketInput) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { id: true, name: true, email: true, plan: true },
  });

  // Un bot ajeno no puede quedar adjunto al ticket
  let botId: string | null = null;
  if (input.botId) {
    const bot = await prisma.bot.findUnique({ where: { id: input.botId } });
    if (bot && bot.userId === user.id) botId = bot.id;
  }

  const context = await buildTicketContext(user.id, botId);

  const ticket = await createWithRef((ref) =>
    prisma.supportTicket.create({
      data: {
        id: uuidv4(),
        ref,
        userId: user.id,
        botId,
        category: input.category,
        priority: input.priority ?? 'NORMAL',
        subject: input.subject.slice(0, 120),
        context,
        messages: {
          create: { id: uuidv4(), author: 'client', body: input.body },
        },
      },
      include: { bot: { select: { name: true } } },
    }),
  );

  console.log(`[support] Ticket ${ticket.ref} creado por ${user.id} (${ticket.category}/${ticket.priority})`);

  void sendEmail(
    env.ADMIN_EMAIL,
    `[BotForge ${ticket.ref}] ${CATEGORY_LABEL[ticket.category]} — ${ticket.subject}`,
    adminNewTicketHtml({
      ref: ticket.ref,
      category: ticket.category,
      priority: ticket.priority,
      subject: ticket.subject,
      clientName: user.name,
      clientEmail: user.email,
      plan: user.plan,
      botName: ticket.bot?.name ?? null,
      context: ticket.context ?? '',
      body: input.body,
      ticketId: ticket.id,
    }),
  );

  void sendEmail(
    user.email,
    `Recibimos tu consulta (${ticket.ref})`,
    clientConfirmationHtml(user.name, ticket.ref, ticket.subject, input.body),
  );

  return ticket;
}

// ─── Mensajes del hilo ────────────────────────────────────────────────────────

export type TicketAuthor = 'client' | 'admin';

export async function addMessage(ticketId: string, author: TicketAuthor, body: string) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!ticket) throw new AppError(404, 'Ticket no encontrado');

  // El admin contesta -> la pelota queda del lado del cliente, y al revés.
  // Un ticket cerrado no se reabre solo por un mensaje.
  let status: TicketStatus = ticket.status;
  if (author === 'admin' && ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED') {
    status = 'WAITING_CLIENT';
  } else if (author === 'client' && ticket.status === 'WAITING_CLIENT') {
    status = 'OPEN';
  }

  const [message] = await prisma.$transaction([
    prisma.supportTicketMessage.create({
      data: { id: uuidv4(), ticketId: ticket.id, author, body },
    }),
    prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status, updatedAt: new Date() },
    }),
  ]);

  if (author === 'admin') {
    void sendEmail(
      ticket.user.email,
      `Respondimos tu consulta (${ticket.ref})`,
      clientReplyHtml(ticket.user.name, ticket.ref, ticket.subject, body),
    );
  } else {
    void sendEmail(
      env.ADMIN_EMAIL,
      `[BotForge ${ticket.ref}] el cliente respondió`,
      adminReplyHtml(ticket.ref, ticket.subject, ticket.user.name, body, ticket.id),
    );
  }

  return message;
}

// ─── Lectura ──────────────────────────────────────────────────────────────────

export async function listUserTickets(userId: string) {
  return prisma.supportTicket.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      bot: { select: { name: true } },
      _count: { select: { messages: true } },
    },
  });
}

export async function listAllTickets(status?: TicketStatus) {
  return prisma.supportTicket.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    include: {
      user: { select: { name: true, email: true, plan: true } },
      bot: { select: { name: true } },
      _count: { select: { messages: true } },
    },
  });
}

/**
 * Trae el hilo completo. SIEMPRE verifica pertenencia: sin esto cualquier
 * usuario logueado leería el ticket de otro con solo tener el id.
 */
export async function getTicket(ticketId: string, userId: string, admin: boolean) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      bot: { select: { name: true } },
      user: { select: { name: true, email: true, plan: true } },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!ticket) throw new AppError(404, 'Ticket no encontrado');
  if (!admin && ticket.userId !== userId) throw new AppError(403, 'Acceso denegado');
  return ticket;
}

export async function updateStatus(
  ticketId: string,
  data: { status?: TicketStatus; priority?: TicketPriority },
) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!ticket) throw new AppError(404, 'Ticket no encontrado');

  const pasaAResuelto = data.status === 'RESOLVED' && ticket.status !== 'RESOLVED';

  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.priority ? { priority: data.priority } : {}),
      ...(pasaAResuelto ? { resolvedAt: new Date() } : {}),
    },
  });

  if (pasaAResuelto) {
    void sendEmail(
      ticket.user.email,
      `Tu consulta quedó resuelta (${ticket.ref})`,
      clientResolvedHtml(ticket.user.name, ticket.ref, ticket.subject),
    );
  }

  return updated;
}

// ─── Plantillas de email ──────────────────────────────────────────────────────

const shell = (inner: string) => `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:22px;font-weight:bold;color:#7C3AED;margin:0 0 24px;">BotForge</p>
      ${inner}
    </div>
  </body>
</html>`;

const quote = (texto: string) => `<div style="border-left:3px solid #DDD6FE;background:#FAF9FF;padding:12px 16px;margin:0 0 20px;font-size:14px;line-height:1.6;color:#333333;white-space:pre-wrap;">${texto}</div>`;

const boton = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:8px;margin:0 0 28px;">${label}</a>`;

function adminNewTicketHtml(t: {
  ref: string; category: TicketCategory; priority: TicketPriority; subject: string;
  clientName: string; clientEmail: string; plan: string; botName: string | null;
  context: string; body: string; ticketId: string;
}): string {
  const urgente = t.priority === 'HIGH';
  const banner = urgente
    ? `<p style="background:#FEF2F2;border:1px solid #FECACA;color:#B91C1C;font-size:14px;font-weight:bold;border-radius:8px;padding:10px 14px;margin:0 0 20px;">PRIORIDAD ALTA — el negocio del cliente puede estar afectado ahora mismo</p>`
    : '';

  return shell(`
    ${banner}
    <p style="font-size:18px;font-weight:bold;margin:0 0 4px;">${t.ref} · ${CATEGORY_LABEL[t.category]}</p>
    <p style="font-size:16px;margin:0 0 20px;color:#333333;">${t.subject}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333333;margin:0 0 20px;">
      <tr><td style="padding:6px 0;color:#666;">Cliente</td><td style="padding:6px 0;"><strong>${t.clientName}</strong> — ${t.clientEmail}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Plan</td><td style="padding:6px 0;">${PLAN_LABEL[t.plan] ?? t.plan}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Prioridad</td><td style="padding:6px 0;">${PRIORITY_LABEL[t.priority]}</td></tr>
      ${t.botName ? `<tr><td style="padding:6px 0;color:#666;">Bot</td><td style="padding:6px 0;">${t.botName}</td></tr>` : ''}
    </table>
    <p style="font-size:13px;font-weight:bold;color:#666666;margin:0 0 6px;">CONTEXTO DE LA CUENTA</p>
    ${quote(t.context || 'Sin datos')}
    <p style="font-size:13px;font-weight:bold;color:#666666;margin:0 0 6px;">LO QUE PLANTEA</p>
    ${quote(t.body)}
    ${boton(`${env.FRONTEND_URL}/dashboard/soporte?ticket=${t.ticketId}`, 'Responder el ticket')}
  `);
}

function clientConfirmationHtml(name: string, ref: string, subject: string, body: string): string {
  return shell(`
    <p style="font-size:16px;margin:0 0 12px;">Hola ${name},</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
      Recibimos tu consulta y quedó registrada con el número
      <strong style="font-family:'Courier New',monospace;">${ref}</strong>.
      Citá ese número si querés hacer referencia a este caso.
    </p>
    <p style="font-size:13px;font-weight:bold;color:#666666;margin:0 0 6px;">LO QUE NOS CONTASTE</p>
    <p style="font-size:14px;font-weight:bold;color:#333;margin:0 0 8px;">${subject}</p>
    ${quote(body)}
    ${boton(`${env.FRONTEND_URL}/dashboard/soporte`, 'Ver el estado de mi consulta')}
    <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 16px;" />
    <p style="font-size:12px;color:#888888;margin:0;">
      Podés seguir el caso desde el panel o preguntándole al Asistente de BotForge.
    </p>
  `);
}

function clientReplyHtml(name: string, ref: string, subject: string, body: string): string {
  return shell(`
    <p style="font-size:16px;margin:0 0 12px;">Hola ${name},</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
      Tenés una respuesta en tu consulta
      <strong style="font-family:'Courier New',monospace;">${ref}</strong> — ${subject}
    </p>
    ${quote(body)}
    ${boton(`${env.FRONTEND_URL}/dashboard/soporte`, 'Ver la conversación')}
  `);
}

function clientResolvedHtml(name: string, ref: string, subject: string): string {
  return shell(`
    <p style="font-size:16px;margin:0 0 12px;">Hola ${name},</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
      Marcamos como resuelta tu consulta
      <strong style="font-family:'Courier New',monospace;">${ref}</strong> — ${subject}.
      Si el tema sigue, respondé en el mismo hilo y lo reabrimos.
    </p>
    ${boton(`${env.FRONTEND_URL}/dashboard/soporte`, 'Ver la conversación')}
  `);
}

function adminReplyHtml(ref: string, subject: string, clientName: string, body: string, ticketId: string): string {
  return shell(`
    <p style="font-size:18px;font-weight:bold;margin:0 0 4px;">${ref}</p>
    <p style="font-size:15px;margin:0 0 20px;color:#333333;">
      <strong>${clientName}</strong> respondió en: ${subject}
    </p>
    ${quote(body)}
    ${boton(`${env.FRONTEND_URL}/dashboard/soporte?ticket=${ticketId}`, 'Ver el hilo')}
  `);
}
