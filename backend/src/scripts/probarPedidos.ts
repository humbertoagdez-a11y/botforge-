/**
 * Prueba de extremo a extremo de `avisar_pedido` sobre RAG real.
 *
 * Se corre con `npm run probar:pedidos`. NO es parte del build ni del deploy:
 * crea un bot descartable, le carga un instructivo por el mismo camino que el
 * job de Bull, conversa contra la API de Anthropic y borra todo al final.
 * Cuesta plata (embeddings, Pinecone, Claude), así que se corre a mano.
 *
 * Por qué existe: la primera versión de esta prueba insertaba el chunk a mano
 * con un `pineconeId` inventado, así que Pinecone no devolvía nada y el bot
 * contestaba "no tengo el dato". Eso verificaba la DECISIÓN de llamar a la
 * herramienta, pero no que el bot conteste con los precios del instructivo —
 * que es justo lo que promete el anuncio.
 *
 * Bull no interviene: es transporte y no toca el contenido. Las funciones que
 * procesan el documento son exactamente las que corre el job.
 */
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { extractAndChunk } from '../services/documentProcessor';
import { getEmbedding } from '../services/embeddings';
import { upsertChunks, deleteChunksByIds, querySimilarChunks, type ChunkVector } from '../services/pinecone';
import { runTenantTurn } from '../services/tenantAgent';

/** Bots reales que la prueba nunca puede tocar. Se verifican al final. */
const PROTEGIDOS = [
  'dbab8033-ddee-466d-ba42-810e5aff1c2c',
  '225e2778-aeed-491e-85a1-0564a810b837',
];

/** Cuenta bajo la que se crea el bot descartable. */
const CUENTA_PRUEBA = process.env.CUENTA_PRUEBA ?? 'meta-review@mibotforge.com';

