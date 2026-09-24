/**
 * Vencimiento de planes.
 *
 * Los pagos de Pagopar son unicos (no hay debito automatico todavia), asi que
 * cada pago deja planExpiresAt a 30 dias. Sin este proceso el plan quedaria
 * activo para siempre.
 *
 * La verificacion en tiempo real vive en middleware/planLimits.ts
 * (effectivePlan): corta el acceso apenas vence. Esto de aca es la limpieza
 * real de la columna, que corre una vez al dia.
 */
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { escaparHtml, sendEmail } from './email';
import { PLAN_MONTOS } from './pagopar';

/** Cuantos dias antes del vencimiento se avisa por email */
const AVISO_DIAS = 3;

const PLAN_LABEL: Record<string, string> = {
  FREE: 'Free',
  STARTER: 'Básico',
  PRO: 'Profesional',
  AGENCY: 'Agencia',
};

// ─── Downgrade de los vencidos ────────────────────────────────────────────────

/**
 * Baja a FREE todos los planes pagos ya vencidos.
 * Nunca lanza: un fallo individual se loguea y sigue con el resto.
 * Devuelve la cantidad de usuarios degradados.
 */
export async function downgradeExpiredPlans(): Promise<number> {
  let degradados = 0;

  try {
    const vencidos = await prisma.user.findMany({
      where: {
        plan: { not: 'FREE' },
        planExpiresAt: { not: null, lt: new Date() },
      },
      select: { id: true, email: true, name: true, plan: true, planExpiresAt: true },
    });

    for (const user of vencidos) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { plan: 'FREE', planExpiresAt: null },
        });
        degradados += 1;
        // Rastro para poder auditar por que un usuario quedo en FREE
        console.log(
          `[planExpiration] Usuario ${user.id} degradado de ${user.plan} a FREE ` +
            `(vencio el ${user.planExpiresAt?.toISOString() ?? 'sin fecha'})`,
        );

        void notifyDowngraded(user.email, user.name, user.plan);
      } catch (err) {
        console.error(`[planExpiration] Error degradando al usuario ${user.id}:`, err);
      }
    }

    console.log(`[planExpiration] Planes vencidos degradados: ${degradados}/${vencidos.length}`);
  } catch (err) {
    // El cron nunca debe tumbar el proceso
    console.error('[planExpiration] Error buscando planes vencidos:', err);
  }

  return degradados;
}

// ─── Aviso previo al vencimiento ──────────────────────────────────────────────

/**
 * Si a este usuario ya se le aviso por el ciclo que esta corriendo.
 *
 * El ciclo arranca AVISO_DIAS antes del vencimiento. Un aviso anterior a ese
 * momento pertenece a un periodo que el usuario ya renovo, asi que no cuenta:
 * es lo que hace que al renovar no haya que limpiar la columna a mano.
 */
export function yaSeAviso(
  planExpiresAt: Date,
  renewalNoticeSentAt: Date | null,
): boolean {
  if (!renewalNoticeSentAt) return false;
  const arranqueDelCiclo = planExpiresAt.getTime() - AVISO_DIAS * 24 * 60 * 60 * 1000;
  return renewalNoticeSentAt.getTime() >= arranqueDelCiclo;
}

/**
 * Avisa por email a quienes les vence el plan dentro de los proximos
 * AVISO_DIAS dias. Devuelve la cantidad de avisos enviados.
 *
 * UNO por ciclo, no uno por dia. El cron corre todos los dias y AVISO_DIAS es
 * 3, asi que sin registrar el aviso al usuario le llegaban tres emails
 * identicos en tres dias seguidos — que es la forma mas rapida de enseñarle a
 * ignorar los emails de BotForge.
 *
 * El criterio es comparar renewalNoticeSentAt contra planExpiresAt: si ya se
 * aviso DESPUES del arranque de este ciclo, no se vuelve a avisar. Al renovar,
 * planExpiresAt se corre hacia adelante y el ciclo siguiente avisa solo, sin
 * que nadie tenga que limpiar la columna.
 */
