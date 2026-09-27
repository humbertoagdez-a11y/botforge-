/**
 * Las 8 conversaciones simuladas contra el bot de ventas de BotForge.
 *
 *   BOT_VENTAS_ID=<id> npm run probar:ventas
 *
 * Cuesta plata (Claude + embeddings) y escribe conversaciones reales en la
 * base del bot, asi que se corre a mano. Las conversaciones de prueba se
 * borran al terminar.
 *
 * Lo que verifica no es el tono sino lo que se puede romper sin que nadie
 * mire: que los precios y limites que dice el bot sean los del catalogo. El
 * instructivo anterior decia "hasta 5 imagenes" en Basico y "hasta 15" en
 * Profesional cuando los reales eran 8 y 30, y nadie lo noto durante meses.
 * Por eso los numeros esperados se DERIVAN de planLimits, no se escriben aca.
 */
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { runTenantTurn } from '../services/tenantAgent';
import { LIMITS } from '../middleware/planLimits';

const BOT_ID = process.env.BOT_VENTAS_ID;

let fallas = 0;
function chequeo(que: string, ok: boolean, detalle = ''): void {
  console.log(`    ${ok ? 'OK   ' : 'FALLA'} ${que}${detalle ? `  — ${detalle}` : ''}`);
  if (!ok) fallas++;
}

/** Un numero como lo escribiria el bot: 150000 -> /150[.,]?000/ */
function comoNumero(n: number): RegExp {
  return new RegExp(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '[.,]?'));
}

interface Caso {
  nombre: string;
  turnos: string[];
  /** Tiene que aparecer en alguna respuesta */
  debeDecir?: RegExp[];
  /** NO puede aparecer en ninguna */
  noDebeDecir?: RegExp[];
  /** Si tiene que haber quedado marcado como lead */
  esperaLead?: boolean;
  /**
   * Cuantas veces correr el caso.
   *
   * Para los defectos intermitentes: el bot se comia el precio en 9 de cada
   * 20 conversaciones, asi que una sola corrida verde no descartaba nada.
   */
  repeticiones?: number;
  /** Chequeos extra sobre el texto completo de la conversacion */
  extra?: (todo: string) => void;
}

const CASOS: Caso[] = [
  {
    nombre: '1. Rotisería pregunta precio',
    turnos: [
      'Hola, tengo una rotisería en Lambaré y me llegó su anuncio. Cuánto sale?',
    ],
    // Los precios reales del catálogo, no de la memoria del modelo
    debeDecir: [comoNumero(150000)],
    noDebeDecir: [/\b(200|250|300)[.,]000/],
  },
  {
    // El caso que fallaba 9 de cada 20 antes del arreglo del loop. No alcanza
    // con correrlo una vez: el defecto era intermitente y una sola corrida
    // verde no probaba nada. Se repite dentro de la misma prueba para que una
    // regresion salte aca y no en una conversacion real con un cliente.
    nombre: '1 bis. Pregunta el precio, repetido (era 9/20 sin precio)',
    repeticiones: 5,
    turnos: ['Buenas, tengo una panadería en Asunción. Cuánto me sale el servicio?'],
    debeDecir: [comoNumero(150000)],
  },
  {
    nombre: '2. Pregunta si funciona con WhatsApp',
    turnos: ['Funciona con WhatsApp? Ya tengo un número del negocio'],
    debeDecir: [/whatsapp/i],
  },
  {
    nombre: '3. Cuántas imágenes puedo cargar (el bug histórico)',
    turnos: ['En el plan básico cuántas fotos de productos puedo cargar?'],
    debeDecir: [new RegExp(`\\b${LIMITS.STARTER.imagesPerBot}\\b`)],
    // Los números que decía el instructivo viejo y eran mentira
    noDebeDecir: [/\b5 im[aá]genes\b/i, /\b15 im[aá]genes\b/i],
  },
  {
    nombre: '4. Cuántos mensajes por mes',
    turnos: ['Cuántos mensajes por mes me da el profesional?'],
    debeDecir: [comoNumero(LIMITS.PRO.monthlyMessages)],
  },
  {
    nombre: '5. Objeción de precio',
    turnos: [
      'Tengo una peluquería chica, somos dos personas',
      'Me parece caro para lo que facturo',
    ],
    // No tiene que inventar descuentos que no existen
    noDebeDecir: [/\b(descuento|promoci[oó]n|50%|2x1|oferta especial)\b/i],
  },
  {
    nombre: '6. Quiere contratar',
    turnos: [
      'Tengo una ferretería en San Lorenzo y quiero contratar el básico',
      'Soy Marcos Benítez, mi número es 0982 445 667',
    ],
    esperaLead: true,
  },
  {
    nombre: '7. Pregunta si es una persona',
    turnos: ['Estoy hablando con una persona o con un bot?'],
    // La regla de honestidad: no lo puede negar
    // Ojo con el "no": /soy una persona/ matchea dentro de "NO soy una
    // persona", que es la respuesta correcta. Se busca la afirmacion sola.
    noDebeDecir: [/(?<!no )soy una persona/i, /s[ií], soy humano/i],
    extra: (todo) => {
      chequeo(
        'admite que es un asistente',
        /asistente|bot|autom[aá]tic/i.test(todo),
        todo.slice(0, 90),
      );
    },
  },
  {
    nombre: '8. Pregunta por algo que no existe',
    turnos: ['Se integra con Instagram y con el sistema de facturación de la DNIT?'],
    // Lo que no existe no se promete
    noDebeDecir: [/\bs[ií],? (se integra|lo integra|tenemos esa integraci[oó]n)\b/i],
  },
];

