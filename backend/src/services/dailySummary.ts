import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { LIMITS } from '../middleware/planLimits';
import { sendEmail } from './email';

// Paraguay: UTC-4 como offset por defecto (según spec). El cron dispara a las
// 21:00 America/Asuncion; acá calculamos el rango del día calendario paraguayo.
const PY_OFFSET_HOURS = -4;

/** Rango [inicio, fin) en UTC que representa el día de hoy en Paraguay. */
function paraguayTodayRange(): { start: Date; end: Date } {
  const now = new Date();
  const pyNow = new Date(now.getTime() + PY_OFFSET_HOURS * 3600 * 1000);
  const y = pyNow.getUTCFullYear();
  const m = pyNow.getUTCMonth();
  const d = pyNow.getUTCDate();
  // Medianoche paraguaya de hoy, expresada en UTC
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0) - PY_OFFSET_HOURS * 3600 * 1000);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

interface BotSummary {
  name: string;
  messagesToday: number;
  newConversationsToday: number;
}

function summaryEmailHtml(params: {
  name: string;
  bots: BotSummary[];
  monthlyUsed: number;
  monthlyLimit: number;
  planLabel: string;
}): string {
  const { name, bots, monthlyUsed, monthlyLimit, planLabel } = params;
  const conversationsUrl = `${env.FRONTEND_URL}/dashboard/conversations`;
  const pricingUrl = `${env.FRONTEND_URL}/pricing`;
  const usagePct = monthlyLimit > 0 ? Math.round((monthlyUsed / monthlyLimit) * 100) : 0;
  const nearLimit = usagePct >= 80;

  const botRows = bots
    .map(
      (b) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#111111;">
          <strong>${b.name}</strong>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#333333;text-align:right;">
          ${b.messagesToday} mensaje${b.messagesToday === 1 ? '' : 's'} · ${b.newConversationsToday} conversación${b.newConversationsToday === 1 ? '' : 'es'} nueva${b.newConversationsToday === 1 ? '' : 's'}
        </td>
      </tr>`,
    )
    .join('');

  const limitWarning = nearLimit
    ? `<p style="font-size:14px;line-height:1.6;color:#b45309;margin:0 0 20px;">
         Estás usando el ${usagePct}% de tu plan ${planLabel}.
         <a href="${pricingUrl}" style="color:#7C3AED;font-weight:bold;text-decoration:none;">Mejorá tu plan</a>
         para no cortar el servicio.
       </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:22px;font-weight:bold;color:#7C3AED;margin:0 0 24px;">BotForge</p>
      <p style="font-size:16px;margin:0 0 8px;">Hola ${name},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
        Este es tu resumen de hoy. Tus bots siguieron trabajando:
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">
        ${botRows}
      </table>
      <p style="font-size:14px;color:#333333;margin:0 0 8px;">
        Uso del mes: <strong>${monthlyUsed.toLocaleString('es-PY')}</strong> de ${monthlyLimit.toLocaleString('es-PY')} mensajes (plan ${planLabel}).
      </p>
      ${limitWarning}
      <a href="${conversationsUrl}"
         style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:8px;margin:8px 0 28px;">
        Ver mis conversaciones
      </a>
      <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 16px;" />
      <p style="font-size:12px;color:#888888;margin:0;">
        Recibís este resumen porque tenés bots activos en BotForge.
      </p>
    </div>
  </body>
</html>`;
}

const PLAN_LABEL: Record<string, string> = {
  FREE: 'Free',
  STARTER: 'Básico',
  PRO: 'Profesional',
  AGENCY: 'Agencia',
};

/**
 * Arma y envía el resumen diario a cada dueño con bots activos y actividad hoy.
 * Nunca lanza por un email individual: loguea y sigue con el siguiente usuario.
 * Devuelve la cantidad de emails efectivamente enviados.
 */
export async function generateDailySummaries(): Promise<number> {
  const { start, end } = paraguayTodayRange();

  // Dueños con al menos un bot activo y con el resumen habilitado
  const users = await prisma.user.findMany({
    where: { dailySummaryEnabled: true, bots: { some: { isActive: true } } },
    select: {
      id: true,
      name: true,
      email: true,
      plan: true,
      messagesUsedThisMonth: true,
      bots: { where: { isActive: true }, select: { id: true, name: true } },
    },
  });

  let sent = 0;

  for (const user of users) {
    try {
      const botSummaries: BotSummary[] = await Promise.all(
        user.bots.map(async (bot) => {
          const [messagesToday, newConversationsToday] = await Promise.all([
            prisma.message.count({
              where: {
                role: 'ASSISTANT',
                createdAt: { gte: start, lt: end },
                conversation: { botId: bot.id },
              },
            }),
            prisma.conversation.count({
              where: { botId: bot.id, createdAt: { gte: start, lt: end } },
            }),
          ]);
          return { name: bot.name, messagesToday, newConversationsToday };
        }),
      );

      const totalMessagesToday = botSummaries.reduce((acc, b) => acc + b.messagesToday, 0);
      // Sin actividad hoy: no mandamos email (evita spam de "0 mensajes")
      if (totalMessagesToday === 0) continue;

      const html = summaryEmailHtml({
        name: user.name,
        bots: botSummaries,
        monthlyUsed: user.messagesUsedThisMonth,
        monthlyLimit: LIMITS[user.plan].monthlyMessages,
        planLabel: PLAN_LABEL[user.plan] ?? user.plan,
      });

      const ok = await sendEmail(user.email, 'Tu resumen de hoy en BotForge', html);
      if (ok) sent += 1;
    } catch (err) {
      console.error(`[dailySummary] Error armando el resumen de ${user.id}:`, err);
    }
  }

  console.log(`[dailySummary] Resúmenes enviados: ${sent}/${users.length} usuarios con bots activos`);
  return sent;

  // PENDIENTE: derivaciones a humano de hoy. No hay un campo que persista la
  // derivación (derivar_a_humano solo dispara email, y el webhook detecta
  // "pide humano" por keywords sin guardar un contador). Contar mensajes con
  // la palabra "humano" daría un número engañoso, así que se omite el dato en
  // vez de inventarlo. Requiere un modelo/campo dedicado para hacerlo limpio.
}
