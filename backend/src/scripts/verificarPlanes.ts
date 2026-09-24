/**
 * Compara el catálogo de planes del backend con el del frontend.
 *
 * El frontend no puede importar del backend, así que `frontend/lib/planes.ts`
 * es un espejo manual de `LIMITS` + `PLAN_MONTOS`. Este script es lo que hace
 * que ese espejo no se pueda desincronizar en silencio: corre con
 * `npm run verificar:planes` y sale con código 1 si algún número difiere.
 *
 * El archivo del frontend se carga con un import DINÁMICO y una ruta armada en
 * tiempo de ejecución. Es a propósito: un import estático lo metía dentro del
 * programa de TypeScript del backend, y `tsc` fallaba con TS6059 porque queda
 * fuera de `rootDir`. Eso rompía `npm run build`, o sea el despliegue entero,
 * por un script que ni siquiera se publica.
 */
import { join } from 'path';
import { pathToFileURL } from 'url';
import { catalogoPublico, type PlanPublico } from '../services/planCatalog';

/** Lo que este script necesita de cada plan del frontend. */
interface PlanFront {
  id: string;
  precioGs: number;
  bots: number | null;
  docsPorBot: number | null;
  imagenesPorBot: number | null;
  mensajesPorMes: number;
  whatsapp: boolean;
  nps: boolean;
  informeSemanal: boolean;
  informeConsolidado: boolean;
  asistentePorDia: number;
  pruebaPorDia: number;
}

interface Diferencia {
  plan: string;
  campo: string;
  backend: unknown;
  frontend: unknown;
}

/** Los campos que tienen que coincidir. El texto comercial no entra acá. */
const CAMPOS: Array<keyof PlanPublico & keyof PlanFront> = [
  'precioGs',
  'bots',
  'docsPorBot',
  'imagenesPorBot',
  'mensajesPorMes',
  'whatsapp',
  'nps',
  'informeSemanal',
  'informeConsolidado',
  'asistentePorDia',
  'pruebaPorDia',
];

async function cargarPlanesDelFrontend(): Promise<PlanFront[]> {
  const ruta = join(__dirname, '..', '..', '..', 'frontend', 'lib', 'planes.ts');
  const mod = (await import(pathToFileURL(ruta).href)) as { PLANES?: PlanFront[] };
  if (!Array.isArray(mod.PLANES)) {
    throw new Error(`No se pudo leer PLANES desde ${ruta}`);
  }
  return mod.PLANES;
}

async function main(): Promise<void> {
  const back = catalogoPublico();
  const front = await cargarPlanesDelFrontend();
  const diferencias: Diferencia[] = [];

  for (const b of back) {
    const f = front.find((p) => p.id === b.id);
    if (!f) {
      diferencias.push({ plan: b.id, campo: '(el plan entero)', backend: 'existe', frontend: 'falta' });
      continue;
    }
    for (const campo of CAMPOS) {
      if (b[campo] !== f[campo]) {
        diferencias.push({ plan: b.id, campo, backend: b[campo], frontend: f[campo] });
      }
    }
  }

  for (const f of front) {
    if (!back.some((b) => b.id === f.id)) {
      diferencias.push({ plan: f.id, campo: '(el plan entero)', backend: 'falta', frontend: 'existe' });
    }
  }

  if (diferencias.length === 0) {
    console.log(`Los ${back.length} planes coinciden entre backend y frontend.`);
    return;
  }

  console.error('Los planes NO coinciden. El backend manda: corregí frontend/lib/planes.ts.\n');
  for (const d of diferencias) {
    console.error(
      `  ${d.plan.padEnd(8)} ${d.campo.padEnd(20)} backend=${String(d.backend).padEnd(10)} frontend=${String(d.frontend)}`,
    );
  }
  process.exit(1);
}

void main().catch((err) => {
  console.error('[verificar:planes]', err);
  process.exit(1);
});
