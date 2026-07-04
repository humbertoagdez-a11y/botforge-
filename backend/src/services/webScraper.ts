import { env } from '../config/env';

/** Scraping de una URL via Firecrawl (markdown). Best-effort: nunca lanza. */
export async function scrapeUrl(url: string): Promise<string> {
  if (!env.FIRECRAWL_API_KEY) {
    return '';
  }
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    });
    if (!res.ok) return '';
    const data = (await res.json()) as { data?: { markdown?: string } };
    const content = data.data?.markdown ?? '';
    return content.slice(0, 50000);
  } catch {
    return '';
  }
}
