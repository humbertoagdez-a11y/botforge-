/**
 * Compara el catálogo de planes del backend con el del frontend.
 *
 * El frontend no puede importar del backend, así que `frontend/lib/planes.ts`
 * es un espejo manual de `LIMITS` + `PLAN_MONTOS`. Este script es lo que hace
 * que ese espejo no se pueda desincronizar en silencio: corre con
 * `npm run verificar:planes` y sale con código 1 si algún número difiere.
 *
 * Importa el archivo del frontend directamente (tsx lo compila al vuelo);
 * `planes.ts` no importa nada, así que no arrastra el resto del frontend.
 */
import { catalogoPublico, type PlanPublico } from '../services/planCatalog';
import { PLANES, type Plan as PlanFront } from '../../../frontend/lib/planes';

interface Diferencia {
  plan: string;
  campo: string;
  backend: unknown;
  frontend: unknown;
}

/** Los campos que tienen que coincidir. El texto comercial no entra acá. */
const CAMPOS: Array<[keyof PlanPublico, keyof PlanFront]> = [
  ['precioGs', 'precioGs'],
  ['bots', 'bots'],
  ['docsPorBot', 'docsPorBot'],
  ['imagenesPorBot', 'imagenesPorBot'],
  ['mensajesPorMes', 'mensajesPorMes'],
  ['whatsapp', 'whatsapp'],
  ['nps', 'nps'],
  ['informeSemanal', 'informeSemanal'],
  ['informeConsolidado', 'informeConsolidado'],
  ['asistentePorDia', 'asistentePorDia'],
  ['pruebaPorDia', 'pruebaPorDia'],
];

function main(): void {
  const back = catalogoPublico();
  const diferencias: Diferencia[] = [];

  for (const b of back) {
    const f = PLANES.find((p) => p.id === b.id);
    if (!f) {
      diferencias.push({ plan: b.id, campo: '(el plan entero)', backend: 'existe', frontend: 'falta' });
      continue;
    }
    for (const [campoBack, campoFront] of CAMPOS) {
      const vb = b[campoBack];
      const vf = f[campoFront];
      if (vb !== vf) {
        diferencias.push({ plan: b.id, campo: String(campoBack), backend: vb, frontend: vf });
      }
    }
  }

  for (const f of PLANES) {
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

main();
