import { PrismaClient } from '@prisma/client';

/**
 * El cliente de Prisma, con una extension que mantiene al dia
 * Conversation.updatedAt.
 *
 * El problema que resuelve: `@updatedAt` solo se dispara cuando se actualiza
 * LA FILA. Crear mensajes hijos no la toca, asi que una conversacion con
 * mensajes de hoy podia seguir diciendo que su ultima actividad fue hace una
 * semana. Medido en produccion: una conversacion con mensajes del 27 de
 * septiembre tenia updatedAt del 22.
 *
 * Eso no era cosmetico. De ese campo dependen el orden del panel de
 * conversaciones (un pedido nuevo quedaba hundido en la lista), el KPI de
 * conversaciones activas en 24 horas, el feed de actividad, varias
 * herramientas del asistente del dashboard, y npsDispatch, que elige a quien
 * encuestar por ventana de updatedAt — o sea que la encuesta podia no salirle
 * nunca a quien acababa de escribir.
 *
 * Va como extension del cliente y no como una linea en cada `message.create`
 * por como nacio el bug: hay seis lugares que crean mensajes y alcanzo con
 * que ninguno se acordara. Aca no hay nada que acordarse.
 */
function crearCliente() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  return base.$extends({
    query: {
      message: {
        async create({ args, query }) {
          const mensaje = await query(args);

          // Las seis llamadas pasan conversationId plano, pero se contempla la
          // forma con connect por si alguna se escribe asi mañana.
          const data = args.data as {
            conversationId?: string;
            conversation?: { connect?: { id?: string } };
          };
          const conversationId = data.conversationId ?? data.conversation?.connect?.id;

          if (conversationId) {
            try {
              // base y no el cliente extendido: la extension es sobre message,
              // asi que no hay recursion, pero usar el crudo lo deja explicito.
              await base.conversation.update({
                where: { id: conversationId },
                data: { updatedAt: new Date() },
              });
            } catch (err) {
              // Esto corre en el camino de la respuesta al cliente. Que no se
              // pueda actualizar la fecha no puede tumbar una respuesta: el
              // mensaje ya quedo guardado, que es lo que no se puede perder.
              console.error(
                `[prisma] no se pudo actualizar la fecha de la conversacion ${conversationId}:`,
                err instanceof Error ? err.message : err,
              );
            }
          }

          return mensaje;
        },
      },
    },
  });
}

type ClientePrisma = ReturnType<typeof crearCliente>;

const globalForPrisma = globalThis as unknown as { prisma?: ClientePrisma };

export const prisma = globalForPrisma.prisma ?? crearCliente();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
