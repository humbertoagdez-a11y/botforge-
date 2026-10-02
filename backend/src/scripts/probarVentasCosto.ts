/**
 * Los siete escenarios que motivaron el recorte del bot de ventas.
 *
 *   BOT_VENTAS_ID=<id> npm run probar:ventas-costo
 *
 * Replica el camino real de WhatsApp: primero el limite (que vive en
 * inboundMessage, no en runTenantTurn) y despues el turno del agente. Llamar
 * solo a runTenantTurn no probaria el corte, que es justo lo que interesa.
 *
 * Cuesta plata y escribe conversaciones reales, que se borran al terminar.
 */
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { runTenantTurn } from '../services/tenantAgent';
import { evaluarLimiteDeVentas, MAX_MENSAJES_SIN_INTENCION } from '../services/limiteVentas';

const BOT_ID = process.env.BOT_VENTAS_ID;

/** Lo que gastaba la conversacion real que motivo todo esto */
const REAL = { turnos: 26, tokens: 58793 };

let fallas = 0;
function chequeo(que: string, ok: boolean, detalle = ''): void {
  console.log(`    ${ok ? 'OK   ' : 'FALLA'} ${que}${detalle ? `  — ${detalle}` : ''}`);
  if (!ok) fallas++;
}

interface Escenario {
  nombre: string;
  turnos: string[];
  /** Se corre sobre la conversacion que dejo el escenario anterior */
  continuaDe?: string;
  revisar: (r: Resultado) => void;
}

interface Resultado {
  respuestas: string[];
  tokens: number;
  cerrada: boolean;
  callados: number;
  conversationId: string;
}

const CASOS: Escenario[] = [
  {
    nombre: '1. Saludo suelto',
    turnos: ['Hola'],
    revisar: (r) => {
      const l = r.respuestas[0].split('\n').filter(Boolean).length;
      chequeo('contesta en 1 o 2 líneas', l <= 2, `${l} líneas, ${r.respuestas[0].length} chars`);
      chequeo('pregunta qué negocio tiene', /negocio|vend[eé]s|rubro|emprendimiento/i.test(r.respuestas[0]));
    },
  },
  {
    nombre: '2. Pregunta ajena',
    turnos: ['Qué día es hoy?', 'contame un chiste'],
    revisar: (r) => {
      const todo = r.respuestas.join(' ');
      chequeo('no sigue el tema', !/lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo/i.test(todo));
      chequeo('no cuenta el chiste', !/jaja.*porque|era un|se encuentra/i.test(todo));
      chequeo('aclara de qué atiende', /botforge/i.test(todo));
      const largo = Math.max(...r.respuestas.map((x) => x.split('\n').filter(Boolean).length));
      chequeo('responde corto', largo <= 2, `${largo} líneas como máximo`);
    },
  },
  {
    nombre: '3. Lo están probando',
    turnos: ['asdasd', 'jajaja', 'sos un robot?'],
    revisar: (r) => {
      chequeo('admite que es un asistente', /asistente|bot\b|autom[aá]tic/i.test(r.respuestas[2]));
      const largo = Math.max(...r.respuestas.map((x) => x.length));
      chequeo('no se extiende', largo < 320, `${largo} chars la más larga`);
    },
  },
  {
    nombre: `4. Se estira sin intención hasta el límite (N=${MAX_MENSAJES_SIN_INTENCION})`,
    turnos: ['¡Hola! Quiero más información.', 'Tengo libre', 'Que negocio', 'Nada', 'Aa ya', 'Gracias'],
    revisar: (r) => {
      chequeo('la cierra', r.cerrada);
      chequeo('el cierre trae el precio', /150[.,]?000/.test(r.respuestas.at(-1) ?? ''));
      chequeo('el cierre trae el link', /https?:\/\//.test(r.respuestas.at(-1) ?? ''));
      chequeo(
        'gastó mucho menos que la real',
        r.tokens < REAL.tokens / 2,
        `${r.tokens} vs ${REAL.tokens} de la real`,
      );
    },
  },
  {
    nombre: '5. Después del cierre insiste sin intención',
    continuaDe: '4',
    turnos: ['Chau', 'De que podemos ablar otra cosa'],
    revisar: (r) => {
      chequeo('no contesta nada', r.callados === 2, `${r.callados} de 2 callados`);
      chequeo('no gastó tokens', r.tokens === 0, `${r.tokens} tokens`);
    },
  },
  {
    nombre: '6. Después del cierre escribe con intención real',
    continuaDe: '4',
    turnos: ['Che, cuanto sale el plan basico?'],
    revisar: (r) => {
      chequeo('se reactiva y contesta', r.callados === 0);
      chequeo('da el precio', /150[.,]?000/.test(r.respuestas.join(' ')));
    },
  },
  {
    nombre: '7. Prospecto real: pregunta precio y quiere arrancar',
    turnos: [
      'Hola, tengo una rotisería en Lambaré. Cuánto sale?',
      'Me interesa, quiero arrancar. Soy Ana Duarte, 0981 334 556',
    ],
    revisar: (r) => {
      chequeo('da el precio', /150[.,]?000/.test(r.respuestas.join(' ')));
      chequeo('no la cierra', !r.cerrada);
    },
  },
];

async function correr(
  bot: Awaited<ReturnType<typeof prisma.bot.findUniqueOrThrow>>,
  conversationId: string,
  turnos: string[],
): Promise<Resultado> {
  const historia: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  // El historial real de la conversacion, por si continua de otro escenario
  for (const m of await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  })) {
    historia.push({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content });
  }

  const respuestas: string[] = [];
  let tokens = 0;
  let callados = 0;

  for (const texto of turnos) {
    console.log(`  CLIENTE: ${texto}`);
    await prisma.message.create({
      data: { id: randomUUID(), conversationId, role: 'USER', content: texto },
    });

    // Igual que inboundMessage: primero el limite
    const limite = await evaluarLimiteDeVentas(bot.id, conversationId, texto);
    if (limite.callar) {
      console.log('  BOT:     (no contesta — cerrada)');
      callados++;
      historia.push({ role: 'user', content: texto });
      continue;
    }
    if (limite.cierre) {
      console.log(`  BOT:     ${limite.cierre}`);
      respuestas.push(limite.cierre);
      await prisma.message.create({
        data: { id: randomUUID(), conversationId, role: 'ASSISTANT', content: limite.cierre },
      });
      historia.push({ role: 'user', content: texto });
      historia.push({ role: 'assistant', content: limite.cierre });
      continue;
    }

    const r = await runTenantTurn({
      bot,
      history: [...historia],
      message: texto,
      clientId: '+595981000444',
      channel: 'whatsapp',
      conversationId,
    });
    console.log(`  BOT:     ${r.content.replace(/\n/g, '\n           ')}`);
    respuestas.push(r.content);
    tokens += r.tokensUsed;
    await prisma.message.create({
      data: { id: randomUUID(), conversationId, role: 'ASSISTANT', content: r.content, tokensUsed: r.tokensUsed },
    });
    historia.push({ role: 'user', content: texto });
    historia.push({ role: 'assistant', content: r.content });
  }

  const c = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { cerradaPorLimiteEn: true },
  });
  return { respuestas, tokens, cerrada: c.cerradaPorLimiteEn !== null, callados, conversationId };
}