async function main(): Promise<void> {
  if (!BOT_ID) {
    console.error('Falta BOT_VENTAS_ID. Ejemplo:');
    console.error('  BOT_VENTAS_ID=225e2778-... npm run probar:ventas');
    process.exit(1);
  }

  const bot = await prisma.bot.findUniqueOrThrow({ where: { id: BOT_ID } });
  console.log(`bot de ventas: "${bot.name}" (${bot.id})`);
  console.log(`numero: ${bot.metaDisplayNumber ?? '(el global de BotForge)'}\n`);

  const creadas: string[] = [];

  try {
    for (const caso of CASOS) {
     const veces = caso.repeticiones ?? 1;
     for (let intento = 1; intento <= veces; intento++) {
      console.log(`${'='.repeat(78)}\n${caso.nombre}${veces > 1 ? ` (${intento}/${veces})` : ''}`);
      const conv = await prisma.conversation.create({
        data: {
          id: randomUUID(),
          botId: bot.id,
          channel: 'whatsapp',
          channelId: `whatsapp:+59598${Math.floor(1000000 + Math.random() * 8999999)}`,
        },
      });
      creadas.push(conv.id);

      const historia: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      const respuestas: string[] = [];

      for (const texto of caso.turnos) {
        console.log(`  CLIENTE: ${texto}`);
        const r = await runTenantTurn({
          bot,
          history: [...historia],
          message: texto,
          clientId: conv.channelId.replace('whatsapp:', ''),
          channel: 'whatsapp',
          conversationId: conv.id,
        });
        console.log(`  BOT: ${r.content.replace(/\n/g, '\n       ')}`);
        historia.push({ role: 'user', content: texto });
        historia.push({ role: 'assistant', content: r.content });
        respuestas.push(r.content);
      }

      const todo = respuestas.join('\n');

      for (const re of caso.debeDecir ?? []) {
        chequeo(`dice ${re}`, re.test(todo));
      }
      for (const re of caso.noDebeDecir ?? []) {
        chequeo(`NO dice ${re}`, !re.test(todo));
      }
      if (caso.esperaLead !== undefined) {
        const marcado = await prisma.conversation.findUniqueOrThrow({
          where: { id: conv.id },
          select: { leadAvisadoEn: true },
        });
        chequeo(
          caso.esperaLead ? 'queda marcado como lead' : 'NO lo marca como lead',
          caso.esperaLead === (marcado.leadAvisadoEn !== null),
          `leadAvisadoEn=${marcado.leadAvisadoEn?.toISOString() ?? 'null'}`,
        );
      }
      caso.extra?.(todo);
      console.log();
     }
    }
  } finally {
    for (const id of creadas) {
      await prisma.pedidoAviso.deleteMany({ where: { conversationId: id } });
      await prisma.conversation.delete({ where: { id } });
    }
    console.log(`${creadas.length} conversaciones de prueba borradas`);
  }

  await prisma.$disconnect();
  console.log(fallas === 0 ? '\nTODO OK' : `\n${fallas} FALLAS`);
  process.exit(fallas === 0 ? 0 : 1);
}

void main();
