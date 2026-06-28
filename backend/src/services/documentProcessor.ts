import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const CHUNK_WORDS = 380;
const OVERLAP_WORDS = 38;

export interface TextChunk {
  content: string;
  tokenCount: number;
  chunkIndex: number;
}

async function extractText(filePath: string, mimeType: string): Promise<string> {
  const buffer = await fs.readFile(filePath);

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
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      return `=== Hoja: ${name} ===\n${XLSX.utils.sheet_to_csv(sheet)}`;
    }).join('\n\n');
  }

  return buffer.toString('utf-8');
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

export async function extractAndChunk(filePath: string, mimeType: string): Promise<TextChunk[]> {
  const raw = await extractText(filePath, mimeType);
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('El documento no contiene texto extraíble');
  return chunkText(cleaned);
}
