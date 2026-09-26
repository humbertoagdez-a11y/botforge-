/**
 * Encuentra vectores de Pinecone que ya no le corresponden a nadie.
 *
 * Aparecieron porque hasta hoy borrar un bot limpiaba Postgres y nada mas:
 * los vectores quedaban en el indice para siempre. El indice es uno solo y lo
 * comparten todos los clientes, asi que la basura de un bot borrado se paga y
 * ademas ensucia el espacio de busqueda de los demas.
 *
 *   npm run vectores:huerfanos           solo informa, no toca nada
 *   npm run vectores:huerfanos -- --borrar   borra los que encontro
 *
 * El default es informar a proposito. Borrar vectores no se puede deshacer:
 * para recuperarlos hay que reprocesar los documentos, y si el documento
 * original tampoco esta, no hay vuelta atras.
 */
import { prisma } from '../lib/prisma';
import {
  listarTodosLosIds,
  traerMetadataDeVectores,
  deleteChunksByIds,
} from '../services/pinecone';

const BORRAR = process.argv.includes('--borrar');

async function main(): Promise<void> {
  console.log('leyendo el indice completo de Pinecone...');
  const idsEnPinecone = await listarTodosLosIds();
  console.log(`  vectores en el indice: ${idsEnPinecone.length}`);

  const chunks = await prisma.chunk.findMany({ select: { pineconeId: true } });
  const conocidos = new Set(chunks.map((c) => c.pineconeId));
  console.log(`  chunks en la base:     ${conocidos.size}`);

  const huerfanos = idsEnPinecone.filter((id) => !conocidos.has(id));
  if (huerfanos.length === 0) {
    console.log('\nNo hay vectores huerfanos. El indice y la base coinciden.');
    await prisma.$disconnect();
    return;
  }

  console.log(`\nvectores huerfanos: ${huerfanos.length}`);
  console.log('averiguando de que bot era cada uno...');
  const metadata = await traerMetadataDeVectores(huerfanos);

  // Agrupados por bot, para poder decir de quien era cada cosa
  const porBot = new Map<string, string[]>();
  for (const id of huerfanos) {
    const botId = metadata.get(id)?.botId ?? '(sin metadata)';
    const lista = porBot.get(botId);
    if (lista) lista.push(id);
    else porBot.set(botId, [id]);
  }

  // Un botId puede seguir existiendo: seria un vector que quedo colgado de un
  // documento reprocesado, no de un bot borrado. Se informa distinto porque
  // significa otra cosa.
  const idsDeBots = [...porBot.keys()].filter((b) => b !== '(sin metadata)');
  const vivos = new Set(
    (
      await prisma.bot.findMany({
        where: { id: { in: idsDeBots } },
        select: { id: true, name: true },
      })
    ).map((b) => `${b.id}\u0000${b.name}`),
  );
  const nombrePorId = new Map([...vivos].map((v) => v.split('\u0000') as [string, string]));

  console.log(`\n${'='.repeat(74)}`);
  console.log('DE QUE BOTS ERAN');
  console.log('='.repeat(74));
  const ordenados = [...porBot.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [botId, ids] of ordenados) {
    const nombre = nombrePorId.get(botId);
    const estado = nombre
      ? `el bot EXISTE ("${nombre}") — vectores colgados de un documento que ya no esta`
      : botId === '(sin metadata)'
        ? 'sin metadata: no se puede saber de quien era'
        : 'el bot ya no esta en la base';
    console.log(`  ${String(ids.length).padStart(5)} vectores · ${botId}`);
    console.log(`        ${estado}`);
  }

  const deBotsBorrados = ordenados
    .filter(([botId]) => botId !== '(sin metadata)' && !nombrePorId.has(botId))
    .reduce((n, [, ids]) => n + ids.length, 0);
  console.log(`\n  de bots que ya no existen: ${deBotsBorrados}`);
  console.log(`  total a borrar:            ${huerfanos.length}`);

  if (!BORRAR) {
    console.log('\nNo se borro nada. Para borrarlos:');
    console.log('  npm run vectores:huerfanos -- --borrar');
    await prisma.$disconnect();
    return;
  }

  console.log('\nborrando...');
  await deleteChunksByIds(huerfanos);
  console.log(`borrados ${huerfanos.length} vectores huerfanos.`);

  await prisma.$disconnect();
}

void main();
