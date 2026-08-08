/**
 * Genera los dos PDF de muestra con datos ficticios para revisar el diseño sin
 * tocar la base ni esperar al lunes.
 *
 *   npm run reporte:muestra           (deja los PDF en backend/tmp/)
 *   npx tsx src/scripts/reporteDeMuestra.ts [carpeta-destino]
 *
 * Deja informe-individual.pdf e informe-consolidado.pdf en la carpeta indicada.
 * Sirve para revisar tipografia, colores y saltos de pagina antes de un
 * lanzamiento, y para mostrarle el entregable a alguien sin exponer datos de un
 * cliente real.
 *
 * Vive dentro de src/ a proposito, para que npm run typecheck lo cubra: una
 * herramienta que no se typechequea se rompe en silencio la primera vez que
 * alguien renombra un campo del informe.
 *
 * Los datos son inventados A PROPOSITO y solo viven en este script: el informe
 * de produccion se calcula siempre con queries reales.
 */
import fs from 'fs/promises';
import path from 'path';
import { construirResumen, construirResumenConsolidado } from '../services/weeklyReportSummary';
import { renderWeeklyReportPdf, renderConsolidatedPdf } from '../services/weeklyReportPdf';
import type { PuntoHistorial, WeeklyReportContent } from '../services/weeklyReport';
import type { ConsolidatedContent, FilaConsolidada } from '../services/consolidatedReport';

const weekStart = new Date('2026-07-27T04:00:00Z'); // lunes 00:00 PY
const weekEnd = new Date('2026-08-03T04:00:00Z');

const TOP = [
  { pregunta: '¿Hacen envíos al interior?', cantidad: 23 },
  { pregunta: '¿Cuánto sale el envío a Ciudad del Este?', cantidad: 17 },
  { pregunta: '¿Están abiertos los sábados?', cantidad: 14 },
  { pregunta: '¿Aceptan tarjeta de crédito?', cantidad: 9 },
  { pregunta: '¿Tienen el modelo azul en stock?', cantidad: 6 },
];

const SIN_RESPONDER = [
  { pregunta: '¿Puedo pagar en cuotas sin interés con Itaú?', veces: 11 },
  { pregunta: '¿Cuánto tarda el envío a Encarnación?', veces: 7 },
  { pregunta: '¿Hacen factura a nombre de empresa?', veces: 5 },
  { pregunta: '¿Tienen garantía extendida?', veces: 3 },
];

const HORAS = [
  { hora: 8, cantidad: 21 }, { hora: 9, cantidad: 38 }, { hora: 10, cantidad: 52 },
  { hora: 11, cantidad: 44 }, { hora: 12, cantidad: 19 }, { hora: 15, cantidad: 33 },
  { hora: 18, cantidad: 47 }, { hora: 19, cantidad: 61 }, { hora: 20, cantidad: 40 },
];

const HISTORIAL: PuntoHistorial[] = [
  { weekStart: '2026-06-08T04:00:00Z', conversations: 61, messages: 402, nps: 3.8 },
  { weekStart: '2026-06-15T04:00:00Z', conversations: 74, messages: 489, nps: 3.9 },
  { weekStart: '2026-06-22T04:00:00Z', conversations: 68, messages: 455, nps: 4.1 },
  { weekStart: '2026-06-29T04:00:00Z', conversations: 82, messages: 540, nps: 4.0 },
  { weekStart: '2026-07-06T04:00:00Z', conversations: 95, messages: 611, nps: 4.2 },
  { weekStart: '2026-07-13T04:00:00Z', conversations: 88, messages: 578, nps: 4.3 },
  { weekStart: '2026-07-20T04:00:00Z', conversations: 104, messages: 690, nps: 4.2 },
  { weekStart: '2026-07-27T04:00:00Z', conversations: 127, messages: 843, nps: 4.4 },
];

const individual: WeeklyReportContent = {
  totalConversations: 127,
  totalMessages: 843,
  botMessages: 421,
  topQuestions: TOP,
  unansweredQuestions: SIN_RESPONDER,
  humanRequestedCount: 31,
  humanRequestedReasons: SIN_RESPONDER.slice(0, 3).map((q) => ({ motivo: q.pregunta, cantidad: q.veces })),
  peakHours: HORAS,
  npsAverage: 4.4,
  npsResponseCount: 38,
  npsPreviousAverage: 4.2,
  prevConversations: 104,
  prevMessages: 690,
  resumen: construirResumen({
    conversaciones: 127, mensajes: 843, conversacionesPrevias: 104,
    nps: 4.4, npsRespuestas: 38, npsPrevio: 4.2,
    sinResponder: 31, respuestasBot: 421, preguntasSinResponder: 4,
  }),
};