export async function notifyExpiringSoon(): Promise<number> {
  let enviados = 0;

  try {
    const ahora = new Date();
    const limite = new Date(ahora.getTime() + AVISO_DIAS * 24 * 60 * 60 * 1000);

    const porVencer = await prisma.user.findMany({
      where: {
        plan: { not: 'FREE' },
        planExpiresAt: { gt: ahora, lte: limite },
      },
      select: {
        id: true, email: true, name: true, plan: true,
        planExpiresAt: true, renewalNoticeSentAt: true,
      },
    });

    for (const user of porVencer) {
      try {
        if (!user.planExpiresAt) continue;

        if (yaSeAviso(user.planExpiresAt, user.renewalNoticeSentAt)) continue;

        const diasRestantes = Math.max(
          1,
          Math.ceil((user.planExpiresAt.getTime() - ahora.getTime()) / (24 * 60 * 60 * 1000)),
        );

        const ok = await sendEmail(
          user.email,
          `Tu plan ${PLAN_LABEL[user.plan] ?? user.plan} vence en ${diasRestantes} día${diasRestantes === 1 ? '' : 's'}`,
          expiringSoonHtml(user.name, user.plan, diasRestantes),
        );
        if (!ok) continue; // el email no salio: se reintenta mañana

        // Se marca DESPUES de que el email salio. Al reves, un fallo de Resend
        // dejaba al usuario sin aviso y sin posibilidad de recibirlo despues.
        await prisma.user.update({
          where: { id: user.id },
          data: { renewalNoticeSentAt: new Date() },
        });
        enviados += 1;
      } catch (err) {
        console.error(`[planExpiration] Error avisando al usuario ${user.id}:`, err);
      }
    }

    console.log(`[planExpiration] Avisos de vencimiento enviados: ${enviados}/${porVencer.length}`);
  } catch (err) {
    console.error('[planExpiration] Error buscando planes por vencer:', err);
  }

  return enviados;
}

// ─── Plantillas ───────────────────────────────────────────────────────────────

/**
 * Link que abre el checkout del plan que ya tiene.
 *
 * Antes apuntaba a /pricing pelado: el usuario aterrizaba en una tabla de
 * cuatro planes y tenia que acordarse de cual era el suyo. Con `renovar` la
 * pagina arranca el pago de ese plan sola.
 */
function urlDeRenovacion(plan: string): string {
  return `${env.FRONTEND_URL}/pricing?renovar=${encodeURIComponent(plan)}`;
}

function expiringSoonHtml(nombre: string, plan: string, dias: number): string {
  const pricingUrl = urlDeRenovacion(plan);
  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:22px;font-weight:bold;color:#7C3AED;margin:0 0 24px;">BotForge</p>
      <p style="font-size:16px;margin:0 0 8px;">Hola ${escaparHtml(nombre)},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
        Tu plan <strong>${PLAN_LABEL[plan] ?? plan}</strong> vence en
        <strong>${dias} día${dias === 1 ? '' : 's'}</strong>. Renovalo para que tus bots
        sigan respondiendo por WhatsApp sin interrupciones.
      </p>
      <a href="${pricingUrl}"
         style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:8px;margin:8px 0 28px;">
        Renovar ${PLAN_LABEL[plan] ?? plan} por Gs. ${(PLAN_MONTOS[plan as keyof typeof PLAN_MONTOS] ?? 0).toLocaleString('es-PY')}
      </a>
      <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 16px;" />
      <p style="font-size:12px;color:#888888;margin:0;">
        Si no renovás, tu cuenta pasa al plan Free y se desactiva WhatsApp.
      </p>
    </div>
  </body>
</html>`;
}

/** Aviso posterior: el plan ya vencio y la cuenta quedo en Free */
async function notifyDowngraded(email: string, nombre: string, planAnterior: string): Promise<void> {
  const pricingUrl = urlDeRenovacion(planAnterior);
  try {
    await sendEmail(
      email,
      'Tu plan de BotForge venció',
      `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:22px;font-weight:bold;color:#7C3AED;margin:0 0 24px;">BotForge</p>
      <p style="font-size:16px;margin:0 0 8px;">Hola ${escaparHtml(nombre)},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
        Tu plan <strong>${PLAN_LABEL[planAnterior] ?? planAnterior}</strong> venció y tu cuenta
        pasó al plan Free. Tus bots y documentos siguen ahí, pero WhatsApp queda desactivado.
      </p>
      <a href="${pricingUrl}"
         style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:8px;margin:8px 0 28px;">
        Reactivar mi plan
      </a>
    </div>
  </body>
</html>`,
    );
  } catch (err) {
    console.error('[planExpiration] Error enviando el aviso de degradación:', err);
  }
}