async function main(): Promise<void> {
  if (!BOT_ID || env.BOT_VENTAS_ID !== BOT_ID) {
    console.error('Falta BOT_VENTAS_ID en el entorno del proceso (env.BOT_VENTAS_ID debe coincidir).');
    process.exit(1);
  }
  const bot = await prisma.bot.findUniqueOrThrow({ where: { id: BOT_ID } });
  console.log(`bot: "${bot.name}" · N=${MAX_MENSAJES_SIN_INTENCION}\n`);

  const creadas: string[] = [];
  const porEscenario = new Map<string, string>();
  let tokensTotales = 0;
  let turnosTotales = 0;

  try {
    for (const caso of CASOS) {
      console.log(`${'='.repeat(78)}\n${caso.nombre}`);
      let convId = caso.continuaDe ? porEscenario.get(caso.continuaDe) : undefined;
      if (!convId) {
        const conv = await prisma.conversation.create({
          data: {
            id: randomUUID(),
            botId: bot.id,
            channel: 'whatsapp',
            channelId: `whatsapp:+595${Math.floor(900000000 + Math.random() * 99999999)}`,
          },
        });
        convId = conv.id;
        creadas.push(convId);
      }
      porEscenario.set(caso.nombre[0], convId);

      const r = await correr(bot, convId, caso.turnos);
      caso.revisar(r);
      tokensTotales += r.tokens;
      turnosTotales += caso.turnos.length;
      console.log(`    (${r.tokens} tokens)\n`);
    }

    console.log('#'.repeat(78));
    console.log('COSTO: LOS SIETE ESCENARIOS vs LA CONVERSACION REAL');
    console.log('#'.repeat(78));
    console.log(`  la real, sola:     ${REAL.turnos} turnos · ${REAL.tokens} tokens · USD ${((REAL.tokens * 3) / 1e6).toFixed(3)}`);
    console.log(`  los 7 escenarios:  ${turnosTotales} turnos · ${tokensTotales} tokens · USD ${((tokensTotales * 3) / 1e6).toFixed(3)}`);
    console.log(`  o sea: ${turnosTotales} turnos ahora cuestan ${((tokensTotales / REAL.tokens) * 100).toFixed(0)}% de lo que costaban 26`);
  } finally {
    for (const id of creadas) {
      await prisma.message.deleteMany({ where: { conversationId: id } });
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
