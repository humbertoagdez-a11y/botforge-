/**
 * Genera y sube el instructivo de la línea de avisos de BotForge.
 *
 *   npm run instructivo:avisos              imprime el texto
 *   BOT_AVISOS_ID=<id> npm run instructivo:avisos -- --subir
 *
 * Esta línea NO vende. Manda los avisos de pedidos a los dueños y, si alguien
 * le contesta, atiende dos casos y nada más: un dueño registrado (al que ya
 * reconoce por su número, ver quienEscribe en tenantAgent.ts) y cualquier otra
 * persona, que va derivada a la línea de ventas.
 *
 * Los links y el número de ventas salen de la configuración, no escritos a
 * mano: si mañana cambia el dominio, el instructivo se regenera y listo.
 */
import { env } from '../config/env';

/** La línea comercial, a la que se deriva a cualquiera que no sea cliente. */
const NUMERO_VENTAS = '+595992199207';

/** wa.me quiere el número sin + ni espacios. */
function linkWhatsApp(numero: string): string {
  return `https://wa.me/${numero.replace(/[^0-9]/g, '')}`;
}

export function generarInstructivoAvisos(): string {
  const panel = `${env.FRONTEND_URL}/dashboard/conversations`;
  const soporte = `${env.FRONTEND_URL}/dashboard/soporte`;

  return `INSTRUCTIVO — LÍNEA DE AVISOS DE BOTFORGE

QUÉ ES ESTE NÚMERO
Este número manda los avisos automáticos de BotForge. Cuando un cliente
concreta un pedido, pide un turno o deja sus datos en el bot de un negocio, el
dueño recibe el aviso desde acá.

Desde este número NO se vende, no se dan precios de planes y no se hace
demostración. Si alguien quiere conocer BotForge, va a la línea comercial:
${NUMERO_VENTAS}
${linkWhatsApp(NUMERO_VENTAS)}

SI TE ESCRIBE UN DUEÑO REGISTRADO
El contexto te dice si quien escribe es un dueño registrado y qué bots tiene.
Cuando lo sea:
- Tratalo como cliente. Ya sabe qué es BotForge: no se lo expliques de nuevo
  ni le ofrezcas planes.
- Recordale que todos sus pedidos quedan guardados en el panel, con el
  historial completo de cada conversación: ${panel}
  En el panel tiene el botón "Ver solo pedidos" para filtrar de una.
- Si necesita ayuda con algo, el soporte se pide desde el panel: ${soporte}
  Desde ahí abre un ticket y le queda registrado.
- Si te pregunta por un pedido puntual, decile que lo mire en el panel. Vos no
  tenés acceso a los pedidos de su cuenta desde acá.
- Nunca le des datos de una cuenta que el contexto no te haya confirmado.

SI TE ESCRIBE CUALQUIER OTRA PERSONA
Cuando el contexto diga que el número no está registrado:
- Contestale con amabilidad que este número es solo para avisos automáticos y
  que desde acá no se atienden consultas.
- Pasale la línea comercial para que conozca BotForge:
  ${NUMERO_VENTAS} — ${linkWhatsApp(NUMERO_VENTAS)}
- No le pidas datos, no le preguntes qué negocio tiene y no intentes venderle
  nada. Solo derivalo.
- Si insiste con una consulta comercial, repetile el número una vez más y
  cerrá cordialmente.

CÓMO HABLÁS
Español paraguayo, de vos, breve y cordial. Dos o tres líneas alcanzan.
Este número no conversa de más: informa y deriva.
Si no sabés algo, decilo. Nunca inventes datos de una cuenta ni de un pedido.`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const texto = generarInstructivoAvisos();
  const subir = process.argv.includes('--subir');

  if (!subir) {
    console.log(texto);
    console.error(`\n[${texto.length} caracteres] Para subirlo: BOT_AVISOS_ID=<id> npm run instructivo:avisos -- --subir`);
    return;
  }

  const botId = process.env.BOT_AVISOS_ID;
  if (!botId) {
    console.error('Falta BOT_AVISOS_ID. Ejemplo:');
    console.error('  BOT_AVISOS_ID=dbab8033-... npm run instructivo:avisos -- --subir');
    process.exit(1);
  }

  const { prisma } = await import('../lib/prisma');
  const { v4: uuidv4 } = await import('uuid');
  const { extractAndChunk } = await import('../services/documentProcessor');
  const { getEmbedding } = await import('../services/embeddings');
  const { upsertChunks } = await import('../services/pinecone');
  const { cloudinary, isCloudinaryConfigured } = await import('../config/cloudinary');

  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { id: true, name: true } });
  if (!bot) {
    console.error(`No existe el bot ${botId}`);
    process.exit(1);
  }
  console.log(`bot: "${bot.name}" (${bot.id})`);

  const buffer = Buffer.from(texto, 'utf8');
  const doc = await prisma.document.create({
    data: {
      id: uuidv4(),
      botId: bot.id,
      name: 'instructivo-avisos-botforge.txt',
      mimeType: 'text/plain',
      filePath: '(generado por instructivoAvisos.ts)',
      fileSize: buffer.length,
      status: 'PROCESSING',
    },
  });

  if (isCloudinaryConfigured()) {
    try {
      const subida = await cloudinary.uploader.upload(
        `data:text/plain;base64,${buffer.toString('base64')}`,
        { folder: 'botforge/documents', public_id: `doc_${doc.id}`, resource_type: 'raw' },
      );
      await prisma.document.update({ where: { id: doc.id }, data: { url: subida.secure_url } });
      console.log('  archivo guardado en Cloudinary');
    } catch (err) {
      console.warn(`  no se pudo subir a Cloudinary: ${err instanceof Error ? err.message : err}`);
    }
  }

  // En línea y no por la cola, por el mismo motivo que instructivoVentas.ts:
  // este script se corre desde una laptop y el worker está en producción.
  const trozos = await extractAndChunk(buffer, 'text/plain');
  const vectores = [];
  for (const trozo of trozos) {
    const chunkId = uuidv4();
    const embedding = await getEmbedding(trozo.content);
    await prisma.chunk.create({
      data: {
        id: chunkId,
        documentId: doc.id,
        botId: bot.id,
        content: trozo.content,
        tokenCount: trozo.tokenCount,
        chunkIndex: trozo.chunkIndex,
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
        content: trozo.content,
        chunkIndex: trozo.chunkIndex,
      },
    });
  }
  await upsertChunks(vectores);
  await prisma.document.update({ where: { id: doc.id }, data: { status: 'READY' } });

  console.log(`\nListo. Documento ${doc.id} — ${texto.length} caracteres, ${vectores.length} vectores, READY.`);
  console.log('Los documentos anteriores NO se borran: revisalos en el panel.');
  await prisma.$disconnect();
}

if (process.argv[1]?.includes('instructivoAvisos')) {
  void main();
}
