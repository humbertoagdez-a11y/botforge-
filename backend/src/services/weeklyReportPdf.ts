/**
 * Exportacion a PDF del informe individual y del consolidado.
 *
 * pdfkit y no puppeteer: puppeteer se baja un Chromium de ~300 MB y levanta un
 * navegador por export, lo que en Railway significa build lento y memoria que
 * no tenemos. pdfkit es JS puro, pesa 8 MB, y arma el documento en memoria en
 * milisegundos. Los primitivos de marca (portada, tarjetas, graficos, pie)
 * viven en pdfKit.ts.
 *
 * Ni una linea de este archivo llama a la API de Anthropic: la prosa del
 * resumen ejecutivo viene ya armada por reglas desde weeklyReportSummary.ts.
 */
import PDFDocument from 'pdfkit';
import {
  C, CONTENT_W, M, PAGE,
  conSigno, drawBarList, drawExecutiveSummary, drawHeader, drawKpiRow, drawLineChart,
  emptyNote, ensure, fechaCorta, nombreArchivoPdf, paragraph, rangoLargo,
  sectionTitle, stampFooters,
  type Doc, type Kpi,
} from './pdfKit';
import type { PuntoHistorial, WeeklyReportContent } from './weeklyReport';
import type { ConsolidatedContent } from './consolidatedReport';

export { nombreArchivoPdf };

/** NPS en BotForge es escala 1 a 5, igual que en el panel */
const NPS_MAX = 5;

function render(build: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // bufferPages: hace falta para volver atrás y numerar el pie cuando ya se
    // sabe el total de páginas
    const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: M, left: M, right: M }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      stampFooters(doc, new Date());
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function deltaTexto(actual: number, previo: number | null | undefined): { hint: string; tone: Kpi['tone'] } {
  if (previo === null || previo === undefined) return { hint: 'primera semana medida', tone: 'neutral' };
  const dif = actual - previo;
  if (dif === 0) return { hint: 'igual que la semana pasada', tone: 'neutral' };
  const pct = previo === 0 ? null : Math.round((dif / previo) * 100);
  const cuerpo = conSigno(dif, pct === null ? String(Math.abs(dif)) : `${Math.abs(pct)}%`);
  return { hint: `${cuerpo} vs. semana anterior`, tone: dif > 0 ? 'ok' : 'neutral' };
}

// ─── Informe individual ───────────────────────────────────────────────────────

