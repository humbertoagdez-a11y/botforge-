/**
 * Corrida semanal: genera el reporte de cada bot elegible y avisa por email.
 *
 * Se procesa bot por bot con el error aislado: si uno falla (bot corrupto,
 * timeout de base), los demas igual reciben su reporte. Una excepcion suelta
 * acá tumbaría el cron entero y nadie se enteraría hasta el lunes siguiente.
 */
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { sendEmail } from './email';
import { LIMITS, effectivePlan } from '../middleware/planLimits';
import { botsConReporte } from '../middleware/planLimits';
import { generarYGuardar, semanaAnterior, type WeeklyReportContent } from './weeklyReport';

function fechaCorta(d: Date): string {
  // El rango se muestra en dias paraguayos, que es como lo vive el dueño
  const py = new Date(d.getTime() - 4 * 3600 * 1000);
  return `${py.getUTCDate()}/${py.getUTCMonth() + 1}`;
}

function emailHtml(params: {
  nombre: string;
  botName: string;
  content: WeeklyReportContent;
  weekStart: Date;
  weekEnd: Date;
}): string {
  const { nombre, botName, content, weekStart, weekEnd } = params;
  const url = `${env.FRONTEND_URL}/dashboard/reportes`;
  // weekEnd es exclusivo: el ultimo dia cubierto es el anterior
  const rango = `${fechaCorta(weekStart)} al ${fechaCorta(new Date(weekEnd.getTime() - 1))}`;

  const sinResponder = content.unansweredQuestions
    .slice(0, 3)
    .map(
      (q) => `<li style="margin:0 0 6px;font-size:14px;color:#333333;">
        ${q.pregunta} <span style="color:#888888;">(${q.veces} ${q.veces === 1 ? 'vez' : 'veces'})</span>
      </li>`,
    )
    .join('');

  const bloqueSinResponder = sinResponder
    ? `<p style="font-size:14px;color:#111111;margin:0 0 8px;"><strong>Lo que tu bot no supo responder:</strong></p>
       <ul style="margin:0 0 20px;padding-left:18px;">${sinResponder}</ul>`
    : '';

  const nps =
    content.npsAverage !== null
      ? `<tr><td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#111111;">Satisfacción (NPS)</td>
         <td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#333333;text-align:right;">
           ${content.npsAverage} / 10 · ${content.npsResponseCount} respuesta${content.npsResponseCount === 1 ? '' : 's'}
         </td></tr>`
      : '';

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6;padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td>
          <p style="font-size:13px;color:#7C3AED;margin:0 0 4px;font-weight:bold;">REPORTE SEMANAL</p>
          <h1 style="font-size:20px;color:#111111;margin:0 0 4px;">${botName}</h1>
          <p style="font-size:13px;color:#888888;margin:0 0 24px;">Semana del ${rango}</p>

          <p style="font-size:14px;line-height:1.6;color:#333333;margin:0 0 20px;">
            Hola ${nombre}, así le fue a tu bot esta semana.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#111111;">Conversaciones nuevas</td>
                <td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#333333;text-align:right;">${content.totalConversations}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#111111;">Mensajes</td>
                <td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#333333;text-align:right;">${content.totalMessages}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#111111;">Consultas sin respuesta</td>
                <td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#333333;text-align:right;">${content.humanRequestedCount}</td></tr>
            ${nps}
          </table>

          ${bloqueSinResponder}

          <p style="margin:0 0 8px;">
            <a href="${url}" style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:bold;">
              Ver el reporte completo
            </a>
          </p>
          <p style="font-size:12px;color:#999999;margin:20px 0 0;">
            BotForge · Podés desactivar estos avisos desde el dashboard.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export interface ResultadoCorrida {
  generados: number;
  fallidos: number;
  omitidos: number;
}

/**
 * Genera los reportes de la semana indicada (por defecto, la que acaba de
 * terminar) para todos los usuarios con plan que los incluya.
 */
export async function generateWeeklyReports(
  rango = semanaAnterior(),
): Promise<ResultadoCorrida> {
  const { weekStart, weekEnd } = rango;
  const resultado: ResultadoCorrida = { generados: 0, fallidos: 0, omitidos: 0 };

  const planesConReporte = (Object.keys(LIMITS) as Array<keyof typeof LIMITS>).filter(
    (p) => LIMITS[p].weeklyReports,
  );

  const usuarios = await prisma.user.findMany({
    where: { plan: { in: planesConReporte } },
    select: {
      id: true,
      name: true,
      email: true,
      plan: true,
      planExpiresAt: true,
      bots: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      },
    },
  });

  for (const user of usuarios) {
    // El plan vencido vale FREE: no se le genera nada aunque la columna diga PRO
    const cupo = botsConReporte(effectivePlan(user));
    if (cupo === 0) {
      resultado.omitidos += user.bots.length;
      continue;
    }
    const bots = Number.isFinite(cupo) ? user.bots.slice(0, cupo) : user.bots;
    resultado.omitidos += user.bots.length - bots.length;

    for (const bot of bots) {
      try {
        const { content } = await generarYGuardar(bot.id, weekStart, weekEnd);
        resultado.generados += 1;

        // Sin actividad no se manda email: un reporte en cero solo molesta
        if (content.totalMessages === 0) continue;
        await sendEmail(
          user.email,
          `Reporte semanal de ${bot.name}`,
          emailHtml({
            nombre: user.name ?? 'Hola',
            botName: bot.name,
            content,
            weekStart,
            weekEnd,
          }),
        );
      } catch (err) {
        resultado.fallidos += 1;
        console.error(`[weeklyReport] Falló el reporte del bot ${bot.id}:`, err);
      }
    }
  }

  console.log(
    `[weeklyReport] Corrida terminada: ${resultado.generados} generados, ` +
      `${resultado.fallidos} fallidos, ${resultado.omitidos} omitidos por plan`,
  );
  return resultado;
}