let fallas = 0;
function chequeo(que: string, ok: boolean, detalle = ''): void {
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${que}${detalle ? `  — ${detalle}` : ''}`);
  if (!ok) fallas++;
}

const INSTRUCTIVO = `INSTRUCTIVO — ROTISERIA DOÑA ELBA

HORARIO
Todos los dias de 11:00 a 23:30. El ultimo pedido se toma 23:00.

MENU Y PRECIOS
Milanesa completa: Gs. 45.000. Viene con papas fritas, huevo frito y ensalada mixta.
Milanesa sola: Gs. 32.000.
Empanada de carne: Gs. 8.000 la unidad.
Empanada de pollo: Gs. 8.000 la unidad.
Pollo al horno entero: Gs. 75.000. Viene con papas al horno.
Medio pollo al horno: Gs. 40.000.
Tallarin con estofado: Gs. 38.000.
Gaseosa 1,5 litros: Gs. 12.000.
Gaseosa 2,25 litros: Gs. 16.000.

DELIVERY
Lambare: Gs. 15.000.
Fernando de la Mora: Gs. 15.000.
San Lorenzo: Gs. 20.000.
Asuncion centro: Gs. 18.000.
Pedido minimo para delivery: Gs. 40.000.
Demora estimada: de 35 a 50 minutos.

FORMAS DE PAGO
Efectivo, transferencia bancaria y tarjeta de debito o credito al momento de entregar.

COMO TOMAR UN PEDIDO
Cuando el cliente dice que quiere algo, confirmale que se lo anotas y preguntale la
direccion si todavia no la dio. No inventes promociones ni descuentos que no figuren aca.`;

interface Turno {
  nombre: string;
  texto: string;
  esperaPedido: boolean;
  /** Datos que TIENEN que salir del instructivo, no de la imaginación del modelo */
  debeDecir: RegExp[];
}

const TURNOS: Turno[] = [
  {
    nombre: 'consulta de precio',
    texto: 'Hola! Cuanto sale la milanesa completa? Hacen delivery a Lambare?',
    esperaPedido: false,
    debeDecir: [/45[.,]?000/, /15[.,]?000/],
  },
  {
    nombre: 'confirma el pedido',
    texto: 'Perfecto, mandame dos milanesas completas y una gaseosa de 2,25 a Cerro Cora 1234, Lambare',
    esperaPedido: true,
    // El TOTAL, no un precio suelto: 2x45.000 + 16.000 + 15.000 = 121.000. Que
    // le dé bien obliga a que los tres precios hayan salido del instructivo.
    // Buscar "16.000" sería más débil, porque "2,25" lo dijo el cliente y el
    // modelo puede repetirlo sin haber leído nada.
    debeDecir: [/121[.,]?000/],
  },
];

async function main(): Promise<void> {
  const duenio = await prisma.user.findUniqueOrThrow({
    where: { email: CUENTA_PRUEBA },
    select: { id: true },
  });

  let botId: string | null = null;
  const pineconeIds: string[] = [];

  try {
    const bot = await prisma.bot.create({
      data: {
        id: randomUUID(),
        userId: duenio.id,
        name: 'TMP Rotiseria RAG',
        language: 'es',
        personality:
          'Elba, de la Rotiseria Doña Elba. Atendes pedidos por WhatsApp. Rapida y calida, ' +
          'contestas en dos lineas con el precio concreto y cerras preguntando si le tomas el pedido.',
      },
    });
    botId = bot.id;
    console.log(`bot descartable: ${bot.id}`);

    // ─── El documento, por el mismo camino que el job ───────────────────────
    const buffer = Buffer.from(INSTRUCTIVO, 'utf8');
    const doc = await prisma.document.create({
      data: {
        id: randomUUID(),
        botId: bot.id,
        name: 'instructivo.txt',
        mimeType: 'text/plain',
        filePath: 'n/a',
        fileSize: buffer.length,
        status: 'PROCESSING',
      },
    });

    console.log('\nprocesando el documento como lo hace el job...');
    const textChunks = await extractAndChunk(buffer, 'text/plain');
    console.log(`  chunks: ${textChunks.length}`);

    const vectores: ChunkVector[] = [];
    for (const chunk of textChunks) {
      const chunkId = randomUUID();
      const embedding = await getEmbedding(chunk.content);
      if (vectores.length === 0) console.log(`  dimensión del embedding: ${embedding.length}`);
      await prisma.chunk.create({
        data: {
          id: chunkId,
          documentId: doc.id,
          botId: bot.id,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          chunkIndex: chunk.chunkIndex,
          pineconeId: chunkId,
        },
      });
      vectores.push({
        id: chunkId,
        values: embedding,
        metadata: {
          botId: bot.id,
          documentId: doc.id,
          chunkId,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
        },
      });
      pineconeIds.push(chunkId);
    }
    await upsertChunks(vectores);
    await prisma.document.update({ where: { id: doc.id }, data: { status: 'READY' } });
    console.log(`  subidos a Pinecone: ${vectores.length}`);

    // Pinecone es eventualmente consistente. Sin esperar, la primera consulta
    // puede volver vacía y la prueba le echaría al bot la culpa del índice.
    console.log('\nesperando a que Pinecone indexe...');
    let visibles = 0;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const m = await querySimilarChunks(await getEmbedding('cuanto sale la milanesa'), bot.id, 5);
      visibles = m.length;
      if (visibles > 0) {
        console.log(`  indexado tras ${((i + 1) * 1.5).toFixed(1)}s`);
        break;
      }
    }
    chequeo('los vectores quedan consultables en Pinecone', visibles > 0, `${visibles} coincidencias`);

    // ─── La conversación ────────────────────────────────────────────────────
    const conv = await prisma.conversation.create({
      data: {
        id: randomUUID(),
        botId: bot.id,
        channelId: 'whatsapp:+595981777000',
        channel: 'whatsapp',
      },
    });
    const historia: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const t of TURNOS) {
      console.log(`\n${'-'.repeat(72)}\nCLIENTE: ${t.texto}`);
      const r = await runTenantTurn({
        bot,
        history: [...historia],
        message: t.texto,
        clientId: '+595981777000',
        channel: 'whatsapp',
        conversationId: conv.id,
      });
      console.log(`BOT: ${r.content}`);
      historia.push({ role: 'user', content: t.texto });
      historia.push({ role: 'assistant', content: r.content });

      const faltan = t.debeDecir.filter((re) => !re.test(r.content));
      chequeo(
        `${t.nombre}: contesta con los datos del instructivo`,
        faltan.length === 0,
        faltan.length ? `no aparece ${faltan.map(String).join(', ')}` : '',
      );
      chequeo(
        `${t.nombre}: no inventa promociones`,
        !/promo|descuento|2x1|oferta especial/i.test(r.content),
      );

      const pedidos = await prisma.pedidoAviso.findMany({ where: { conversationId: conv.id } });
      if (t.esperaPedido) {
        chequeo(`${t.nombre}: dispara UN aviso`, pedidos.length === 1, `${pedidos.length} avisos`);
        const p = pedidos[0];
        if (p) {
          console.log(`      tipo: ${p.tipo} · canal: ${p.canal ?? 'no salió'}`);
          console.log(`      resumen: ${p.resumen}`);
          chequeo(`${t.nombre}: el resumen dice qué pidió`, /milanesa/i.test(p.resumen), p.resumen);
        }
      } else {
        chequeo(`${t.nombre}: NO avisa`, pedidos.length === 0, `${pedidos.length} avisos`);
      }
    }

    console.log(`\n${'='.repeat(72)}\nLOS BOTS REALES`);
    for (const id of PROTEGIDOS) {
      const b = await prisma.bot.findUniqueOrThrow({
        where: { id },
        select: { name: true, isActive: true, metaEstado: true },
      });
      chequeo(`${b.name} intacto`, b.isActive && b.metaEstado !== 'REVOCADO');
    }
  } finally {
    if (botId) {
      if (pineconeIds.length > 0) await deleteChunksByIds(pineconeIds);
      await prisma.pedidoAviso.deleteMany({ where: { botId } });
      await prisma.chunk.deleteMany({ where: { botId } });
      await prisma.bot.delete({ where: { id: botId } });
      console.log(`\nborrado: bot, ${pineconeIds.length} vectores de Pinecone y lo que colgaba`);

      // Que el borrado haya sido de verdad, no solo la llamada
      await new Promise((r) => setTimeout(r, 4000));
      const quedan = await querySimilarChunks(await getEmbedding('milanesa completa'), botId, 5);
      chequeo('no quedan vectores del bot en Pinecone', quedan.length === 0, `${quedan.length} quedan`);
    }
  }

  await prisma.$disconnect();
  console.log(fallas === 0 ? '\nTODO OK' : `\n${fallas} FALLAS`);
  process.exit(fallas === 0 ? 0 : 1);
}

void main();
