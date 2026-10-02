/**
 * Corta las conversaciones del bot de ventas que no van a ningun lado.
 *
 * POR QUE EXISTE: la primera conversacion que llego de un anuncio gasto 58.793
 * tokens en 26 turnos y no dejo nada. La persona quedo descalificada en el
 * turno 4 —le preguntaron si tenia un negocio y contesto "Nada"— y el 84% del
 * gasto ocurrio DESPUES de saber que no era un prospecto.
 *
 * Las reglas del prompt ayudan pero no garantizan: el modelo puede seguir
 * contestando igual. Esto corta antes de llamar a la API, que es donde esta el
 * gasto — no alcanza con pedirle al modelo que sea breve si igual se lo
 * invoca veinte veces.
 *
 * Solo aplica al bot de ventas. Un bot de cliente tiene que contestar siempre:
 * la rotiseria no quiere que su bot deje de atender a nadie.
 */
import { prisma } from '../lib/prisma';
import { env } from '../config/env';

/**
 * Cuantos mensajes del cliente se permiten sin una sola señal de intencion.
 *
 * Seis, medido contra las conversaciones reales. En la que se fue de las manos
 * habria cortado en el turno 6 (76% de ahorro). En la que SI termino en lead,
 * la señal de intencion aparecio en el turno 4 —"que pod tienen disponible?"—
 * asi que no la habria tocado. Con cinco el margen quedaba muy justo; con
 * ocho ya se habian gastado 18.000 tokens.
 */
export const MAX_MENSAJES_SIN_INTENCION = 6;

/** Cuanto dura el silencio antes de volver a atender a la misma persona. */
const SILENCIO_MS = 24 * 60 * 60 * 1000;

/**
 * El mensaje que Meta precarga en los anuncios Click-to-WhatsApp.
 *
 * Se excluye a proposito y es la parte mas importante de todo esto: el texto
 * es "¡Hola! Quiero más información.", o sea que TODA conversacion que venga
 * de un anuncio empieza con la palabra "quiero". Contarlo como intencion
 * dejaba exenta del limite justamente a la unica clase de conversacion que el
 * limite tiene que cubrir.
 *
 * No lo escribio la persona: lo puso el boton del anuncio. No dice nada de
 * ella.
 */
const APERTURA_DE_ANUNCIO =
  /^\s*¡?\s*hola\s*!?[,.]?\s*(quiero|quisiera|me gustar[ií]a|necesito)\s+(m[aá]s\s+)?informaci[oó]n\s*\.?\s*$/i;

/**
 * Lo que cuenta como intencion real.
 *
 * Precision antes que amplitud, pero con el sesgo puesto: ante la duda se
 * atiende. El error caro es callarle la boca a un prospecto; gastar unos
 * tokens de mas con un curioso cuesta centavos.
 *
 * No se enumeran rubros —hay infinitos y siempre falta uno— sino la FORMA en
 * que alguien cuenta que tiene un negocio: "tengo una rotiseria", "mi local",
 * "soy dueño de". Asi entra cualquier rubro sin listarlo.
 */
const SENALES_DE_INTENCION = [
  // Plata
  /\b(precio|cuanto (sale|cuesta|vale)|cu[aá]nto (sale|cuesta|vale)|tarifa|planes?\b|cobran|mensual|gratis|pagar)\b/i,
  // Querer avanzar. El verbo solo no alcanza: "quiero arreglar la moto" no es
  // intencion de compra, "quiero contratar" si.
  /\b(contratar|suscrib\w*|comprar|registrarme|darme de alta|lo quiero|me interesa|quiero (empezar|arrancar|probar|el|un plan))\b/i,
  // Contar que tiene un negocio, en cualquier rubro
  /\b(tengo (un|una|mi)\b|mi (negocio|local|tienda|empresa|emprendimiento)|soy (due[ñn]|propietari)\w*|tenemos un)/i,
  // Contar a que se dedica.
  //
  // El sustantivo SOLO no sirve, y esto lo destapo la prueba: "Que negocio"
  // es la persona devolviendo la pregunta del bot, confundida, y se contaba
  // como intencion — con lo cual la conversacion que hay que cortar quedaba
  // exenta. Hace falta que este CONTANDO algo, no preguntando.
  // "venta de ...": asi contesto el unico prospecto real de la auditoria
  // ("Venta de productos y servicios para el hogar") y no se detectaba.
  /\b(vendo|vendemos|venta de|fabrico|reparo|atiendo|mi rubro|nuestro (negocio|local|emprendimiento)|en mi (negocio|local|tienda))\b/i,
  /\bcat[aá]logo\b/i,
  // Evaluar el producto
  // "Donde aparece la informacion" tambien es evaluar: lo pregunto alguien
  // en la auditoria antes de pedir como funciona.
  /\b(c[oó]mo funciona|como funciona|funciona con|c[oó]mo empiezo|como empiezo|demo|probarlo|me sirve|sirve para|se conecta|anda con|d[oó]nde (aparece|se carga|se pone)|c[oó]mo se (usa|configura|carga))\b/i,
];

