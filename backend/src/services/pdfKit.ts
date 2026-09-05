/**
 * Primitivos de marca para los PDF de BotForge: banda de portada, tipografia,
 * tarjetas de metrica, graficos y pie con numeracion.
 *
 * Todo se dibuja con vectores de pdfkit, sin librerias de charting ni imagenes
 * rasterizadas. Ver la nota de renderLineChart para el razonamiento.
 */
// PDFKit es el namespace global que declara @types/pdfkit; no se importa
export type Doc = PDFKit.PDFDocument;

// ─── Paleta ───────────────────────────────────────────────────────────────────
// Los morados son los del producto (--primary: 262.1 83.3% 57.8% ≈ #7C3AED y
// el gradiente del logo hasta #4C1D95), para que el PDF y el panel se lean
// como la misma marca.
export const C = {
  brand: '#7C3AED',
  brandDark: '#4C1D95',
  brandSoft: '#F5F3FF',
  ink: '#111827',
  body: '#374151',
  muted: '#6B7280',
  faint: '#9CA3AF',
  rule: '#E5E7EB',
  panel: '#F9FAFB',
  ok: '#059669',
  okSoft: '#ECFDF5',
  warn: '#B45309',
  warnSoft: '#FFFBEB',
  cyan: '#0891B2',
} as const;

export const PAGE = { w: 595.28, h: 841.89 };
export const M = 48;
export const CONTENT_W = PAGE.w - M * 2;
/** Alto reservado al pie en cada página */
const FOOTER_H = 46;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Las fechas del informe son días paraguayos (UTC-4), no del huso del servidor */
function py(d: Date): Date {
  return new Date(d.getTime() - 4 * 3600 * 1000);
}

export function fechaCorta(d: Date): string {
  const p = py(d);
  return `${p.getUTCDate()} ${MESES[p.getUTCMonth()]}`;
}

export function fechaLarga(d: Date): string {
  const p = py(d);
  return `${p.getUTCDate()} de ${MESES_LARGO[p.getUTCMonth()]} de ${p.getUTCFullYear()}`;
}

/** weekEnd es exclusivo: el último día cubierto es el anterior */
export function rangoLargo(weekStart: Date, weekEnd: Date): string {
  return `${fechaLarga(weekStart)} al ${fechaLarga(new Date(weekEnd.getTime() - 1))}`;
}

export function nombreArchivoPdf(prefijo: string, weekStart: Date): string {
  const p = py(weekStart);
  const fecha = `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}-${String(p.getUTCDate()).padStart(2, '0')}`;
  const slug =
    prefijo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'informe';
  return `${slug}-${fecha}.pdf`;
}

// ─── Isotipo ──────────────────────────────────────────────────────────────────

/**
 * El robot del logo, dibujado con vectores. No se carga el SVG porque pdfkit
 * no interpreta SVG y sumar un conversor por un isotipo de seis formas no se
 * justifica; redibujarlo mantiene el PDF sin dependencias ni assets externos.
 */
export function drawLogo(doc: Doc, x: number, y: number, size: number): void {
  const u = size / 32;
  doc.save();
  // Antena
  doc.roundedRect(x + 15 * u, y + 2 * u, 2 * u, 6 * u, u).fill('#FFFFFF');
  doc.circle(x + 16 * u, y + 2 * u, 2.4 * u).fill('#67E8F9');
  // Cuerpo
  doc.roundedRect(x + 4 * u, y + 8 * u, 24 * u, 20 * u, 6 * u).fill('#FFFFFF');
  // Ojos
  doc.circle(x + 12 * u, y + 17 * u, 2.6 * u).fill(C.brandDark);
  doc.circle(x + 20 * u, y + 17 * u, 2.6 * u).fill(C.brandDark);
  // Boca
  doc.roundedRect(x + 12 * u, y + 22 * u, 8 * u, 1.8 * u, u).fill(C.brandDark);
  doc.restore();
}

// ─── Portada ──────────────────────────────────────────────────────────────────

/**
 * Banda superior a sangre con el gradiente de marca. Devuelve la Y donde puede
 * arrancar el contenido.
 */
