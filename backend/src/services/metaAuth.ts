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
  // Sesion 2: metaBusinessToken?: string | null;
}

/** El System User token de BotForge. Es el unico que existe hoy. */
export function tokenGlobal(): string {
  return env.META_WHATSAPP_TOKEN;
}

/**
 * El token con el que corresponde hablarle a Meta por ESTE bot.
 *
 * HOY devuelve siempre el global, porque ningun bot tiene token propio. En la
 * Sesion 2, cuando el campo exista, la primera linea pasa a ser
 *   if (bot?.metaBusinessToken) return bot.metaBusinessToken;
 * y ningun call site se entera del cambio.
 */
export function tokenDelBot(_bot?: BotConCredencial | null): string {
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
