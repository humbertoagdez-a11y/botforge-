/**
 * Embudo por origen: cuanta gente llega desde cada anuncio y hasta donde
 * avanza, sin depender del pixel ni del consentimiento de cookies.
 *
 * Todo es un contador por dia (`embudo_diario`). No se guarda IP, ni user
 * agent, ni fbclid, ni ningun identificador de persona o de dispositivo. Lo
 * unico que queda en una cuenta es `users.origenRegistro`, la etiqueta corta
 * del origen, para que los pasos posteriores al registro sumen donde
 * corresponde.
 *
 * Los pasos que pasan despues del registro (verificar, crear bot, ...) suman
 * en el dia en que ocurren y con el origen de la cuenta, pero sin campaña ni
 * anuncio: guardar esos datos en la cuenta seria guardar el utm.
 */
import { prisma } from '../lib/prisma';

export const ORIGENES = ['meta-anuncio-web', 'meta-anuncio-whatsapp', 'directo', 'otro'] as const;
export type Origen = (typeof ORIGENES)[number];

export const PASOS = [
  'visita',
  'registro',
  'verificado',
  'bot',
  'primer-mensaje',
  'whatsapp',
  'pago-iniciado',
  'pagado',
] as const;
export type Paso = (typeof PASOS)[number];

/** Cuentas sin origen: registradas antes de que esto existiera */
export const SIN_DATO = 'sin-dato';

/**
 * Etiqueta de campaña o de anuncio: minusculas, solo [a-z0-9._-], hasta 60
 * caracteres. Llega desde la URL, o sea que cualquiera la puede escribir:
 * normalizarla evita basura y textos largos en la tabla.
 */
export function etiqueta(valor: string | null | undefined): string {
  if (!valor) return '';
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Hoy en Paraguay (UTC-3), como en el contador del banner */
function hoy(): Date {
  return new Date(new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10));
}

interface Suma {
  tipo: Paso;
  origen: string;
  campana?: string;
  anuncio?: string;
  pagina?: string;
}

/** Suma uno. Nunca lanza: un contador no puede romperle nada a nadie. */
export async function sumarEmbudo(s: Suma): Promise<void> {
  const clave = {
    fecha: hoy(),
    origen: s.origen,
    campana: s.campana ?? '',
    anuncio: s.anuncio ?? '',
    pagina: s.pagina ?? '',
    tipo: s.tipo,
  };
  try {
    await prisma.embudoDiario.upsert({
      where: { fecha_origen_campana_anuncio_pagina_tipo: clave },
      create: { ...clave, cantidad: 1 },
      update: { cantidad: { increment: 1 } },
    });
  } catch (err) {
    console.error('[embudo] no se pudo sumar:', err instanceof Error ? err.message : err);
  }
}

/** Suma un paso posterior al registro con el origen guardado en la cuenta */
export async function sumarPasoDeUsuario(userId: string, tipo: Paso): Promise<void> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { origenRegistro: true } });
    await sumarEmbudo({ tipo, origen: u?.origenRegistro ?? SIN_DATO });
  } catch (err) {
    console.error('[embudo] no se pudo sumar el paso:', err instanceof Error ? err.message : err);
  }
}
