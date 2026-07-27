/**
 * Envío proactivo de la encuesta. Corre por cron cada 10 minutos y busca
 * conversaciones que ya se enfriaron para preguntar sin interrumpir.
 *
 * Solo se puede empujar por WhatsApp/Meta: el widget web es request/response,
 * no tiene canal para iniciar un mensaje. Las conversaciones del widget quedan
 * fuera del envío proactivo.
 */
import { prisma } from '../lib/prisma';
import { conversationIsRipe, markAsked, npsQuestion, shouldAskNps } from './nps';
import { isMetaConfigured, sendTextMessage } from './metaMessaging';

/** Cuántas conversaciones se revisan por corrida, para acotar el trabajo */
const MAX_POR_CORRIDA = 100;
/** Solo conversaciones con actividad reciente: más viejas ya no valen la pena */
const VENTANA_HORAS = 24;

/**
 * Manda la encuesta a las conversaciones que corresponda.
 * Nunca lanza: un fallo individual se loguea y sigue con la siguiente.
 * Devuelve cuántas encuestas se enviaron.
 */
export async function dispatchNpsSurveys(): Promise<number> {
  let enviadas = 0;

  try {
    if (!isMetaConfigured()) {
      console.log('[nps] Meta no está configurada, se omite el envío de encuestas');
      return 0;
    }

    const desde = new Date(Date.now() - VENTANA_HORAS * 60 * 60 * 1000);

    // Solo bots con la encuesta activada: filtrar acá evita traer conversaciones
    // de bots que después van a ser descartados igual
    const conversaciones = await prisma.conversation.findMany({
      where: {
        channel: 'whatsapp',
        updatedAt: { gte: desde },
        bot: { npsEnabled: true, isActive: true, metaPhoneNumberId: { not: null } },
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_POR_CORRIDA,
      select: {
        id: true,
        botId: true,
        channelId: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { role: true, createdAt: true },
        },
      },
    });

    for (const conv of conversaciones) {
      try {
        // channelId viene como "whatsapp:+595..."; el clientId es el número
        const clientId = conv.channelId.replace('whatsapp:', '');

        // findMany trae los mensajes desc; se invierten para el orden real
        const mensajes = [...conv.messages].reverse();
        if (!conversationIsRipe(mensajes)) continue;

        // shouldAskNps revalida plan, npsEnabled y el cooldown de 30 días
        if (!(await shouldAskNps(conv.botId, clientId))) continue;

        await sendTextMessage(clientId, npsQuestion());
        // Se marca DESPUÉS de enviar: si el envío falla, se reintenta en la
        // próxima corrida en vez de quemar el cooldown de 30 días
        await markAsked(conv.botId, clientId);
        enviadas += 1;
        console.log(`[nps] Encuesta enviada al cliente de la conversación ${conv.id}`);
      } catch (err) {
        console.error(`[nps] Error enviando la encuesta de la conversación ${conv.id}:`, err);
      }
    }

    if (enviadas > 0) {
      console.log(`[nps] Encuestas enviadas en esta corrida: ${enviadas}/${conversaciones.length} revisadas`);
    }
  } catch (err) {
    // El cron nunca debe tumbar el proceso
    console.error('[nps] Error buscando conversaciones para encuestar:', err);
  }

  return enviadas;
}
