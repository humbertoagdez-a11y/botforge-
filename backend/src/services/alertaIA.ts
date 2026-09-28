/**
 * Avisa cuando la cuenta de Anthropic deja de funcionar.
 *
 * POR QUE EXISTE: se acabó el crédito de la API y el sistema no lo dijo por
 * ningún lado. Los bots dejaron de contestar, el cliente final recibía
 * "Hubo un problema, intentá de nuevo" —que además es un mal consejo, porque
 * reintentar no arregla una cuenta sin saldo— y nadie se enteraba hasta
 * probarlo a mano.
 *
 * Es la peor clase de falla: no es un bug, no aparece en los tests, y desde
 * afuera se ve igual que un bot lento.
 */
import { env } from '../config/env';
import { escaparHtml, sendEmail } from './email';
import {
  isMetaConfigured,
  sendTextMessage,
  sendTemplateMessage,
  limpiarParametro,
  ErrorEnvioMeta,
} from './metaMessaging';
import { IDIOMA_PLANTILLA } from './avisoWhatsApp';
import { credencialGlobal } from './metaAuth';

/**
 * La plantilla con la que sale la alerta por WhatsApp.
 *
 * Hace falta una plantilla porque el admin casi nunca va a tener una ventana
 * de 24 horas abierta con este número: justamente, si algo se rompe de
 * madrugada, hace rato que no le escribió. Fuera de esa ventana Meta solo
 * acepta plantillas aprobadas.
 */
export const PLANTILLA_ALERTA = 'alerta_bots_caidos';

/** Celular del admin. Va por variable para no clavar un número en el código. */
const CELULAR_ADMIN = process.env.ADMIN_CELULAR ?? '+595981679869';

/**
 * Lo que recibe el cliente final mientras la cuenta esté caída.
 *
 * No dice "intentá de nuevo": reintentar no va a funcionar y solo lo hace
 * perder el tiempo. Tampoco dice qué pasó — al cliente de una rotisería no le
 * importa nuestra facturación.
 */
export const MENSAJE_MIENTRAS_ESTA_CAIDO =
  'Perdón, en un momento te respondemos. Estamos teniendo un problema técnico y ya lo estamos viendo.';

/**
 * Si el error es de la CUENTA y no del mensaje.
 *
 * Se distingue de un fallo pasajero porque ninguno de estos mejora
 * reintentando: hay que poner plata o arreglar la clave. Los códigos salen de
 * la doc de errores de Anthropic; el texto se mira además porque el saldo
 * insuficiente llega como un 400 genérico y solo se reconoce por el mensaje.
 */
export function esFallaDeCuenta(err: unknown): { esFalla: boolean; motivo: string } {
  const e = err as { status?: number; message?: string; error?: { error?: { message?: string } } };
  const texto = `${e?.message ?? ''} ${e?.error?.error?.message ?? ''}`.toLowerCase();

  if (/credit balance is too low|insufficient.*(credit|balance|quota)|billing/.test(texto)) {
    return { esFalla: true, motivo: 'La cuenta de Anthropic se quedó sin crédito' };
  }
  if (e?.status === 401 || /invalid x-api-key|authentication_error/.test(texto)) {
    return { esFalla: true, motivo: 'La ANTHROPIC_API_KEY no es válida o fue revocada' };
  }
  if (e?.status === 403 || /permission_error/.test(texto)) {
    return { esFalla: true, motivo: 'La clave de Anthropic no tiene permiso para este modelo' };
  }
  return { esFalla: false, motivo: '' };
}

/**
 * Cuánto se espera antes de volver a avisar del mismo problema.
 *
 * El pedido era "uno solo por incidente, no uno por mensaje": con la cuenta
 * caída, CADA mensaje que entre dispara el mismo error, y sin esto el admin
 * recibiría un email por cada cliente que escriba — justo cuando lo último que
 * necesita es que le tapen la casilla.
 */
const VENTANA_SIN_REPETIR_MS = 6 * 60 * 60 * 1000;

/**
 * Estado en memoria.
 *
 * Es una limitación conocida: si el proceso reinicia, vuelve a avisar. Se
 * acepta porque la alternativa —una tabla nueva— agrega una escritura a la
 * base en el camino de una falla, que es justo cuando menos hay que depender
 * de más infraestructura. Un aviso de más al reiniciar es barato; uno de menos
 * no.
 */
let ultimoAviso = 0;
let incidenteAbierto = false;

