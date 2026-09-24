/**
 * Un solo punto de verdad para decidir CON QUE credencial se le habla a Meta.
 *
 * Hoy todos los bots atienden desde el numero de BotForge y comparten el mismo
 * System User token, que vive en el entorno. Cuando entre Embedded Signup cada
 * cliente va a traer su propio numero y su propio business token, scopeado a su
 * WABA: el token global no sirve para operar activos de otro negocio.
 *
 * Este archivo existe para que ese cambio toque un solo lugar. Los servicios ya
 * no leen env.META_WHATSAPP_TOKEN: piden una credencial y la usan.
 */
import { env } from '../config/env';
import { descifrar } from '../lib/cifrado';

/**
 * El numero y el token viajan JUNTOS a proposito.
 *
 * Antes el numero iba suelto como primer parametro y el token se leia del
 * entorno adentro de cada funcion. Con un token por cliente eso se vuelve
 * peligroso: nada impediria enviar por el numero de un negocio con el token de
 * otro, y Meta lo rechazaria con un 401 dificil de rastrear. Atados en un mismo
 * objeto, el par siempre sale del mismo bot.
 */
export interface CredencialMeta {
  phoneNumberId: string;
  token: string;
}

/**
 * Lo minimo que hace falta de un bot para resolver su credencial.
 *
 * Se declara como tipo propio y no como el Bot de Prisma para que el dia que
 * exista Bot.metaBusinessToken alcance con sumar el campo aca.
 */
export interface BotConCredencial {
  metaPhoneNumberId: string | null;
  metaBusinessToken?: string | null;
  /** ACTIVO | ERROR | REVOCADO | null */
  metaEstado?: string | null;
}

/** El unico estado en el que el token propio del bot se considera usable. */
export const ESTADO_ACTIVO = 'ACTIVO';

/** El System User token de BotForge. Es el unico que existe hoy. */
export function tokenGlobal(): string {
  return env.META_WHATSAPP_TOKEN;
}

/**
 * El token con el que corresponde hablarle a Meta por ESTE bot.
 *
 * Si el bot se conecto por Embedded Signup tiene su propio business token,
 * scopeado a la WABA de su dueño: es el unico que sirve para operar ese numero.
 *
 * Se exige ademas metaEstado === ACTIVO. Un bot cuyo onboarding quedo a medias
 * (ERROR) o al que el cliente le revoco el acceso (REVOCADO) tiene un token
 * guardado que ya no funciona; usarlo daria un 401 en vez de caer al global,
 * que al menos sigue atendiendo desde el numero de BotForge.
 */
export function tokenDelBot(bot?: BotConCredencial | null): string {
  if (bot?.metaBusinessToken && bot.metaEstado === ESTADO_ACTIVO) {
    // Guardado cifrado si TOKEN_ENCRYPTION_KEY esta cargada; si no, tal cual.
    // descifrar() distingue los dos casos por el prefijo del valor.
    const enClaro = descifrar(bot.metaBusinessToken);
    if (enClaro) return enClaro;
    // No se pudo abrir: mejor caer al token global que quedarse sin ninguno
    console.error('[metaAuth] el token del bot no se pudo descifrar, se usa el global');
  }
  return tokenGlobal();
}

/** Credencial de un bot con numero conectado. */
export function credencialDeBot(bot: BotConCredencial): CredencialMeta {
  if (!bot.metaPhoneNumberId) {
    throw new Error('El bot no tiene un número de WhatsApp conectado');
  }
  return { phoneNumberId: bot.metaPhoneNumberId, token: tokenDelBot(bot) };
}

/**
 * Credencial para un numero cuyo bot todavia no se resolvio.
 *
 * El webhook responde algunos avisos antes de saber a quien pertenece el
 * numero: "este numero no tiene un bot activo", "no pude entender ese mensaje".
 * Ahi el unico token disponible es el global, que ademas es el correcto: esos
 * avisos salen del numero de BotForge.
 */
export function credencialGlobal(phoneNumberId: string): CredencialMeta {
  return { phoneNumberId, token: tokenGlobal() };
}

/** El header que Meta espera. El token nunca se loguea: viaja solo aca. */
export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
