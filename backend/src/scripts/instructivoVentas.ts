/**
 * Genera el instructivo del bot de ventas de BotForge.
 *
 * Existe como script y no como un .txt escrito a mano por un motivo concreto:
 * el instructivo anterior decía "hasta 5 imágenes" en Básico y "hasta 15" en
 * Profesional cuando los límites reales son 8 y 30. Nadie lo notó durante
 * meses, y era el bot que le contesta a los clientes que están evaluando pagar.
 *
 * Los números salen de `planCatalog.ts`, que a su vez deriva de `LIMITS`
 * (middleware/planLimits.ts) y de `PLAN_MONTOS` (services/pagopar.ts). Acá no
 * se escribe ningún precio ni ningún límite a mano.
 *
 * CÓMO REGENERARLO cuando cambie un plan:
 *
 *   npm run instructivo:ventas            imprime el texto
 *   npm run instructivo:ventas -- --subir  lo sube al bot de ventas
 *
 * El `--subir` agrega el documento y lo procesa EN LÍNEA: extrae, trocea,
 * calcula los embeddings y los sube a Pinecone, sin pasar por la cola de Bull.
 * La cola sirve para las subidas del panel, donde el worker corre en el mismo
 * deploy que recibió el archivo; este script se corre desde una laptop y el
 * job terminaría en el worker de producción, buscando un archivo que allá no
 * existe. Los documentos viejos NO se borran solos.
 *
 * Pide el id del bot por variable de entorno para que no se pueda apuntar al
 * bot equivocado por accidente.
 */
import { generarInstructivoVentas, PERSONALIDAD_VENTAS } from '../services/instructivoVentas';

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const texto = generarInstructivoVentas();
  const subir = process.argv.includes('--subir');

  // --personalidad: deja Bot.personality igual a PERSONALIDAD_VENTAS
  if (process.argv.includes('--personalidad')) {
    const id = process.env.BOT_VENTAS_ID;
    if (!id) {
      console.error('Falta BOT_VENTAS_ID');
      process.exit(1);
    }
    const { prisma } = await import('../lib/prisma');
    const antes = await prisma.bot.findUniqueOrThrow({ where: { id }, select: { name: true, personality: true } });
    await prisma.bot.update({ where: { id }, data: { personality: PERSONALIDAD_VENTAS } });
    console.log(`personalidad de "${antes.name}" actualizada`);
    console.log(`  antes:  ${antes.personality}`);
    console.log(`  ahora:  ${PERSONALIDAD_VENTAS}`);
    await prisma.$disconnect();
    if (!subir) return;
  }

  if (!subir) {
    console.log(texto);
    console.error(`\n[${texto.length} caracteres] Para subirlo: npm run instructivo:ventas -- --subir`);
    return;
  }

  // El id va por variable de entorno y no hardcodeado: apuntar al bot
  // equivocado le cambiaría la identidad al bot de otro cliente.
  const botId = process.env.BOT_VENTAS_ID;
  if (!botId) {
    console.error('Falta BOT_VENTAS_ID. Ejemplo:');
    console.error('  BOT_VENTAS_ID=225e2778-... npm run instructivo:ventas -- --subir');
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

  const nombre = 'instructivo-ventas-botforge.txt';
  const buffer = Buffer.from(texto, 'utf8');

  const doc = await prisma.document.create({
    data: {
      id: uuidv4(),
      botId: bot.id,
      name: nombre,
      mimeType: 'text/plain',
      // Sin archivo en disco: este documento se procesa acá mismo. Se deja
      // marcado para que nadie lo busque en /uploads al reprocesarlo.
      filePath: '(generado por instructivoVentas.ts)',
      fileSize: buffer.length,
      status: 'PROCESSING',
    },
  });

  // Se sube a Cloudinary igual que un documento del panel, para que exista de
  // donde releerlo si algun dia hay que reprocesarlo desde el servidor.
  if (isCloudinaryConfigured()) {
    try {
      const subida = await cloudinary.uploader.upload(
        `data:text/plain;base64,${buffer.toString('base64')}`,
        { folder: 'botforge/documents', public_id: `doc_${doc.id}`, resource_type: 'raw' },
      );
      await prisma.document.update({ where: { id: doc.id }, data: { url: subida.secure_url } });
      console.log('  archivo guardado en Cloudinary');
    } catch (err) {
      // No es motivo para abortar: lo que hace funcionar al bot son los
      // vectores, no el archivo.
      console.warn(`  no se pudo subir a Cloudinary: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Se procesa EN LINEA y no por la cola de Bull. La cola existe para las
  // subidas del panel, donde el worker corre en el mismo deploy que recibio el
  // archivo. Este script se corre desde una laptop: el job iria a parar al
  // worker de produccion, que buscaria el archivo en SU disco y no lo
  // encontraria. Procesarlo aca son las mismas funciones, en el mismo orden.
  const trozos = await extractAndChunk(buffer, 'text/plain');
  console.log(`  ${trozos.length} chunks`);

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

// Solo corre como CLI, no al importarlo desde una prueba
if (process.argv[1]?.includes('instructivoVentas')) {
  void main();
}
