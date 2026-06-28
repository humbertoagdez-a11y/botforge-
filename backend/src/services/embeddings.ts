import { pipeline } from '@xenova/transformers';

type ExtractorPipeline = Awaited<ReturnType<typeof pipeline>>;

let extractor: ExtractorPipeline | null = null;

async function getExtractor(): Promise<ExtractorPipeline> {
  if (!extractor) {
    console.log('[embeddings] Cargando modelo all-MiniLM-L6-v2 (primera vez puede tardar)...');
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('[embeddings] Modelo listo.');
  }
  return extractor;
}

export async function getEmbedding(text: string): Promise<number[]> {
  const pipe = await getExtractor();
  type EmbedFn = (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;
  const embed = pipe as unknown as EmbedFn;
  const output = await embed(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}
