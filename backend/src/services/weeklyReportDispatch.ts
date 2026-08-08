/**
 * Corrida semanal: genera el informe de cada bot elegible, despues el
 * consolidado de Agencia, y avisa por email.
 *
 * Todo el trabajo va con el error aislado por unidad: si el informe de un bot
 * falla (bot corrupto, timeout de base), los demas igual se generan, el
 * consolidado igual se arma con los que si salieron, y los otros usuarios ni
 * se enteran. Una excepcion suelta aca tumbaria la corrida entera y nadie lo
 * notaria hasta el lunes siguiente.
 */
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { sendEmail } from './email';
import { LIMITS, effectivePlan } from '../middleware/planLimits';
import { generarYGuardar, semanaAnterior, type WeeklyReportContent } from './weeklyReport';
import { generarYGuardarConsolidado, type ConsolidatedContent } from './consolidatedReport';

const PY_OFFSET_MS = -4 * 3600 * 1000;

function fechaCorta(d: Date): string {
  // El rango se muestra en dias paraguayos, que es como lo vive el dueño
  const py = new Date(d.getTime() + PY_OFFSET_MS);
  return `${py.getUTCDate()}/${py.getUTCMonth() + 1}`;
}

/** weekEnd es exclusivo: el último día cubierto es el anterior */
function rangoTexto(weekStart: Date, weekEnd: Date): string {
  return `${fechaCorta(weekStart)} al ${fechaCorta(new Date(weekEnd.getTime() - 1))}`;
}

const TONO_COLOR = { positivo: '#059669', neutral: '#7C3AED', alerta: '#B45309' } as const;

function envoltorio(inner: string): string {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6;padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td>${inner}
          <p style="font-size:12px;color:#999999;margin:24px 0 0;">
            BotForge · Informe generado automáticamente a partir de las conversaciones reales de tu bot.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function fila(label: string, valor: string): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#111111;">${label}</td>
    <td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#333333;text-align:right;font-weight:bold;">${valor}</td>
  </tr>`;
}

function boton(url: string, texto: string): string {
  return `<p style="margin:24px 0 0;">
    <a href="${url}" style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:bold;">${texto}</a>
  </p>`;
}

// ─── Email del informe individual ─────────────────────────────────────────────

function emailIndividual(params: {
  nombre: string;
  botName: string;
  content: WeeklyReportContent;
  weekStart: Date;
  weekEnd: Date;
}): string {
  const { nombre, botName, content, weekStart, weekEnd } = params;
  const url = `${env.FRONTEND_URL}/dashboard/reportes`;
  const r = content.resumen;

  const sinResponder = content.unansweredQuestions
    .slice(0, 3)
    .map(
      (q) => `<li style="margin:0 0 6px;font-size:14px;color:#333333;">
        ${q.pregunta} <span style="color:#888888;">(${q.veces} ${q.veces === 1 ? 'vez' : 'veces'})</span>
      </li>`,
    )
    .join('');

  return envoltorio(`
    <p style="font-size:13px;color:#7C3AED;margin:0 0 4px;font-weight:bold;letter-spacing:0.5px;">INFORME SEMANAL</p>
    <h1 style="font-size:22px;color:#111111;margin:0 0 4px;">${botName}</h1>
    <p style="font-size:13px;color:#888888;margin:0 0 24px;">Semana del ${rangoTexto(weekStart, weekEnd)}</p>

    <p style="font-size:15px;line-height:1.6;color:#333333;margin:0 0 16px;">Hola ${nombre},</p>

    <div style="border-left:3px solid ${TONO_COLOR[r.tono]};background:#fafafa;padding:16px 18px;border-radius:0 8px 8px 0;margin:0 0 24px;">
      <p style="font-size:15px;font-weight:bold;color:${TONO_COLOR[r.tono]};margin:0 0 8px;">${r.titulo}</p>
      ${r.parrafos.map((p) => `<p style="font-size:14px;line-height:1.6;color:#333333;margin:0 0 8px;">${p}</p>`).join('')}
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      ${fila('Conversaciones nuevas', String(content.totalConversations))}
      ${fila('Mensajes', String(content.totalMessages))}
      ${fila('Consultas que no supo resolver', String(content.humanRequestedCount))}
      ${content.npsAverage !== null
        ? fila('Satisfacción', `${content.npsAverage.toFixed(1)} / 5 · ${content.npsResponseCount} respuesta${content.npsResponseCount === 1 ? '' : 's'}`)
        : ''}
    </table>

    ${sinResponder
      ? `<p style="font-size:14px;color:#111111;margin:0 0 8px;"><strong>Lo que tu bot no supo responder:</strong></p>
         <ul style="margin:0 0 8px;padding-left:18px;">${sinResponder}</ul>
         <p style="font-size:13px;color:#888888;margin:0;">Cargalas desde el panel y la próxima semana ya las va a saber.</p>`
      : ''}

    ${boton(url, 'Ver el informe completo')}
  `);
}

// ─── Email del consolidado (Agencia) ──────────────────────────────────────────

function emailConsolidado(params: {
  nombre: string;
  content: ConsolidatedContent;
  weekStart: Date;
  weekEnd: Date;
}): string {
  const { nombre, content, weekStart, weekEnd } = params;
  const url = `${env.FRONTEND_URL}/dashboard/reportes?vista=consolidado`;
  const r = content.resumen;

  const ranking = content.bots
    .slice(0, 6)
    .map(
      (b, i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#111111;">
          <span style="color:#999999;">${i + 1}.</span> ${b.botName}
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #eeeeee;font-size:13px;color:#333333;text-align:right;">
          ${b.conversations} conv. · ${b.nps !== null ? `${b.nps.toFixed(1)}/5` : 'sin NPS'}
        </td>
      </tr>`,
    )
    .join('');

  return envoltorio(`
    <p style="font-size:13px;color:#7C3AED;margin:0 0 4px;font-weight:bold;letter-spacing:0.5px;">INFORME CONSOLIDADO</p>
    <h1 style="font-size:22px;color:#111111;margin:0 0 4px;">Tus ${content.totalBots} bots</h1>
    <p style="font-size:13px;color:#888888;margin:0 0 24px;">Semana del ${rangoTexto(weekStart, weekEnd)}</p>

    <p style="font-size:15px;line-height:1.6;color:#333333;margin:0 0 16px;">Hola ${nombre},</p>

    <div style="border-left:3px solid ${TONO_COLOR[r.tono]};background:#fafafa;padding:16px 18px;border-radius:0 8px 8px 0;margin:0 0 24px;">
      <p style="font-size:15px;font-weight:bold;color:${TONO_COLOR[r.tono]};margin:0 0 8px;">${r.titulo}</p>
      ${r.parrafos.map((p) => `<p style="font-size:14px;line-height:1.6;color:#333333;margin:0 0 8px;">${p}</p>`).join('')}
    </div>

    <p style="font-size:14px;color:#111111;margin:0 0 8px;"><strong>Ranking por volumen</strong></p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${ranking}</table>

    ${boton(url, 'Ver el consolidado completo')}
  `);
}

