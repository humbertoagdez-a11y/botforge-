import { env } from '../config/env';

/** Busqueda web via Tavily. Best-effort: nunca lanza. */
export async function searchWeb(query: string): Promise<string> {
  if (!env.TAVILY_API_KEY) {
    return 'Búsqueda web no disponible (TAVILY_API_KEY no configurada)';
  }
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        max_results: 3,
        include_answer: true,
        search_depth: 'basic',
      }),
    });
    if (!res.ok) return 'No se pudo completar la búsqueda.';
    const data = (await res.json()) as {
      answer?: string;
      results?: Array<{ title: string; content: string }>;
    };
    if (data.answer) return data.answer;
    return (data.results ?? [])
      .map((r) => `${r.title}: ${r.content}`)
      .join('\n');
  } catch {
    return 'No se pudo completar la búsqueda.';
  }
}