export function drawHeader(
  doc: Doc,
  opts: { eyebrow: string; title: string; subtitle: string; badge?: string },
): number {
  const H = 148;
  const grad = doc.linearGradient(0, 0, PAGE.w, H);
  grad.stop(0, C.brandDark).stop(1, C.brand);
  doc.rect(0, 0, PAGE.w, H).fill(grad);

  // Acento inferior: la línea cian que el panel usa como color secundario
  doc.rect(0, H - 3, PAGE.w, 3).fill('#22D3EE');

  drawLogo(doc, M, 30, 30);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(12)
    .text('BotForge', M + 40, 38, { characterSpacing: 0.4 });

  doc.fillColor('#DDD6FE').font('Helvetica-Bold').fontSize(9)
    .text(opts.eyebrow.toUpperCase(), M, 78, { characterSpacing: 1.6 });

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(25)
    .text(opts.title, M, 92, { width: CONTENT_W - 110, lineBreak: false, ellipsis: true });

  doc.fillColor('#E9D5FF').font('Helvetica').fontSize(10.5)
    .text(opts.subtitle, M, 124, { width: CONTENT_W - 110 });

  if (opts.badge) {
    const w = doc.font('Helvetica-Bold').fontSize(9).widthOfString(opts.badge) + 20;
    doc.roundedRect(PAGE.w - M - w, 84, w, 22, 11)
      .fillOpacity(0.22).fill('#FFFFFF').fillOpacity(1);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9)
      .text(opts.badge, PAGE.w - M - w, 91, { width: w, align: 'center' });
  }

  return H + 26;
}

// ─── Estructura ───────────────────────────────────────────────────────────────

/** Alto de un emptyNote: 34 de caja + 14 de aire. Va entero con su titulo. */
export const ALTO_NOTA_VACIA = 48;
/** Dos filas de drawBarList: lo minimo para que un titulo no quede huerfano. */
export const ALTO_MINIMO_LISTA = 46;

/** Salta de página si no entran `h` puntos antes del pie. Devuelve la Y usable. */
export function ensure(doc: Doc, h: number): number {
  if (doc.y + h > PAGE.h - FOOTER_H) {
    doc.addPage();
    doc.y = M;
  }
  return doc.y;
}

/**
 * Titulo de seccion.
 *
 * `altoContenido` es el alto de lo primero que viene despues, y sirve para que
 * el titulo NO se quede solo al pie de una pagina. Sin esto cada bloque
 * llamaba a ensure() por su cuenta: el titulo entraba en los ultimos puntos de
 * la hoja, el contenido ya no, y saltaba de pagina. El resultado era un titulo
 * huerfano abajo y una hoja nueva con dos lineas y el 80% en blanco.
 *
 * Se pasa el minimo que tiene que viajar junto al titulo, no el alto total de
 * la seccion: reservar la seccion entera provocaria el problema inverso, cortar
 * la pagina antes de tiempo y dejar el hueco al final de la anterior.
 */
export function sectionTitle(doc: Doc, texto: string, hint?: string, altoContenido = 0): void {
  ensure(doc, 60 + altoContenido);
  const y = doc.y;
  // Marca de color a la izquierda: separa secciones sin gastar una línea entera
  doc.rect(M, y + 2, 3, 14).fill(C.brand);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(13).text(texto, M + 12, y);
  if (hint) {
    doc.fillColor(C.muted).font('Helvetica').fontSize(9.5)
      .text(hint, M + 12, doc.y + 2, { width: CONTENT_W - 12 });
  }
  doc.y += 12;
  doc.x = M;
}

export function paragraph(doc: Doc, texto: string, color: string = C.body, size = 10.5): void {
  ensure(doc, 30);
  doc.fillColor(color).font('Helvetica').fontSize(size)
    .text(texto, M, doc.y, { width: CONTENT_W, align: 'left', lineGap: 2.5 });
  doc.y += 6;
  doc.x = M;
}

export function emptyNote(doc: Doc, texto: string): void {
  ensure(doc, 40);
  const y = doc.y;
  doc.roundedRect(M, y, CONTENT_W, 34, 6).fill(C.panel);
  doc.fillColor(C.muted).font('Helvetica-Oblique').fontSize(10)
    .text(texto, M + 14, y + 11, { width: CONTENT_W - 28 });
  doc.y = y + 34 + 14;
  doc.x = M;
}