export function renderWeeklyReportPdf(params: {
  botName: string;
  weekStart: Date;
  weekEnd: Date;
  content: WeeklyReportContent;
  /** Semanas previas ya calculadas, de la más vieja a la más nueva */
  historial?: PuntoHistorial[];
}): Promise<Buffer> {
  const { botName, weekStart, weekEnd, content, historial = [] } = params;

  return render((doc) => {
    doc.y = drawHeader(doc, {
      eyebrow: 'Informe semanal',
      title: botName,
      subtitle: rangoLargo(weekStart, weekEnd),
      badge: `${content.totalConversations} conv.`,
    });

    // ── Resumen ejecutivo ───────────────────────────────────────────────────
    if (content.resumen) {
      drawExecutiveSummary(doc, content.resumen);
    }

    // ── Métricas ────────────────────────────────────────────────────────────
    const convDelta = deltaTexto(content.totalConversations, content.prevConversations);
    const msgDelta = deltaTexto(content.totalMessages, content.prevMessages);
    const npsHint =
      content.npsAverage === null
        ? 'sin respuestas'
        : content.npsPreviousAverage === null
          ? `${content.npsResponseCount} respuesta${content.npsResponseCount === 1 ? '' : 's'}`
          : `${conSigno(content.npsAverage - content.npsPreviousAverage, Math.abs(content.npsAverage - content.npsPreviousAverage).toFixed(1))} vs. anterior`;

    drawKpiRow(doc, [
      { label: 'Conversaciones', value: String(content.totalConversations), ...convDelta },
      { label: 'Mensajes', value: String(content.totalMessages), ...msgDelta },
      {
        label: 'No resueltas',
        value: String(content.humanRequestedCount),
        hint: content.humanRequestedCount === 0 ? 'resolvió todo' : 'derivadas a vos',
        tone: content.humanRequestedCount > 0 ? 'warn' : 'ok',
      },
      {
        label: 'Satisfacción',
        value: content.npsAverage === null ? '—' : `${content.npsAverage.toFixed(1)}/${NPS_MAX}`,
        hint: npsHint,
        tone:
          content.npsAverage === null ? 'neutral'
            : content.npsAverage >= 4 ? 'ok'
              : content.npsAverage < 3.5 ? 'warn' : 'neutral',
      },
    ]);

    // ── Evolución ───────────────────────────────────────────────────────────
    // Con una sola semana no hay evolución que mostrar, y un gráfico de un
    // punto suelto se lee como un error del producto
    if (historial.length >= 2) {
      sectionTitle(doc, 'Evolución', `Últimas ${historial.length} semanas`);
      const hayNps = historial.some((h) => h.nps !== null);
      const labels = historial.map((h) => fechaCorta(new Date(h.weekStart)));
      const y = ensure(doc, 132);
      const w = hayNps ? (CONTENT_W - 12) / 2 : CONTENT_W;

      drawLineChart(doc, {
        x: M, y, w, h: 122, titulo: 'Conversaciones por semana',
        serie: { labels, values: historial.map((h) => h.conversations), color: C.brand },
      });
      if (hayNps) {
        drawLineChart(doc, {
          x: M + w + 12, y, w, h: 122, titulo: `Satisfacción por semana (sobre ${NPS_MAX})`,
          serie: {
            labels, values: historial.map((h) => h.nps), color: C.cyan,
            // Eje 1 a 5: es el dominio real de la escala. Arrancando en 0 la
            // curva queda aplastada contra el techo y no se ve la tendencia.
            minOverride: 1, maxOverride: NPS_MAX, decimals: 1,
          },
        });
      }
      doc.y = y + 122 + 24;
      doc.x = M;
    }

    // ── Lo más consultado ───────────────────────────────────────────────────
    sectionTitle(doc, 'Lo más consultado', 'Las preguntas que más se repitieron esta semana');
    if (content.topQuestions.length === 0) {
      emptyNote(doc, 'No hubo consultas repetidas esta semana.');
    } else {
      // Sin caption: la columna de la derecha ya dice el número, repetirlo
      // debajo de cada barra solo ensucia
      drawBarList(doc, content.topQuestions.map((q) => ({ label: q.pregunta, value: q.cantidad })));
    }

    // ── Sin responder: la parte accionable ──────────────────────────────────
    sectionTitle(doc, 'Lo que tu bot no supo responder');
    if (content.unansweredQuestions.length === 0) {
      emptyNote(doc, 'Tu bot respondió todo lo que le preguntaron. No quedó nada pendiente.');
    } else {
      paragraph(
        doc,
        'Cargá estas respuestas desde el panel y la próxima semana tu bot ya las va a saber. Es la mejora más rápida que podés hacerle.',
        C.muted, 10,
      );
      doc.y += 4;
      for (const [i, q] of content.unansweredQuestions.entries()) {
        const alto = 15 + doc.font('Helvetica').fontSize(10)
          .heightOfString(q.pregunta, { width: CONTENT_W - 74 }) + 14;
        const y = ensure(doc, alto + 8);
        doc.roundedRect(M, y, CONTENT_W, alto, 7).fill(C.warnSoft);
        doc.rect(M, y, 3, alto).fill(C.warn);
        doc.fillColor(C.warn).font('Helvetica-Bold').fontSize(10)
          .text(`${i + 1}.`, M + 14, y + 13, { width: 16 });
        doc.fillColor(C.ink).font('Helvetica').fontSize(10)
          .text(q.pregunta, M + 32, y + 13, { width: CONTENT_W - 74 });
        doc.fillColor(C.warn).font('Helvetica-Bold').fontSize(8.5)
          .text(`${q.veces}×`, PAGE.w - M - 40, y + 13, { width: 28, align: 'right' });
        doc.y = y + alto + 8;
        doc.x = M;
      }
      doc.y += 6;
    }

    // ── Horarios ────────────────────────────────────────────────────────────
    sectionTitle(doc, 'Horarios de mayor actividad', 'Mensajes de clientes por hora, horario de Paraguay');
    if (content.peakHours.length === 0) {
      emptyNote(doc, 'No hubo actividad esta semana.');
    } else {
      const top = [...content.peakHours]
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 6)
        .sort((a, b) => a.hora - b.hora);
      drawBarList(
        doc,
        top.map((h) => ({
          label: `${String(h.hora).padStart(2, '0')}:00 a ${String((h.hora + 1) % 24).padStart(2, '0')}:00`,
          value: h.cantidad,
          color: C.cyan,
        })),
      );
    }
  });
}

