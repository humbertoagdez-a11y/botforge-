import { v4 as uuidv4 } from 'uuid';
import type { Conversation } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Devuelve la conversacion de ESE bot, creandola si no hay una valida.
 *
 * El guard de pertenencia es el motivo de existir de esta funcion. El
 * conversationId lo elige el cliente, asi que sin comprobar a que bot
 * pertenece cualquiera podia continuar la conversacion de otro negocio: leer
 * su historial —que entra como contexto del modelo— y escribirle mensajes que
 * el dueño despues ve en su panel.
 *
 * El chat del panel lo verificaba; el widget publico, que ademas no pide
 * autenticacion, no. Eran dos copias de la misma logica y una se quedo atras.
 * Por eso ahora hay una sola, y los tres canales entran por aca.
 */
export async function resolverConversacion(params: {
  botId: string;
  /** 'web' (panel), 'widget' (sitio del cliente) */
  canal: string;
  /** Solo se usa si hay que crear una conversacion nueva */
  nuevoChannelId: () => string;
  /** Lo manda el cliente: puede ser de otro bot, o no existir */
  conversationId?: string;
}): Promise<Conversation> {
  const { botId, canal, nuevoChannelId, conversationId } = params;

  const existente = conversationId
    ? await prisma.conversation.findUnique({ where: { id: conversationId } })
    : null;

  if (existente && existente.botId === botId) return existente;

  return prisma.conversation.create({
    data: { id: uuidv4(), botId, channelId: nuevoChannelId(), channel: canal },
  });
}
