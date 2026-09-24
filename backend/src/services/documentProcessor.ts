import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';

const CHUNK_WORDS = 380;
const OVERLAP_WORDS = 38;

export interface TextChunk {
  content: string;
  tokenCount: number;
  chunkIndex: number;
}

/**
 * Solo para pruebas: deja comparar la extraccion contra la implementacion
 * anterior sin tener que procesar y trocear un documento entero.
 */
export const extractTextForTest = (buffer: Buffer, mimeType: string): Promise<string> =>
  extractText(buffer, mimeType);

async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  ) {
    return extraerDeExcel(buffer);
  }

  return buffer.toString('utf-8');
}

// ─── Excel ────────────────────────────────────────────────────────────────────
// Se migro de `xlsx` (SheetJS) a `exceljs` el 2026-09-24. SheetJS arrastra
// prototype pollution y ReDoS sin parche desde hace meses —`fixAvailable: false`,
// porque el proyecto dejo de publicar en npm— y era la dependencia con mas
// exposicion real del backend: entra por aca, con archivos que suben los
// usuarios. exceljs esta mantenido y no tiene avisos abiertos.
//
// El formato de salida se mantiene identico a proposito: los documentos ya
// procesados quedaron troceados con ese texto, y cambiarlo haria que los chunks
// viejos y los nuevos del mismo bot no se parezcan entre si.

/** Un .xlsx es un ZIP; un .xls viejo es un contenedor OLE2. */
const FIRMA_OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const FIRMA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Texto visible de una celda.
 *
 * exceljs devuelve el valor tipado, no el texto: una formula viene como
 * `{ formula, result }`, un link como `{ text, hyperlink }` y una celda con
 * formato mixto como `{ richText: [...] }`. Lo que le sirve al RAG es siempre lo
 * que la persona ve en la pantalla.
 */
function textoDeCelda(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'object') {
    if ('richText' in valor) return valor.richText.map((t) => t.text).join('');
    if ('text' in valor) return String(valor.text);
    if ('result' in valor) return valor.result === undefined ? '' : String(valor.result);
    if ('error' in valor) return String(valor.error);
  }
  return String(valor);
}

/** Comillas solo cuando hacen falta, como en cualquier CSV. */
function campoCsv(texto: string): string {
  if (!/[",\n\r]/.test(texto)) return texto;
  return `"${texto.replace(/"/g, '""')}"`;
}

async function extraerDeExcel(buffer: Buffer): Promise<string> {
  // El mimetype `application/vnd.ms-excel` lo mandan tanto los .xls viejos como,
  // segun el navegador, algunos .csv. Se decide por los bytes, no por lo que
  // diga el cliente.
  if (buffer.subarray(0, 8).equals(FIRMA_OLE2)) {
    throw new Error(
      'Ese archivo es un Excel en formato viejo (.xls). Abrilo en Excel o en Google ' +
        'Sheets, guardalo como .xlsx y subilo de nuevo.',
    );
  }
  if (!buffer.subarray(0, 4).equals(FIRMA_ZIP)) {
    // No es un .xlsx: es un CSV o un texto con el mimetype de Excel
    return buffer.toString('utf-8');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const hojas: string[] = [];
  workbook.eachSheet((hoja) => {
    const filas: string[] = [];
    // rowCount y columnCount son el rango usado, igual que el de SheetJS
    for (let f = 1; f <= hoja.rowCount; f++) {
      const fila = hoja.getRow(f);
      const celdas: string[] = [];
      for (let c = 1; c <= hoja.columnCount; c++) {
        celdas.push(campoCsv(textoDeCelda(fila.getCell(c).value)));
      }
      filas.push(celdas.join(','));
    }
    hojas.push(`=== Hoja: ${hoja.name} ===\n${filas.join('\n')}`);
  });

  return hojas.join('\n\n');
}

function chunkText(text: string): TextChunk[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const chunks: TextChunk[] = [];
  let i = 0;

  while (i < words.length) {
    const chunkWords = words.slice(i, i + CHUNK_WORDS);
    const content = chunkWords.join(' ');
    chunks.push({
      content,
      tokenCount: Math.ceil(content.length / 4),
      chunkIndex: chunks.length,
    });
    if (i + CHUNK_WORDS >= words.length) break;
    i += CHUNK_WORDS - OVERLAP_WORDS;
  }

  return chunks;
}

export async function extractAndChunk(buffer: Buffer, mimeType: string): Promise<TextChunk[]> {
  const raw = await extractText(buffer, mimeType);
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('El documento no contiene texto extraíble');
  return chunkText(cleaned);
}
