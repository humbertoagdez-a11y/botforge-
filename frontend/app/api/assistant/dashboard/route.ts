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
    // Se reenvia el error TAL CUAL lo manda el backend. Antes se reemplazaba
    // por un texto generico, y eso convirtio un 400 de validacion perfectamente
    // legible ("El primer mensaje debe ser del usuario") en un fallo mudo que
    // no habia forma de diagnosticar desde el navegador.
    const crudo = await upstream.text().catch(() => '');
    let cuerpo: unknown = null;
    try {
      cuerpo = crudo ? JSON.parse(crudo) : null;
    } catch {
      cuerpo = null;
    }
    return NextResponse.json(
      cuerpo ?? {
        data: null,
        error: { message: 'El asistente no está disponible en este momento' },
        meta: null,
      },
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
