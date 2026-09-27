/**
 * Los dos casos que atiende la línea de avisos.
 *
 *   BOT_AVISOS_ID=<id> npm run probar:avisos
 *
 * Verifica lo único que esta línea tiene que hacer bien: distinguir a un dueño
 * registrado de cualquier otra persona, y no vender en ninguno de los dos
 * casos. El número del dueño se toma de un bot real que tenga `avisoCelular`
 * cargado, porque es contra ese campo que el bot lo reconoce.
 *
 * Cuesta plata (Claude) y escribe conversaciones reales, que se borran al
 * terminar. Se corre a mano.
 */
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { runTenantTurn } from '../services/tenantAgent';

const BOT_ID = process.env.BOT_AVISOS_ID;

/** La línea comercial a la que hay que derivar. Igual que en el instructivo. */
const NUMERO_VENTAS = /992\s?199\s?207/;
const LINK_VENTAS = /wa\.me\/595992199207/;

let fallas = 0;
function chequeo(que: string, ok: boolean, detalle = ''): void {
  console.log(`    ${ok ? 'OK   ' : 'FALLA'} ${que}${detalle ? `  — ${detalle}` : ''}`);
  if (!ok) fallas++;
}

async function conversar(
  bot: Awaited<ReturnType<typeof prisma.bot.findUniqueOrThrow>>,
  numero: string,
  turnos: string[],
): Promise<{ texto: string; conversationId: string }> {
  // El channelId lleva un sufijo de prueba y el numero real va como clientId.
  //
  // Dos motivos. Conversation tiene unico (botId, channelId), y el dueño ya
  // tiene una conversacion real con esta linea: crear otra con el mismo
  // channelId falla, y reutilizar la suya significaria ensuciarla con
  // mensajes de prueba y borrarla al terminar. Y lo que se prueba es el
  // reconocimiento, que sale de clientId y no del channelId — asi que el
  // numero real viaja igual por donde importa.
  const conv = await prisma.conversation.create({
    data: {
      id: randomUUID(),
      botId: bot.id,
      channel: 'whatsapp',
      channelId: `whatsapp:${numero}-prueba-${randomUUID().slice(0, 8)}`,
    },
  });

  const historia: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const respuestas: string[] = [];

  for (const texto of turnos) {
    console.log(`  CLIENTE (${numero}): ${texto}`);
    const r = await runTenantTurn({
      bot,
      history: [...historia],
      message: texto,
      clientId: numero,
      channel: 'whatsapp',
      conversationId: conv.id,
    });
    console.log(`  BOT: ${r.content.replace(/\n/g, '\n       ')}`);
    historia.push({ role: 'user', content: texto });
    historia.push({ role: 'assistant', content: r.content });
    respuestas.push(r.content);
  }

  return { texto: respuestas.join('\n'), conversationId: conv.id };
}

async function main(): Promise<void> {
  if (!BOT_ID) {
    console.error('Falta BOT_AVISOS_ID. Ejemplo:');
    console.error('  BOT_AVISOS_ID=dbab8033-... npm run probar:avisos');
    process.exit(1);
  }
  if (env.BOT_AVISOS_ID !== BOT_ID) {
    console.error(
      `BOT_AVISOS_ID no está en la configuración del proceso (env.BOT_AVISOS_ID="${env.BOT_AVISOS_ID}").\n` +
        'Sin eso el bot no reconoce a nadie ni pierde marcar_lead, y la prueba no valdría.',
    );
    process.exit(1);
  }

  const bot = await prisma.bot.findUniqueOrThrow({ where: { id: BOT_ID } });
  console.log(`línea de avisos: "${bot.name}" (${bot.id})\n`);

  // Un dueño de verdad: el número que está cargado como avisoCelular
  const conAviso = await prisma.bot.findFirst({
    where: { avisoCelular: { not: null } },
    select: { avisoCelular: true, name: true },
  });
  if (!conAviso?.avisoCelular) {
    console.error('Ningún bot tiene avisoCelular cargado: no hay dueño registrado contra quién probar.');
    process.exit(1);
  }
  const numeroDuenio = conAviso.avisoCelular;
  const numeroDesconocido = '+595971000999';
  console.log(`dueño registrado: ${numeroDuenio} (por el bot "${conAviso.name}")`);
  console.log(`desconocido:      ${numeroDesconocido}\n`);

  const creadas: string[] = [];

  try {
    console.log('='.repeat(78));
    console.log('CASO 1 — escribe un dueño registrado');
    const duenio = await conversar(bot, numeroDuenio, [
      'Hola, me llegó un aviso de un pedido. Dónde lo veo?',
    ]);
    creadas.push(duenio.conversationId);
    chequeo('lo manda al panel', /panel|dashboard/i.test(duenio.texto));
    chequeo('le da el link', /https?:\/\/\S+/.test(duenio.texto), (duenio.texto.match(/https?:\/\/\S+/) ?? ['ninguno'])[0]);
    chequeo('NO lo deriva a ventas como si fuera un desconocido', !LINK_VENTAS.test(duenio.texto));
    chequeo(
      'no le explica qué es BotForge ni le ofrece planes',
      !/\bplan (b[aá]sico|profesional|agencia)\b/i.test(duenio.texto),
    );

    console.log();
    console.log('='.repeat(78));
    console.log('CASO 2 — escribe alguien no registrado');
    const otro = await conversar(bot, numeroDesconocido, [
      'Hola, vi que tienen bots para WhatsApp. Cuánto sale?',
    ]);
    creadas.push(otro.conversationId);
    chequeo('pasa el número de ventas', NUMERO_VENTAS.test(otro.texto));
    chequeo('pasa el link de wa.me', LINK_VENTAS.test(otro.texto), (otro.texto.match(/wa\.me\/\S+/) ?? ['ninguno'])[0]);
    chequeo('NO le da precios', !/\b150[.,]?000|350[.,]?000|750[.,]?000\b/.test(otro.texto));

    console.log();
    console.log('='.repeat(78));
    console.log('EN NINGUNO DE LOS DOS CASOS');
    for (const id of creadas) {
      const c = await prisma.conversation.findUniqueOrThrow({
        where: { id },
        select: { leadAvisadoEn: true, channelId: true },
      });
      chequeo(
        `no marca lead (${c.channelId})`,
        c.leadAvisadoEn === null,
        `leadAvisadoEn=${c.leadAvisadoEn?.toISOString() ?? 'null'}`,
      );
    }
  } finally {
    for (const id of creadas) {
      await prisma.pedidoAviso.deleteMany({ where: { conversationId: id } });
      await prisma.conversation.delete({ where: { id } });
    }
    console.log(`\n${creadas.length} conversaciones de prueba borradas`);
  }

  await prisma.$disconnect();
  console.log(fallas === 0 ? '\nTODO OK' : `\n${fallas} FALLAS`);
  process.exit(fallas === 0 ? 0 : 1);
}

void main();