// ─── Informe consolidado (Agencia) ────────────────────────────────────────────

export function renderConsolidatedPdf(params: {
  weekStart: Date;
  weekEnd: Date;
  content: ConsolidatedContent;
}): Promise<Buffer> {
  const { weekStart, weekEnd, content } = params;

  return render((doc) => {
    doc.y = drawHeader(doc, {
      eyebrow: 'Informe consolidado',
      title: `Tus ${content.totalBots} bots`,
      subtitle: rangoLargo(weekStart, weekEnd),
      badge: 'AGENCIA',
    });

    if (content.resumen) {
      drawExecutiveSummary(doc, content.resumen);
    }

    const convDelta = deltaTexto(content.totalConversations, content.prevConversations);
    drawKpiRow(doc, [
      { label: 'Bots activos', value: String(content.totalBots) },
      { label: 'Conversaciones', value: String(content.totalConversations), ...convDelta },
      {
        label: 'No resueltas',
        value: String(content.totalUnanswered),
        hint: content.totalUnanswered === 0 ? 'resolvieron todo' : 'en toda la cartera',
        tone: content.totalUnanswered > 0 ? 'warn' : 'ok',
      },
      {
        label: 'Satisfacción',
        value: content.npsAverage === null ? '—' : `${content.npsAverage.toFixed(1)}/${NPS_MAX}`,
        hint: content.npsResponseCount > 0 ? `${content.npsResponseCount} respuestas` : 'sin respuestas',
        tone:
          content.npsAverage === null ? 'neutral'
            : content.npsAverage >= 4 ? 'ok'
              : content.npsAverage < 3.5 ? 'warn' : 'neutral',
      },
    ]);

    // ── Tabla comparativa ───────────────────────────────────────────────────
    sectionTitle(doc, 'Bot por bot', 'Ordenados por volumen de conversaciones');
    drawTablaBots(doc, content);

    // ── Ranking por volumen ─────────────────────────────────────────────────
    sectionTitle(doc, 'Ranking por volumen');
    drawBarList(
      doc,
      content.bots.map((b) => ({ label: b.botName, value: b.conversations })),
    );

    // ── Ranking por satisfacción ────────────────────────────────────────────
    const conNps = content.bots.filter((b) => b.nps !== null && b.npsResponses > 0);
    sectionTitle(doc, 'Ranking por satisfacción', `Promedio sobre ${NPS_MAX}, solo bots con respuestas`);
    if (conNps.length === 0) {
      emptyNote(doc, 'Ningún bot recibió calificaciones esta semana. Activá la encuesta automática para empezar a medirlo.');
    } else {
      // La escala se fija en NPS_MAX: si se normalizara al mejor bot, un 3.2
      // se vería como barra llena y diría lo contrario de lo que pasa
      drawBarList(
        doc,
        [...conNps]
          .sort((a, b) => b.nps! - a.nps!)
          .map((b) => ({
            label: b.botName,
            value: b.nps!,
            valueLabel: b.nps!.toFixed(1),
            color: b.nps! >= 4 ? C.ok : b.nps! < 3.5 ? C.warn : C.brand,
            caption: `${b.npsResponses} respuesta${b.npsResponses === 1 ? '' : 's'}`,
          })),
        NPS_MAX,
      );
    }

    // ── Dónde meter mano primero ────────────────────────────────────────────
    sectionTitle(doc, 'Dónde meter mano primero', 'Los bots con más consultas sin responder');
    const conDeuda = content.bots.filter((b) => b.unanswered > 0).sort((a, b) => b.unanswered - a.unanswered);
    if (conDeuda.length === 0) {
      emptyNote(doc, 'Ningún bot dejó consultas sin responder esta semana.');
    } else {
      drawBarList(
        doc,
        conDeuda.map((b) => ({
          label: b.botName,
          value: b.unanswered,
          color: C.warn,
          caption: b.unansweredQuestions > 0
            ? `${b.unansweredQuestions} pregunta${b.unansweredQuestions === 1 ? '' : 's'} distinta${b.unansweredQuestions === 1 ? '' : 's'}`
            : undefined,
        })),
      );
    }

    // ── Preguntas de toda la cartera ────────────────────────────────────────
    if (content.topUnanswered.length > 0) {
      sectionTitle(doc, 'Preguntas sin responder de toda la cartera');
      for (const [i, q] of content.topUnanswered.entries()) {
        const alto = 15 + doc.font('Helvetica').fontSize(10)
          .heightOfString(q.pregunta, { width: CONTENT_W - 74 }) + 26;
        const y = ensure(doc, alto + 8);
        doc.roundedRect(M, y, CONTENT_W, alto, 7).fill(C.warnSoft);
        doc.rect(M, y, 3, alto).fill(C.warn);
        doc.fillColor(C.warn).font('Helvetica-Bold').fontSize(10)
          .text(`${i + 1}.`, M + 14, y + 13, { width: 16 });
        doc.fillColor(C.ink).font('Helvetica').fontSize(10)
          .text(q.pregunta, M + 32, y + 13, { width: CONTENT_W - 74 });
        doc.fillColor(C.muted).font('Helvetica').fontSize(8)
          .text(q.botName, M + 32, doc.y + 3, { width: CONTENT_W - 74 });
        doc.fillColor(C.warn).font('Helvetica-Bold').fontSize(8.5)
          .text(`${q.veces}×`, PAGE.w - M - 40, y + 13, { width: 28, align: 'right' });
        doc.y = y + alto + 8;
        doc.x = M;
      }
    }
  });
}

