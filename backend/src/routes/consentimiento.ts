/**
 * Contador anonimo del banner de cookies.
 *
 *   POST /api/v1/consentimiento
 *   { evento: 'mostrado' | 'todas' | 'necesarias' | 'ignorado', conAnuncio: boolean,
 *     dispositivo: 'movil' | 'escritorio', variante: 'actual' | 'nueva', rapida?: boolean }
 *
 * Para saber que parte del trafico del anuncio llega a ver Meta: el pixel solo
 * se carga si la persona toca "Aceptar".
 *
 * No guarda nada que identifique a nadie: ni IP, ni user agent, ni id. Suma
 * uno a un contador del dia y listo. Por eso no necesita consentimiento.
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const router = Router();

const cuerpo = z
  .object({
    evento: z.enum(['mostrado', 'todas', 'necesarias', 'ignorado']),
    conAnuncio: z.boolean(),
    // Opcionales: el banner viejo que siga abierto en alguna pestaña no los manda
    dispositivo: z.enum(['movil', 'escritorio']).optional(),
    variante: z.enum(['actual', 'nueva']).optional(),
    rapida: z.boolean().optional(),
  })
  .strict();

/**
 * Freno propio, mas bajo que el global: este endpoint es publico y lo unico
 * que hace es sumar, asi que quien lo llama mas de unas pocas veces por
 * minuto no es un navegador mostrando un banner.
 */
const limite = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

router.post('/', limite, async (req: Request, res: Response) => {
  // sendBeacon manda text/plain: se acepta el cuerpo como string o como JSON
  let datos: unknown = req.body;
  if (typeof datos === 'string') {
    try {
      datos = JSON.parse(datos);
    } catch {
      datos = null;
    }
  }
  const parsed = cuerpo.safeParse(datos);
  if (!parsed.success) {
    res.status(400).json({ data: null, error: { code: 'INVALIDO', message: 'Evento invalido' }, meta: null });
    return;
  }

  const { evento, conAnuncio, rapida } = parsed.data;
  const dispositivo = parsed.data.dispositivo ?? 'sin_dato';
  const variante = parsed.data.variante ?? 'actual';
  // Una eleccion en menos de 1 s suma ademas a su contador de "rapidas"
  const sumar: Record<string, { increment: number }> = { [evento]: { increment: 1 } };
  if (rapida && evento === 'todas') sumar.todasRapidas = { increment: 1 };
  if (rapida && evento === 'necesarias') sumar.necesariasRapidas = { increment: 1 };
  const crear = Object.fromEntries(Object.entries(sumar).map(([k, v]) => [k, v.increment]));
  // Fecha de Paraguay (UTC-3): un dia que empieza a medianoche de aca
  const fecha = new Date(new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10));

  try {
    await prisma.consentimientoDiario.upsert({
      where: { fecha_conAnuncio_dispositivo_variante: { fecha, conAnuncio, dispositivo, variante } },
      create: { fecha, conAnuncio, dispositivo, variante, ...crear },
      update: sumar,
    });
  } catch (err) {
    // Un contador que falla no puede romperle nada a nadie
    console.error('[consentimiento] no se pudo sumar:', err instanceof Error ? err.message : err);
  }
  res.status(204).end();
});

export default router;
