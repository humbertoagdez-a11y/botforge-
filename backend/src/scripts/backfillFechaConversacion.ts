/**
 * Corrige Conversation.updatedAt en las conversaciones que ya existen.
 *
 *   npm run backfill:fechas              solo informa, no toca nada
 *   npm run backfill:fechas -- --aplicar  lo aplica
 *
 * Hace falta porque `@updatedAt` solo se dispara al actualizar LA FILA: crear
 * mensajes hijos nunca la tocaba. Desde lib/prisma.ts eso ya no vuelve a
 * pasar, pero las filas viejas siguen con la fecha mal y de ese campo dependen
 * el orden del panel, el KPI de 24 horas y a quien se le manda la encuesta NPS.
 *
 * El valor correcto es el createdAt del ultimo mensaje de cada conversacion.
 * Las conversaciones sin mensajes se dejan como estan: su updatedAt es el de
 * su creacion, que es lo que corresponde.
 *
 * Informa por defecto: reescribir fechas no se puede deshacer.
 */
import { prisma } from '../lib/prisma';

const APLICAR = process.argv.includes('--aplicar');

interface FilaDesfasada {
  id: string;
  bot: string;
  canal: string;
  updatedAt: Date;
  ultimoMensaje: Date;
  mensajes: number;
}

async function main(): Promise<void> {
  // Se compara contra el ultimo mensaje de cada conversacion. El margen de un
  // segundo evita contar como desfasadas las filas que ya estan bien salvo por
  // la diferencia entre el INSERT del mensaje y el UPDATE de la conversacion.
  const desfasadas = await prisma.$queryRawUnsafe<FilaDesfasada[]>(`
    SELECT c.id,
           b.name                AS bot,
           c.channel             AS canal,
           c."updatedAt",
           m.ultimo              AS "ultimoMensaje",
           m.cuantos::int        AS mensajes
    FROM conversations c
    JOIN bots b ON b.id = c."botId"
    JOIN (
      SELECT "conversationId", MAX("createdAt") AS ultimo, COUNT(*) AS cuantos
      FROM messages GROUP BY "conversationId"
    ) m ON m."conversationId" = c.id
    WHERE ABS(EXTRACT(EPOCH FROM (c."updatedAt" - m.ultimo))) > 1
    ORDER BY ABS(EXTRACT(EPOCH FROM (c."updatedAt" - m.ultimo))) DESC
  `);

  const total = await prisma.conversation.count();
  const sinMensajes = await prisma.conversation.count({ where: { messages: { none: {} } } });

  console.log(`conversaciones en total:        ${total}`);
  console.log(`  sin mensajes (no se tocan):   ${sinMensajes}`);
  console.log(`  con la fecha mal:             ${desfasadas.length}`);

  if (desfasadas.length === 0) {
    console.log('\nNada que corregir.');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n${'='.repeat(92)}`);
  console.log('QUE FILAS CAMBIAN');
  console.log('='.repeat(92));
  const dias = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 86400000;
  for (const f of desfasadas) {
    console.log(
      `  ${f.bot.slice(0, 24).padEnd(26)} ${f.canal.padEnd(9)} msgs=${String(f.mensajes).padStart(3)}  ` +
        `${f.updatedAt.toISOString().slice(0, 16)} -> ${f.ultimoMensaje.toISOString().slice(0, 16)}` +
        `  (${dias(f.updatedAt, f.ultimoMensaje).toFixed(1)} días)`,
    );
  }

  const atrasadas = desfasadas.filter((f) => f.updatedAt < f.ultimoMensaje).length;
  console.log(`\n  con fecha MAS VIEJA que su ultimo mensaje: ${atrasadas}`);
  console.log(`  con fecha mas nueva:                       ${desfasadas.length - atrasadas}`);

  if (!APLICAR) {
    console.log('\nNo se cambio nada. Para aplicarlo:');
    console.log('  npm run backfill:fechas -- --aplicar');
    await prisma.$disconnect();
    return;
  }

  console.log('\naplicando...');
  const cambiadas = await prisma.$executeRawUnsafe(`
    UPDATE conversations c
    SET "updatedAt" = m.ultimo
    FROM (
      SELECT "conversationId", MAX("createdAt") AS ultimo
      FROM messages GROUP BY "conversationId"
    ) m
    WHERE c.id = m."conversationId"
      AND ABS(EXTRACT(EPOCH FROM (c."updatedAt" - m.ultimo))) > 1
  `);
  console.log(`filas actualizadas: ${cambiadas}`);

  await prisma.$disconnect();
}

void main();
