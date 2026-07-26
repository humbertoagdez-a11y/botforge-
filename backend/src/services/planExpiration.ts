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
import { sendEmail } from './email';

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
 * Avisa por email a quienes les vence el plan dentro de los proximos
 * AVISO_DIAS dias. Devuelve la cantidad de avisos enviados.
 *
 * Como no hay una columna que registre el ultimo aviso, corriendo a diario
 * manda un recordatorio por dia durante los ultimos 3 dias (3 emails). Para
 * que sea exactamente uno haria falta un campo tipo renewalNoticeSentAt.
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
      select: { id: true, email: true, name: true, plan: true, planExpiresAt: true },
    });

    for (const user of porVencer) {
      try {
        if (!user.planExpiresAt) continue;
        const diasRestantes = Math.max(
          1,
          Math.ceil((user.planExpiresAt.getTime() - ahora.getTime()) / (24 * 60 * 60 * 1000)),
        );

        const ok = await sendEmail(
          user.email,
          `Tu plan ${PLAN_LABEL[user.plan] ?? user.plan} vence en ${diasRestantes} día${diasRestantes === 1 ? '' : 's'}`,
          expiringSoonHtml(user.name, user.plan, diasRestantes),
        );
        if (ok) enviados += 1;
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

function expiringSoonHtml(nombre: string, plan: string, dias: number): string {
  const pricingUrl = `${env.FRONTEND_URL}/pricing`;
  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:22px;font-weight:bold;color:#7C3AED;margin:0 0 24px;">BotForge</p>
      <p style="font-size:16px;margin:0 0 8px;">Hola ${nombre},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
        Tu plan <strong>${PLAN_LABEL[plan] ?? plan}</strong> vence en
        <strong>${dias} día${dias === 1 ? '' : 's'}</strong>. Renovalo para que tus bots
        sigan respondiendo por WhatsApp sin interrupciones.
      </p>
      <a href="${pricingUrl}"
         style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:8px;margin:8px 0 28px;">
        Renovar mi plan
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
  const pricingUrl = `${env.FRONTEND_URL}/pricing`;
  try {
    await sendEmail(
      email,
      'Tu plan de BotForge venció',
      `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:22px;font-weight:bold;color:#7C3AED;margin:0 0 24px;">BotForge</p>
      <p style="font-size:16px;margin:0 0 8px;">Hola ${nombre},</p>
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
