/**
 * Exportacion del reporte semanal a PDF con pdfkit.
 *
 * pdfkit y no puppeteer: puppeteer se baja un Chromium de ~300 MB y levanta un
 * navegador por export, lo que en Railway significa build lento y memoria que
 * no tenemos. pdfkit es JS puro, pesa 8 MB, y genera el documento en memoria en
 * milisegundos. El reporte son numeros y listas, no HTML complejo, asi que no
 * hace falta un motor de render.
 */
import PDFDocument from 'pdfkit';
import type { WeeklyReportContent } from './weeklyReport';

const MORADO = '#7C3AED';
const GRIS = '#6B7280';
const NEGRO = '#111111';

function fechaLarga(d: Date): string {
  // Se muestra el dia paraguayo, igual que en el resto del producto
  const py = new Date(d.getTime() - 4 * 3600 * 1000);
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${py.getUTCDate()} de ${meses[py.getUTCMonth()]} de ${py.getUTCFullYear()}`;
}

/** Genera el PDF completo en memoria. Resuelve con el buffer listo para enviar. */
export function renderWeeklyReportPdf(params: {
  botName: string;
  weekStart: Date;
  weekEnd: Date;
  content: WeeklyReportContent;
}): Promise<Buffer> {
  const { botName, weekStart, weekEnd, content } = params;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Encabezado ────────────────────────────────────────────────────────────
    doc.fillColor(MORADO).fontSize(10).font('Helvetica-Bold').text('BOTFORGE · REPORTE SEMANAL');
    doc.moveDown(0.4);
    doc.fillColor(NEGRO).fontSize(22).font('Helvetica-Bold').text(botName);
    doc.moveDown(0.2);
    // weekEnd es exclusivo: el ultimo dia cubierto es el anterior
    doc.fillColor(GRIS).fontSize(11).font('Helvetica')
      .text(`Del ${fechaLarga(weekStart)} al ${fechaLarga(new Date(weekEnd.getTime() - 1))}`);
    doc.moveDown(1.2);

    const linea = () => {
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').lineWidth(1).stroke();
      doc.moveDown(0.8);
    };
    const titulo = (t: string) => {
      if (doc.y > 700) doc.addPage();
      doc.fillColor(NEGRO).fontSize(13).font('Helvetica-Bold').text(t);
      doc.moveDown(0.5);
    };
    const dato = (label: string, valor: string) => {
      const y = doc.y;
      doc.fillColor(GRIS).fontSize(11).font('Helvetica').text(label, 50, y, { width: 300 });
      doc.fillColor(NEGRO).fontSize(11).font('Helvetica-Bold')
        .text(valor, 350, y, { width: 195, align: 'right' });
      doc.moveDown(0.6);
    };
    const vacio = (t: string) => {
      doc.fillColor(GRIS).fontSize(10).font('Helvetica-Oblique').text(t);
      doc.moveDown(0.8);
    };

    // ── Resumen ───────────────────────────────────────────────────────────────
    linea();
    titulo('Resumen');
    dato('Conversaciones nuevas', String(content.totalConversations));
    dato('Mensajes intercambiados', String(content.totalMessages));
    dato('Consultas que el bot no pudo resolver', String(content.humanRequestedCount));
    if (content.npsAverage !== null) {
      dato(
        'Satisfacción promedio (NPS)',
        `${content.npsAverage} / 10  ·  ${content.npsResponseCount} respuesta${content.npsResponseCount === 1 ? '' : 's'}`,
      );
      if (content.npsPreviousAverage !== null) {
        const delta = content.npsAverage - content.npsPreviousAverage;
        const signo = delta > 0 ? '+' : '';
        dato('Comparado con la semana anterior', `${signo}${delta.toFixed(2)} puntos`);
      }
    } else {
      dato('Satisfacción promedio (NPS)', 'Sin respuestas esta semana');
    }
    doc.moveDown(0.6);

    // ── Lo más consultado ─────────────────────────────────────────────────────
    linea();
    titulo('Lo más consultado');
    if (content.topQuestions.length === 0) {
      vacio('No hubo consultas repetidas esta semana.');
    } else {
      content.topQuestions.forEach((q, i) => {
        doc.fillColor(NEGRO).fontSize(11).font('Helvetica')
          .text(`${i + 1}. ${q.pregunta}`, { width: 430, continued: false });
        doc.fillColor(GRIS).fontSize(9).font('Helvetica')
          .text(`${q.cantidad} ${q.cantidad === 1 ? 'vez' : 'veces'}`);
        doc.moveDown(0.5);
      });
    }
    doc.moveDown(0.4);

    // ── Sin responder ─────────────────────────────────────────────────────────
    linea();
    titulo('Lo que tu bot no supo responder');
    if (content.unansweredQuestions.length === 0) {
      vacio('Tu bot respondió todo lo que le preguntaron. Muy bien.');
    } else {
      doc.fillColor(GRIS).fontSize(10).font('Helvetica')
        .text('Agregá esta información a tu bot para que la próxima sepa responder.');
      doc.moveDown(0.6);
      content.unansweredQuestions.forEach((q, i) => {
        if (doc.y > 720) doc.addPage();
        doc.fillColor(NEGRO).fontSize(11).font('Helvetica')
          .text(`${i + 1}. ${q.pregunta}`, { width: 430 });
        doc.fillColor(GRIS).fontSize(9).font('Helvetica')
          .text(`Preguntado ${q.veces} ${q.veces === 1 ? 'vez' : 'veces'}`);
        doc.moveDown(0.5);
      });
    }
    doc.moveDown(0.4);

    // ── Horarios ──────────────────────────────────────────────────────────────
    if (doc.y > 620) doc.addPage();
    linea();
    titulo('Horarios de mayor actividad');
    if (content.peakHours.length === 0) {
      vacio('No hubo actividad esta semana.');
    } else {
      const max = Math.max(...content.peakHours.map((h) => h.cantidad));
      const top = [...content.peakHours].sort((a, b) => b.cantidad - a.cantidad).slice(0, 6);
      for (const h of top.sort((a, b) => a.hora - b.hora)) {
        if (doc.y > 730) doc.addPage();
        const y = doc.y;
        doc.fillColor(GRIS).fontSize(11).font('Helvetica')
          .text(`${String(h.hora).padStart(2, '0')}:00`, 50, y, { width: 50 });
        // Barra proporcional al pico, para que se lea de un vistazo
        const ancho = Math.max(2, Math.round((h.cantidad / max) * 340));
        doc.rect(110, y + 2, ancho, 9).fillColor(MORADO).fill();
        doc.fillColor(NEGRO).fontSize(10).font('Helvetica')
          .text(String(h.cantidad), 460, y, { width: 85, align: 'right' });
        doc.moveDown(0.7);
      }
      doc.fillColor(GRIS).fontSize(9).font('Helvetica-Oblique')
        .text('Horario de Paraguay.');
    }

    // ── Pie ───────────────────────────────────────────────────────────────────
    doc.moveDown(1.5);
    linea();
    doc.fillColor(GRIS).fontSize(9).font('Helvetica')
      .text('Generado automáticamente por BotForge a partir de las conversaciones reales de tu bot. mibotforge.com');

    doc.end();
  });
}

/** Nombre de archivo estable y sin caracteres que rompan el header */
export function nombreArchivoPdf(botName: string, weekStart: Date): string {
  const py = new Date(weekStart.getTime() - 4 * 3600 * 1000);
  const fecha = `${py.getUTCFullYear()}-${String(py.getUTCMonth() + 1).padStart(2, '0')}-${String(py.getUTCDate()).padStart(2, '0')}`;
  const slug = botName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'bot';
  return `reporte-${slug}-${fecha}.pdf`;
}