const FILAS: FilaConsolidada[] = [
  { botId: '1', botName: 'Muebles del Sur', conversations: 127, messages: 843, nps: 4.4, npsResponses: 38, unanswered: 31, unansweredQuestions: 4, deltaConversations: 0.221 },
  { botId: '2', botName: 'Farmacia Guaraní', conversations: 94, messages: 612, nps: 4.7, npsResponses: 29, unanswered: 6, unansweredQuestions: 2, deltaConversations: 0.088 },
  { botId: '3', botName: 'Taller Mecánico Ávalos', conversations: 61, messages: 388, nps: 3.2, npsResponses: 14, unanswered: 44, unansweredQuestions: 6, deltaConversations: -0.19 },
  { botId: '4', botName: 'Inmobiliaria Paraná', conversations: 38, messages: 240, nps: 4.1, npsResponses: 9, unanswered: 12, unansweredQuestions: 3, deltaConversations: 0.46 },
  { botId: '5', botName: 'Delivery Che Rógape', conversations: 22, messages: 131, nps: null, npsResponses: 0, unanswered: 3, unansweredQuestions: 1, deltaConversations: -0.04 },
  { botId: '6', botName: 'Estudio Contable Britez', conversations: 0, messages: 0, nps: null, npsResponses: 0, unanswered: 0, unansweredQuestions: 0, deltaConversations: -1 },
];

const totalConv = FILAS.reduce((a, f) => a + f.conversations, 0);
const npsResp = FILAS.reduce((a, f) => a + f.npsResponses, 0);

const consolidado: ConsolidatedContent = {
  totalBots: FILAS.length,
  totalConversations: totalConv,
  totalMessages: FILAS.reduce((a, f) => a + f.messages, 0),
  totalUnanswered: FILAS.reduce((a, f) => a + f.unanswered, 0),
  npsAverage: Number((FILAS.reduce((a, f) => a + (f.nps ?? 0) * f.npsResponses, 0) / npsResp).toFixed(2)),
  npsResponseCount: npsResp,
  prevConversations: 298,
  bots: FILAS,
  topUnanswered: [
    { pregunta: '¿Puedo pagar en cuotas sin interés con Itaú?', veces: 11, botName: 'Muebles del Sur' },
    { pregunta: '¿Atienden vehículos híbridos?', veces: 9, botName: 'Taller Mecánico Ávalos' },
    { pregunta: '¿Cuánto tarda el envío a Encarnación?', veces: 7, botName: 'Muebles del Sur' },
    { pregunta: '¿Hacen service de caja automática?', veces: 6, botName: 'Taller Mecánico Ávalos' },
    { pregunta: '¿Tienen departamentos amoblados?', veces: 4, botName: 'Inmobiliaria Paraná' },
  ],
  resumen: construirResumenConsolidado({
    bots: FILAS.length, conversaciones: totalConv, conversacionesPrevias: 298,
    mensajes: 2214, nps: 4.24, sinResponder: 96,
    mejorBot: { nombre: 'Farmacia Guaraní', nps: 4.7 },
    masActivo: { nombre: 'Muebles del Sur', conversaciones: 127 },
    masDescuidado: { nombre: 'Taller Mecánico Ávalos', sinResponder: 44 },
    inactivos: ['Estudio Contable Britez'],
  }),
};

async function main() {
  const destino = path.resolve(process.argv[2] ?? 'tmp');
  await fs.mkdir(destino, { recursive: true });

  const uno = await renderWeeklyReportPdf({
    botName: 'Muebles del Sur', weekStart, weekEnd,
    content: individual, historial: HISTORIAL,
  });
  const dos = await renderConsolidatedPdf({ weekStart, weekEnd, content: consolidado });

  const a = path.join(destino, 'informe-individual.pdf');
  const b = path.join(destino, 'informe-consolidado.pdf');
  await fs.writeFile(a, uno);
  await fs.writeFile(b, dos);

  console.log(`Individual  → ${a}  (${(uno.length / 1024).toFixed(1)} KB)`);
  console.log(`Consolidado → ${b}  (${(dos.length / 1024).toFixed(1)} KB)`);
  console.log('\nResumen ejecutivo del individual:');
  console.log(`  ${individual.resumen.titulo}  [${individual.resumen.tono}]`);
  for (const p of individual.resumen.parrafos) console.log(`  · ${p}`);
  console.log('\nResumen ejecutivo del consolidado:');
  console.log(`  ${consolidado.resumen.titulo}  [${consolidado.resumen.tono}]`);
  for (const p of consolidado.resumen.parrafos) console.log(`  · ${p}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