// ─── Corrida ──────────────────────────────────────────────────────────────────

export interface ResultadoCorrida {
  usuarios: number;
  generados: number;
  fallidos: number;
  consolidados: number;
  consolidadosFallidos: number;
  omitidos: number;
}

/**
 * Genera los informes de la semana indicada (por defecto, la que acaba de
 * terminar) para todos los usuarios cuyo plan vigente los incluya.
 */
export async function generateWeeklyReports(
  rango = semanaAnterior(),
): Promise<ResultadoCorrida> {
  const { weekStart, weekEnd } = rango;
  const res: ResultadoCorrida = {
    usuarios: 0, generados: 0, fallidos: 0,
    consolidados: 0, consolidadosFallidos: 0, omitidos: 0,
  };

  const planesConReporte = (Object.keys(LIMITS) as Array<keyof typeof LIMITS>).filter(
    (p) => LIMITS[p].weeklyReports,
  );

  const usuarios = await prisma.user.findMany({
    where: { plan: { in: planesConReporte } },
    select: {
      id: true, name: true, email: true, plan: true, planExpiresAt: true,
      bots: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      },
    },
  });

  for (const user of usuarios) {
    // El plan vencido vale FREE: no se le genera nada aunque la columna diga PRO
    const plan = effectivePlan(user);
    if (!LIMITS[plan].weeklyReports) {
      res.omitidos += user.bots.length;
      continue;
    }
    res.usuarios += 1;

    // ── Individuales: TODOS los bots activos, uno por uno ──────────────────
    let algunoSalió = false;
    for (const bot of user.bots) {
      try {
        const { content } = await generarYGuardar(bot.id, weekStart, weekEnd);
        res.generados += 1;
        algunoSalió = true;

        // Sin actividad no se manda email: un informe en cero solo molesta.
        // El informe igual queda guardado y visible en el panel.
        if (content.totalMessages === 0) continue;
        await sendEmail(
          user.email,
          `Informe semanal de ${bot.name}`,
          emailIndividual({
            nombre: user.name ?? 'Hola',
            botName: bot.name,
            content, weekStart, weekEnd,
          }),
        );
      } catch (err) {
        res.fallidos += 1;
        console.error(`[weeklyReport] Falló el informe del bot ${bot.id}:`, err);
      }
    }

    // ── Consolidado: después de los individuales, que son su insumo ────────
    // Se arma aunque alguno haya fallado: mejor comparar los que salieron que
    // no entregar nada. Con un solo bot no aporta: es el mismo informe otra vez.
    if (!LIMITS[plan].consolidatedReports || !algunoSalió || user.bots.length < 2) continue;
    try {
      const consolidado = await generarYGuardarConsolidado(user.id, weekStart, weekEnd);
      if (!consolidado) continue;
      res.consolidados += 1;

      if (consolidado.content.totalMessages === 0) continue;
      await sendEmail(
        user.email,
        `Informe consolidado de tus ${consolidado.content.totalBots} bots`,
        emailConsolidado({
          nombre: user.name ?? 'Hola',
          content: consolidado.content, weekStart, weekEnd,
        }),
      );
    } catch (err) {
      res.consolidadosFallidos += 1;
      console.error(`[weeklyReport] Falló el consolidado del usuario ${user.id}:`, err);
    }
  }

  console.log(
    `[weeklyReport] Corrida terminada: ${res.generados} informes de ${res.usuarios} usuarios, ` +
      `${res.consolidados} consolidados, ${res.fallidos} fallidos, ` +
      `${res.consolidadosFallidos} consolidados fallidos, ${res.omitidos} omitidos por plan`,
  );
  return res;
}