/** Tabla comparativa con cabecera y filas alternadas */
function drawTablaBots(doc: Doc, content: ConsolidatedContent): void {
  const COLS = [
    { t: 'Bot', w: 176, align: 'left' as const },
    { t: 'Conv.', w: 58, align: 'right' as const },
    { t: 'Msj.', w: 58, align: 'right' as const },
    { t: 'NPS', w: 62, align: 'right' as const },
    { t: 'Sin resp.', w: 68, align: 'right' as const },
    { t: 'vs. sem.', w: 77, align: 'right' as const },
  ];
  const H = 22;

  const cabecera = () => {
    const y = doc.y;
    doc.roundedRect(M, y, CONTENT_W, H, 4).fill(C.brandSoft);
    let x = M + 10;
    for (const c of COLS) {
      doc.fillColor(C.brandDark).font('Helvetica-Bold').fontSize(7.8)
        .text(c.t.toUpperCase(), x, y + 7.5, { width: c.w - 10, align: c.align, characterSpacing: 0.4 });
      x += c.w;
    }
    doc.y = y + H;
    doc.x = M;
  };

  ensure(doc, H * 3);
  cabecera();

  content.bots.forEach((b, i) => {
    if (doc.y + H > PAGE.h - 60) {
      doc.addPage();
      doc.y = M;
      cabecera();
    }
    const y = doc.y;
    if (i % 2 === 1) doc.rect(M, y, CONTENT_W, H).fill(C.panel);

    const delta =
      b.deltaConversations === null
        ? '—'
        : conSigno(b.deltaConversations, `${Math.round(Math.abs(b.deltaConversations) * 100)}%`);
    const celdas = [
      { v: b.botName, color: C.ink, bold: true },
      { v: String(b.conversations), color: C.body, bold: false },
      { v: String(b.messages), color: C.body, bold: false },
      { v: b.nps === null ? '—' : b.nps.toFixed(1), color: b.nps !== null && b.nps < 3.5 ? C.warn : C.body, bold: false },
      { v: String(b.unanswered), color: b.unanswered > 0 ? C.warn : C.body, bold: false },
      {
        v: delta,
        color: b.deltaConversations === null ? C.faint : b.deltaConversations > 0 ? C.ok : b.deltaConversations < 0 ? C.warn : C.body,
        bold: false,
      },
    ];

    let x = M + 10;
    celdas.forEach((c, j) => {
      doc.fillColor(c.color).font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
        .text(c.v, x, y + 7, { width: COLS[j].w - 10, align: COLS[j].align, lineBreak: false, ellipsis: true });
      x += COLS[j].w;
    });

    doc.y = y + H;
    doc.x = M;
    doc.lineWidth(0.5).moveTo(M, doc.y).lineTo(PAGE.w - M, doc.y).strokeColor(C.rule).stroke();
  });

  doc.y += 18;
  doc.x = M;
}