/**
 * Si el mensaje muestra que la persona puede llegar a comprar.
 *
 * La apertura del anuncio se descarta antes de mirar nada: la escribio Meta,
 * no la persona.
 */
export function tieneIntencion(texto: string): boolean {
  if (APERTURA_DE_ANUNCIO.test(texto)) return false;
  return SENALES_DE_INTENCION.some((re) => re.test(texto));
}

/** El cierre: el dato concreto para que pueda volver solo si le interesa. */
function mensajeDeCierre(): string {
  return (
    `Te dejo lo concreto: el plan con WhatsApp arranca en Gs. 150.000 por mes y hay uno gratis para probar. ` +
    `Te registrás en ${env.FRONTEND_URL} y lo tenés andando en minutos. ` +
    `Si más adelante querés que te lo arme alguien del equipo, escribime y lo vemos.`
  );
}

export interface DecisionDeLimite {
  /** true: no hay que llamar a la API ni contestar nada */
  callar: boolean;
  /** Si viene, es el unico mensaje que hay que mandar, sin pasar por el modelo */
  cierre?: string;
}

/**
 * Decide si esta conversacion sigue, se cierra, o ya esta callada.
 *
 * Se llama ANTES de runTenantTurn: el punto es no gastar la llamada.
 * Nunca lanza — si algo falla, se atiende normalmente, que es el lado seguro.
 */
export async function evaluarLimiteDeVentas(
  botId: string,
  conversationId: string,
  mensajeEntrante: string,
): Promise<DecisionDeLimite> {
  if (!env.BOT_VENTAS_ID || botId !== env.BOT_VENTAS_ID) return { callar: false };

  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        leadAvisadoEn: true,
        cerradaPorLimiteEn: true,
        messages: {
          where: { role: 'USER' },
          orderBy: { createdAt: 'asc' },
          select: { content: true },
        },
      },
    });
    if (!conv) return { callar: false };

    // Un lead ya marcado es un prospecto: nunca se le corta.
    if (conv.leadAvisadoEn) return { callar: false };

    // El mensaje que acaba de llegar manda sobre todo lo anterior. Si trae
    // intencion, se reactiva aunque estuviera cerrada — es exactamente el caso
    // de alguien que vuelve dos dias despues a preguntar el precio.
    if (tieneIntencion(mensajeEntrante)) {
      if (conv.cerradaPorLimiteEn) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { cerradaPorLimiteEn: null },
        });
        console.log(`[limite-ventas] ${conversationId} reactivada: el mensaje trae intencion`);
      }
      return { callar: false };
    }

    // Cerrada y dentro de las 24 h, sin intencion: no se contesta nada.
    if (conv.cerradaPorLimiteEn) {
      const desde = Date.now() - conv.cerradaPorLimiteEn.getTime();
      if (desde < SILENCIO_MS) {
        console.log(
          `[limite-ventas] ${conversationId} en silencio (${Math.round(desde / 60000)} min de 1440)`,
        );
        return { callar: true };
      }
      // Pasadas las 24 h se vuelve a atender desde cero
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { cerradaPorLimiteEn: null },
      });
      return { callar: false };
    }

    // El mensaje entrante YA esta guardado cuando se llega aca: inboundMessage
    // lo graba antes de evaluar el limite. Hasta el 2026-10-02 se le sumaba +1
    // igual, asi que se contaba dos veces y el limite real era 5, no 6. En la
    // auditoria eso corto a alguien en el mensaje 5 que en el 6 pregunto
    // "Como funciona". Se mira el ultimo guardado en vez de asumir el orden,
    // para que no se rompa si algun dia se graba despues.
    const ultimo = conv.messages.at(-1)?.content;
    const delCliente = conv.messages.length + (ultimo === mensajeEntrante ? 0 : 1);
    if (delCliente < MAX_MENSAJES_SIN_INTENCION) return { callar: false };

    // Llego al limite: ¿hubo intencion en ALGUN momento?
    if (conv.messages.some((m) => tieneIntencion(m.content))) return { callar: false };

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { cerradaPorLimiteEn: new Date() },
    });
    console.log(
      `[limite-ventas] ${conversationId} cerrada por limite: ${delCliente} mensajes sin intencion`,
    );
    return { callar: false, cierre: mensajeDeCierre() };
  } catch (err) {
    // Ante cualquier problema se atiende: perder un prospecto por un fallo de
    // este chequeo es mucho peor que gastar unos tokens de mas.
    console.error('[limite-ventas] fallo el chequeo, se atiende normalmente:', err);
    return { callar: false };
  }
}
