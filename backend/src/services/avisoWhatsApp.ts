/**
 * Aviso al dueño del negocio por WhatsApp cuando un cliente final concreta algo.
 *
 * Vive aparte de tenantAgent.ts porque no es logica del agente: el agente
 * decide QUE avisar, esto decide POR DONDE sale.
 */
import { env } from '../config/env';
import {
  ErrorEnvioMeta,
  isMetaConfigured,
  limpiarParametro,
  sendTemplateMessage,
} from './metaMessaging';
import { credencialGlobal } from './metaAuth';

/**
 * La plantilla que hay que tener aprobada en Meta. El texto exacto esta en
 * docs/07-AVISOS-AL-DUENO.md — si se cambia una coma alla, hay que volver a
 * aprobarla aca.
 */
export const PLANTILLA_AVISO = 'aviso_pedido';
export const IDIOMA_PLANTILLA = 'es';

/** Lo que se pone en un parametro que el cliente no dejo. Meta rechaza vacios. */
const SIN_DATO = 'no lo dijo';

/**
 * Por donde sale el aviso de este bot.
 *
 * avisoCanal en null no es "sin configurar": significa que decide el celular.
 * Cargar el celular ya es elegir WhatsApp, y obligar a elegir dos veces es
 * como se terminan teniendo bots con celular cargado que igual avisan por mail.
 */
export function canalesDeAviso(bot: { avisoCelular: string | null; avisoCanal: string | null }): {
  whatsapp: boolean;
  email: boolean;
  celular: string | null;
} {
  const celular = bot.avisoCelular?.trim() || null;
  const elegido = bot.avisoCanal ?? (celular ? 'whatsapp' : 'email');

  // Sin celular no hay WhatsApp posible, aunque este elegido: el dueño pudo
  // elegir WhatsApp y despues borrar el numero.
  const whatsapp = celular !== null && (elegido === 'whatsapp' || elegido === 'ambos');

  return {
    whatsapp,
    // La invariante: SIEMPRE queda un canal. Sin esto, el dueño que elige
    // WhatsApp y despues borra el numero se queda sin ningun aviso, y se
    // entera el dia que le reclamen un pedido que nunca vio.
    email: elegido === 'email' || elegido === 'ambos' || !whatsapp,
    celular,
  };
}

export interface DatosAviso {
  tipo: string;
  etiqueta: string;
  negocio: string;
  resumen: string;
  nombre: string;
  contacto: string;
}

/**
 * Manda el aviso por WhatsApp. Devuelve false si no se pudo, para que el
 * llamador caiga a email.
 *
 * Sale SIEMPRE del numero global de BotForge, nunca del numero propio del bot,
 * aunque el bot tenga el suyo por Embedded Signup. Una plantilla solo existe
 * dentro de la WABA que la aprobo: si el aviso saliera del numero del cliente,
 * cada cliente tendria que aprobar la plantilla en SU cuenta de Meta antes de
 * recibir un solo aviso. Saliendo del numero de BotForge se aprueba una vez y
 * funciona para todos.
 *
 * Nunca lanza: un aviso que falla no puede tumbar la respuesta al cliente.
 */
export async function avisarPorWhatsApp(
  celular: string,
  datos: DatosAviso,
): Promise<{ enviado: boolean; motivo?: string }> {
  if (!isMetaConfigured()) {
    return { enviado: false, motivo: 'Meta no configurada' };
  }

  try {
    await sendTemplateMessage(
      credencialGlobal(env.META_PHONE_NUMBER_ID),
      celular,
      PLANTILLA_AVISO,
      IDIOMA_PLANTILLA,
      [
        limpiarParametro(datos.etiqueta.toLowerCase(), 'pedido'),
        limpiarParametro(datos.negocio, 'tu bot'),
        limpiarParametro(datos.resumen, 'entra al panel para verlo'),
        limpiarParametro(datos.nombre, SIN_DATO),
        limpiarParametro(datos.contacto, SIN_DATO),
      ],
    );
    return { enviado: true };
  } catch (err) {
    if (err instanceof ErrorEnvioMeta && err.plantillaNoUsable) {
      // El caso esperado mientras Meta no aprueba la plantilla. No es un error
      // del sistema: se avisa por email y listo.
      console.log(
        `[aviso] la plantilla ${PLANTILLA_AVISO} todavia no se puede usar (${err.codigo}), se avisa por email`,
      );
      return { enviado: false, motivo: 'plantilla no aprobada' };
    }
    const motivo = err instanceof Error ? err.message : String(err);
    console.error(`[aviso] WhatsApp fallo, se cae a email: ${motivo}`);
    return { enviado: false, motivo };
  }
}