// ─── Resumen ejecutivo ────────────────────────────────────────────────────────

const TONO = {
  positivo: { linea: C.ok, fondo: C.okSoft, titulo: C.ok },
  neutral: { linea: C.brand, fondo: C.brandSoft, titulo: C.brandDark },
  alerta: { linea: C.warn, fondo: C.warnSoft, titulo: C.warn },
} as const;

export function drawExecutiveSummary(
  doc: Doc,
  resumen: { titulo: string; tono: keyof typeof TONO; parrafos: string[] },
): void {
  const t = TONO[resumen.tono] ?? TONO.neutral;
  const PAD = 18;

  // Se mide antes de pintar: el panel tiene que quedar detrás del texto, y
  // para eso hay que saber su alto sin haberlo escrito todavía.
  doc.font('Helvetica-Bold').fontSize(12.5);
  let alto = PAD + doc.heightOfString(resumen.titulo, { width: CONTENT_W - PAD * 2 }) + 8;
  doc.font('Helvetica').fontSize(10.5);
  for (const p of resumen.parrafos) {
    alto += doc.heightOfString(p, { width: CONTENT_W - PAD * 2, lineGap: 2.5 }) + 7;
  }
  alto += PAD - 7;

  const y = ensure(doc, alto + 20);
  doc.roundedRect(M, y, CONTENT_W, alto, 8).fill(t.fondo);
  doc.rect(M, y, 3.5, alto).fill(t.linea);

  let cy = y + PAD;
  doc.fillColor(t.titulo).font('Helvetica-Bold').fontSize(12.5)
    .text(resumen.titulo, M + PAD, cy, { width: CONTENT_W - PAD * 2 });
  cy = doc.y + 8;
  for (const p of resumen.parrafos) {
    doc.fillColor(C.body).font('Helvetica').fontSize(10.5)
      .text(p, M + PAD, cy, { width: CONTENT_W - PAD * 2, lineGap: 2.5 });
    cy = doc.y + 7;
  }

  doc.y = y + alto + 22;
  doc.x = M;
}

// ─── Tarjetas de métrica ──────────────────────────────────────────────────────

export interface Kpi {
  label: string;
  value: string;
  /** Texto chico bajo el valor (comparación con la semana anterior, etc.) */
  hint?: string;
  tone?: 'ok' | 'warn' | 'neutral';
}

export function drawKpiRow(doc: Doc, kpis: Kpi[]): void {
  const GAP = 10;
  const n = kpis.length;
  const w = (CONTENT_W - GAP * (n - 1)) / n;
  const h = 76;
  const y = ensure(doc, h + 22);

  kpis.forEach((k, i) => {
    const x = M + i * (w + GAP);
    const acento = k.tone === 'ok' ? C.ok : k.tone === 'warn' ? C.warn : C.brand;
    doc.roundedRect(x, y, w, h, 8).fill(C.panel);
    doc.rect(x, y, w, 3).fill(acento);

    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(7.5)
      .text(k.label.toUpperCase(), x + 12, y + 15, {
        width: w - 24, characterSpacing: 0.6, lineBreak: false, ellipsis: true,
      });
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(21)
      .text(k.value, x + 12, y + 30, { width: w - 24, lineBreak: false });
    if (k.hint) {
      doc.fillColor(k.tone === 'warn' ? C.warn : k.tone === 'ok' ? C.ok : C.faint)
        .font('Helvetica').fontSize(7.8)
        .text(k.hint, x + 12, y + 57, { width: w - 24, lineBreak: false, ellipsis: true });
    }
  });

  doc.y = y + h + 22;
  doc.x = M;
}

// ─── Gráfico de líneas ────────────────────────────────────────────────────────

export interface SerieLinea {
  labels: string[];
  values: Array<number | null>;
  color: string;
  /** Fuerza el tope del eje (el NPS siempre va a 5, aunque nadie llegue) */
  maxOverride?: number;
  /**
   * Fuerza el piso del eje. Para el NPS es 1, que es el dominio real de la
   * escala: arrancar en 0 aplasta la curva contra el techo y no se ve nada.
   */
  minOverride?: number;
  /** Decimales en las etiquetas del eje */
  decimals?: number;
}

