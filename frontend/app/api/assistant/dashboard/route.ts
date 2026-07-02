import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'https://botforge-production-b16f.up.railway.app';

// Proxy autenticado: reenvia el Authorization header del usuario al backend
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth) {
    return NextResponse.json(
      { data: null, error: { message: 'No autenticado' }, meta: null },
      { status: 401 },
    );
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json(
      { data: null, error: { message: 'Cuerpo de la solicitud inválido' }, meta: null },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/api/v1/assistant/dashboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body,
      signal: req.signal,
    });
  } catch {
    return NextResponse.json(
      { data: null, error: { message: 'No se pudo contactar al asistente' }, meta: null },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { data: null, error: { message: 'El asistente no está disponible en este momento' }, meta: null },
      { status: upstream.status || 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