/** Se llama cuando una respuesta sale bien: cierra el incidente. */
export function marcarIAFuncionando(): void {
  if (incidenteAbierto) {
    console.log('[alerta-ia] la cuenta volvió a funcionar, incidente cerrado');
    incidenteAbierto = false;
    ultimoAviso = 0;
  }
}

/**
 * Avisa al admin por email y por WhatsApp. Nunca lanza: esto corre dentro del
 * manejo de otro error y no puede generar uno nuevo.
 */
export async function avisarFallaDeCuenta(
  motivo: string,
  contexto: { botId?: string; canal?: string },
): Promise<void> {
  // El log va SIEMPRE, aunque el aviso esté deduplicado: en los logs querés
  // ver cada ocurrencia para saber cuántos clientes quedaron sin respuesta.
  console.error(
    `[alerta-ia] LA IA NO RESPONDE — ${motivo}` +
      `${contexto.botId ? ` · bot ${contexto.botId}` : ''}` +
      `${contexto.canal ? ` · canal ${contexto.canal}` : ''}`,
  );

  const ahora = Date.now();
  if (incidenteAbierto && ahora - ultimoAviso < VENTANA_SIN_REPETIR_MS) {
    return;
  }
  incidenteAbierto = true;
  ultimoAviso = ahora;

  const asunto = 'BotForge: los bots no están respondiendo';
  const cuerpo =
    `${motivo}. Los bots no pueden generar respuestas hasta que se resuelva. ` +
    'Mientras tanto, a los clientes se les avisa que hay un problema técnico.';

  // Email primero: es el que siempre funciona, sin depender de ventanas de
  // WhatsApp ni de plantillas aprobadas.
  try {
    const ok = await sendEmail(
      env.ADMIN_EMAIL,
      asunto,
      `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:20px;font-weight:bold;color:#7C3AED;margin:0 0 6px;">BotForge</p>
      <p style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;font-size:15px;font-weight:bold;border-radius:8px;padding:12px 14px;margin:0 0 20px;">
        Los bots no están respondiendo
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">${escaparHtml(cuerpo)}</p>
      <p style="font-size:13px;color:#666666;margin:0;">
        Este aviso se manda una sola vez por incidente. Cuando la cuenta vuelva
        a funcionar, queda registrado en los logs.
      </p>
    </div>
  </body>
</html>`,
    );
    console.error(`[alerta-ia] email al admin: ${ok ? 'enviado' : 'no salió'}`);
  } catch (err) {
    console.error('[alerta-ia] el email al admin falló:', err instanceof Error ? err.message : err);
  }

  // WhatsApp después.
  //
  // Primero por plantilla: es lo único que llega fuera de la ventana de 24 h,
  // que es el caso normal — si algo se rompe de madrugada, hace rato que el
  // admin no le escribió a este número.
  //
  // Si la plantilla todavía no está aprobada se cae a texto libre, que llega
  // solo si la ventana está abierta. Así la alerta funciona desde el día uno
  // y mejora sola cuando Meta aprueba, sin tocar código.
  if (!isMetaConfigured()) return;

  const cred = credencialGlobal(env.META_PHONE_NUMBER_ID);
  const cuando = new Date().toLocaleString('es-PY', { timeZone: 'America/Asuncion' });

  try {
    await sendTemplateMessage(cred, CELULAR_ADMIN, PLANTILLA_ALERTA, IDIOMA_PLANTILLA, [
      limpiarParametro(motivo, 'falla en la cuenta de IA'),
      limpiarParametro(cuando, 'ahora'),
    ]);
    console.error('[alerta-ia] WhatsApp al admin: enviado por plantilla');
    return;
  } catch (err) {
    const plantillaNoLista = err instanceof ErrorEnvioMeta && err.plantillaNoUsable;
    console.error(
      `[alerta-ia] la plantilla ${PLANTILLA_ALERTA} no se pudo usar` +
        `${plantillaNoLista ? ' (todavía no aprobada)' : ''}, se prueba texto libre`,
    );
  }

  try {
    await sendTextMessage(cred, CELULAR_ADMIN, `BotForge: ${cuerpo}`);
    console.error('[alerta-ia] WhatsApp al admin: enviado como texto libre');
  } catch (err) {
    const detalle =
      err instanceof ErrorEnvioMeta
        ? `${err.codigo ?? 'sin código'} — probablemente fuera de la ventana de 24 h`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`[alerta-ia] WhatsApp al admin no salió: ${detalle}. El email es la vía segura.`);
  }
}