/**
 * Los PDF usan las fuentes base de Helvetica, con codificacion WinAnsi. El
 * signo menos tipografico (U+2212) no existe en esa tabla y sale impreso como
 * una comilla, asi que las variaciones negativas van con guion comun.
 */
export function conSigno(valor: number, texto: string): string {
  return `${valor > 0 ? '+' : valor < 0 ? '-' : ''}${texto}`;
}

/**
 * Línea de evolución dibujada con primitivas vectoriales de pdfkit.
 *
 * Se descartó generar la imagen con una librería de charting (chartjs-node-canvas
 * y similares) porque todas dependen de `canvas`, que compila contra Cairo y
 * Pango: en el contenedor de Railway eso es una dependencia nativa más que puede
 * romper el build, y ya nos pasó una vez con los @types en producción. Además el
 * PNG que producen se rasteriza a 72dpi y se ve borroso impreso o con zoom,
 * mientras que el vector queda nítido a cualquier escala. Para una serie de 8
 * puntos, dibujar los ejes a mano son sesenta líneas y cero riesgo.
 */
export function drawLineChart(
  doc: Doc,
  opts: { x: number; y: number; w: number; h: number; titulo: string; serie: SerieLinea },
): void {
  const { x, y, w, h, titulo, serie } = opts;
  const PAD_L = 30;
  const PAD_B = 18;
  const PAD_T = 24;

  doc.roundedRect(x, y, w, h, 8).fill(C.panel);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9.5)
    .text(titulo, x + 12, y + 10, { width: w - 24, lineBreak: false, ellipsis: true });

  const plotX = x + PAD_L;
  const plotY = y + PAD_T;
  const plotW = w - PAD_L - 14;
  const plotH = h - PAD_T - PAD_B;

  const reales = serie.values.filter((v): v is number => v !== null);
  const min = serie.minOverride ?? 0;
  const max = Math.max(serie.maxOverride ?? 0, ...reales, min + 1);
  const dec = serie.decimals ?? 0;

  // Grilla horizontal + etiquetas del eje
  doc.lineWidth(0.5);
  for (let i = 0; i <= 2; i++) {
    const gy = plotY + (plotH / 2) * i;
    doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).strokeColor(C.rule).stroke();
    const val = max - ((max - min) / 2) * i;
    doc.fillColor(C.faint).font('Helvetica').fontSize(7)
      .text(val.toFixed(dec), x + 6, gy - 3.5, { width: PAD_L - 10, align: 'right' });
  }

  if (reales.length === 0) {
    doc.fillColor(C.faint).font('Helvetica-Oblique').fontSize(8.5)
      .text('Sin datos todavía', plotX, plotY + plotH / 2 - 5, { width: plotW, align: 'center' });
    return;
  }

  const n = serie.values.length;
  // Con un solo punto no hay pendiente: se centra para que no quede pegado al eje
  const px = (i: number) => (n === 1 ? plotX + plotW / 2 : plotX + (plotW / (n - 1)) * i);
  const pyv = (v: number) =>
    plotY + plotH - (Math.min(Math.max(v, min), max) - min) / (max - min) * plotH;

  // Área bajo la curva, sutil, solo sobre los tramos con dato
  const puntos = serie.values
    .map((v, i) => (v === null ? null : { x: px(i), y: pyv(v) }))
    .filter((p): p is { x: number; y: number } => p !== null);

  if (puntos.length > 1) {
    doc.save();
    doc.moveTo(puntos[0].x, plotY + plotH);
    for (const p of puntos) doc.lineTo(p.x, p.y);
    doc.lineTo(puntos[puntos.length - 1].x, plotY + plotH).closePath();
    doc.fillOpacity(0.1).fill(serie.color).fillOpacity(1);
    doc.restore();

    doc.lineWidth(1.8).strokeColor(serie.color);
    doc.moveTo(puntos[0].x, puntos[0].y);
    for (const p of puntos.slice(1)) doc.lineTo(p.x, p.y);
    doc.stroke();
  }

  for (const p of puntos) {
    doc.circle(p.x, p.y, 2.6).fill(serie.color);
  }
  // El último punto se destaca: es el dato de esta semana
  const ult = puntos[puntos.length - 1];
  doc.circle(ult.x, ult.y, 4.2).lineWidth(1.6).strokeColor(serie.color).fill('#FFFFFF');
  doc.circle(ult.x, ult.y, 4.2).lineWidth(1.6).strokeColor(serie.color).stroke();

  // Etiquetas del eje X: se saltean si no entran, para que no se pisen
  const paso = Math.ceil(n / 5);
  serie.labels.forEach((l, i) => {
    if (i % paso !== 0 && i !== n - 1) return;
    doc.fillColor(C.faint).font('Helvetica').fontSize(6.8)
      .text(l, px(i) - 16, plotY + plotH + 6, { width: 32, align: 'center', lineBreak: false });
  });
}

// ─── Barras horizontales ──────────────────────────────────────────────────────

export interface FilaBarra {
  label: string;
  value: number;
  /** Texto de la derecha si no alcanza con el valor crudo (ej. "4.7") */
  valueLabel?: string;
  caption?: string;
  color?: string;
}

export function drawBarList(
  doc: Doc,
  filas: FilaBarra[],
  /** Tope de la escala. Por defecto el mayor valor de la lista. */
  maxOverride?: number,
): void {
  if (filas.length === 0) return;
  const max = Math.max(maxOverride ?? 0, ...filas.map((f) => f.value), 1);
  // Etiqueta ancha: son preguntas de clientes, no rótulos cortos, y cada
  // truncado con "…" es información que el dueño no puede leer
  const LABEL_W = 196;
  const VAL_W = 40;
  const barW = CONTENT_W - LABEL_W - VAL_W - 16;

  for (const f of filas) {
    const y = ensure(doc, f.caption ? 32 : 24);
    // height acotado ademas de lineBreak: sin el, una pregunta larga se parte
    // en dos lineas y pisa la fila de abajo
    doc.fillColor(C.body).font('Helvetica').fontSize(9.5)
      .text(f.label, M, y + 1, { width: LABEL_W, height: 12, lineBreak: false, ellipsis: true });

    doc.roundedRect(M + LABEL_W + 8, y + 2, barW, 9, 4.5).fill(C.rule);
    const ancho = Math.max(4, (f.value / max) * barW);
    doc.roundedRect(M + LABEL_W + 8, y + 2, ancho, 9, 4.5).fill(f.color ?? C.brand);

    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9)
      .text(f.valueLabel ?? String(f.value), M + LABEL_W + barW + 16, y + 1, {
        width: VAL_W, align: 'right',
      });

    if (f.caption) {
      doc.fillColor(C.faint).font('Helvetica').fontSize(7.5)
        .text(f.caption, M, y + 14, { width: LABEL_W, height: 10, lineBreak: false, ellipsis: true });
      doc.y = y + 27;
    } else {
      doc.y = y + 19;
    }
    doc.x = M;
  }
  doc.y += 8;
}

// ─── Pie con numeración ───────────────────────────────────────────────────────

/**
 * Estampa el pie en todas las páginas. Se llama al final, con bufferPages
 * activo: recién ahí se sabe cuántas páginas salieron.
 */
export function stampFooters(doc: Doc, generadoEl: Date): void {
  const rango = doc.bufferedPageRange();
  const total = rango.count;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(rango.start + i);
    // Sin esto pdfkit ve que el texto cae dentro del margen inferior y agrega
    // una pagina por cada pie que se estampa: el documento termina con el
    // doble de hojas, todas vacias salvo el pie.
    doc.page.margins.bottom = 0;
    const y = PAGE.h - 34;
    doc.lineWidth(0.5).moveTo(M, y - 10).lineTo(PAGE.w - M, y - 10).strokeColor(C.rule).stroke();
    doc.fillColor(C.faint).font('Helvetica').fontSize(7.5)
      .text(`BotForge · mibotforge.com · generado el ${fechaLarga(generadoEl)}`, M, y, {
        width: CONTENT_W * 0.7, lineBreak: false,
      });
    doc.fillColor(C.faint).font('Helvetica').fontSize(7.5)
      .text(`Página ${i + 1} de ${total}`, PAGE.w - M - 120, y, { width: 120, align: 'right' });
  }
}
