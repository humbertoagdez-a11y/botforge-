/**
 * Resultado del A/B del banner de cookies (actual vs nueva), con su
 * incertidumbre.
 *
 *   npm run consentimiento:ab                    desde el arranque del A/B
 *   npm run consentimiento:ab -- --desde 2026-10-10
 *
 * Lee solo el contador anonimo `consentimiento_diario`: sumas por dia, sin
 * nada que identifique a nadie.
 *
 * Reglas para leerlo, acordadas antes de ver un solo numero:
 *
 * - Hasta que cada variante tenga 200 banners mostrados, no hay resultado:
 *   se informa el avance y nada mas.
 * - Una diferencia cuenta como "clara" solo si su intervalo del 95 % no
 *   incluye el cero. Si lo incluye, se dice que no hay diferencia clara, por
 *   mas que una variante vaya adelante.
 * - Si la nueva sube las aceptaciones y ademas sube la proporcion de
 *   aceptaciones en menos de 1 segundo, se avisa: aceptar sin leer es la
 *   señal de un diseño que empuja.
 *
 * Una limitacion del contador: "mostrado" se cuenta al entrar desde afuera del
 * sitio y la eleccion se cuenta donde ocurra. Quien recarga y elige suma una
 * eleccion sin un "mostrado" nuevo, asi que las tasas pueden quedar un poco
 * altas. Afecta igual a las dos variantes.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MINIMO = 200;
const Z95 = 1.96;
/** Primer dia (hora de Paraguay) con las dos variantes repartidas al azar */
const ARRANQUE = '2026-10-03';

interface Suma {
  mostrado: number;
  todas: number;
  necesarias: number;
  ignorado: number;
  todasRapidas: number;
  necesariasRapidas: number;
}

const vacia = (): Suma => ({ mostrado: 0, todas: 0, necesarias: 0, ignorado: 0, todasRapidas: 0, necesariasRapidas: 0 });

/** Intervalo de Wilson al 95 %: se porta bien con pocos casos y tasas cerca de 0 o 1 */
function wilson(exitos: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const p = exitos / n;
  const den = 1 + (Z95 * Z95) / n;
  const centro = (p + (Z95 * Z95) / (2 * n)) / den;
  const margen = (Z95 * Math.sqrt((p * (1 - p)) / n + (Z95 * Z95) / (4 * n * n))) / den;
  return [Math.max(0, centro - margen), Math.min(1, centro + margen)];
}

/** Diferencia de proporciones (b - a) con intervalo de Newcombe (a partir de Wilson) */
function diferencia(xa: number, na: number, xb: number, nb: number): { d: number; ic: [number, number] } {
  const pa = na ? xa / na : 0;
  const pb = nb ? xb / nb : 0;
  const [la, ua] = wilson(xa, na);
  const [lb, ub] = wilson(xb, nb);
  const d = pb - pa;
  return {
    d,
    ic: [d - Math.sqrt((pb - lb) ** 2 + (ua - pa) ** 2), d + Math.sqrt((ub - pb) ** 2 + (pa - la) ** 2)],
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const tasa = (x: number, n: number) => {
  if (n === 0) return 'sin datos';
  const [l, u] = wilson(x, n);
  return `${pct(x / n)}  (${x}/${n}; IC 95 % ${pct(l)} – ${pct(u)})`;
};
const dif = (xa: number, na: number, xb: number, nb: number) => {
  if (!na || !nb) return { texto: 'sin datos', clara: false, d: 0 };
  const { d, ic } = diferencia(xa, na, xb, nb);
  const clara = ic[0] > 0 || ic[1] < 0;
  const signo = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;
  return { texto: `${signo(d)} pts (IC 95 % ${signo(ic[0])} a ${signo(ic[1])})`, clara, d };
};

function bloque(titulo: string, a: Suma, b: Suma): void {
  console.log(`\n── ${titulo} ${'─'.repeat(Math.max(0, 60 - titulo.length))}`);
  for (const [nombre, s] of [['actual', a], ['nueva', b]] as const) {
    console.log(`  ${nombre.toUpperCase()}: ${s.mostrado} banners mostrados`);
    console.log(`    eligió algo         ${tasa(s.todas + s.necesarias, s.mostrado)}`);
    console.log(`    aceptó              ${tasa(s.todas, s.mostrado)}`);
    console.log(`    solo necesarias     ${tasa(s.necesarias, s.mostrado)}`);
    console.log(`    siguió sin elegir   ${tasa(s.ignorado, s.mostrado)}`);
    console.log(`    aceptó en < 1 s     ${tasa(s.todasRapidas, s.todas)}  (de los que aceptaron)`);
  }
  const eligio = dif(a.todas + a.necesarias, a.mostrado, b.todas + b.necesarias, b.mostrado);
  const acepto = dif(a.todas, a.mostrado, b.todas, b.mostrado);
  const rechazo = dif(a.necesarias, a.mostrado, b.necesarias, b.mostrado);
  console.log('  NUEVA – ACTUAL');
  console.log(`    eligió algo         ${eligio.texto}${eligio.clara ? '  ← diferencia clara' : ''}`);
  console.log(`    aceptó              ${acepto.texto}${acepto.clara ? '  ← diferencia clara' : ''}`);
  console.log(`    solo necesarias     ${rechazo.texto}${rechazo.clara ? '  ← diferencia clara' : ''}`);
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--desde');
  const desde = i > 0 ? process.argv[i + 1] : ARRANQUE;

  const filas = await prisma.consentimientoDiario.findMany({ where: { fecha: { gte: new Date(desde) } } });
  const total = { actual: vacia(), nueva: vacia() };
  const porDisp: Record<string, { actual: Suma; nueva: Suma }> = {};
  const porLlegada: Record<string, { actual: Suma; nueva: Suma }> = {};

  for (const f of filas) {
    if (f.variante !== 'actual' && f.variante !== 'nueva') continue;
    const v = f.variante;
    const destinos = [
      total[v],
      (porDisp[f.dispositivo] ??= { actual: vacia(), nueva: vacia() })[v],
      (porLlegada[f.conAnuncio ? 'desde anuncio' : 'directa'] ??= { actual: vacia(), nueva: vacia() })[v],
    ];
    for (const s of destinos) {
      for (const k of Object.keys(s) as (keyof Suma)[]) s[k] += f[k];
    }
  }

  console.log(`A/B del banner de cookies · datos desde ${desde} (hora de Paraguay)`);
  const listo = total.actual.mostrado >= MINIMO && total.nueva.mostrado >= MINIMO;
  console.log(
    `Avance: actual ${total.actual.mostrado}/${MINIMO} · nueva ${total.nueva.mostrado}/${MINIMO} banners mostrados` +
      (listo ? ' · muestra suficiente' : ' · TODAVIA NO HAY RESULTADO: los numeros de abajo son parciales'),
  );

  bloque('Total', total.actual, total.nueva);
  for (const [k, v] of Object.entries(porDisp)) bloque(`Dispositivo: ${k}`, v.actual, v.nueva);
  for (const [k, v] of Object.entries(porLlegada)) bloque(`Llegada: ${k}`, v.actual, v.nueva);

  // Veredicto, solo con muestra suficiente
  console.log('\n── Veredicto ─────────────────────────────────────────────────');
  if (!listo) {
    console.log('  Sin veredicto hasta tener 200 banners por variante.');
  } else {
    const a = total.actual;
    const b = total.nueva;
    const acepto = dif(a.todas, a.mostrado, b.todas, b.mostrado);
    const eligio = dif(a.todas + a.necesarias, a.mostrado, b.todas + b.necesarias, b.mostrado);
    console.log(
      eligio.clara
        ? `  La nueva ${eligio.d > 0 ? 'SUBE' : 'BAJA'} la proporción de gente que elige: ${eligio.texto}.`
        : `  No hay diferencia clara en cuánta gente elige: ${eligio.texto}.`,
    );
    console.log(
      acepto.clara
        ? `  La nueva ${acepto.d > 0 ? 'SUBE' : 'BAJA'} las aceptaciones: ${acepto.texto}.`
        : `  No hay diferencia clara en las aceptaciones: ${acepto.texto}.`,
    );
  }

  // La alarma de "empuja" se mira siempre, aun con muestra chica
  const a = total.actual;
  const b = total.nueva;
  const rapidas = dif(a.todasRapidas, a.todas, b.todasRapidas, b.todas);
  const subeAceptar = b.mostrado && a.mostrado && b.todas / b.mostrado > a.todas / a.mostrado;
  if (subeAceptar && rapidas.d > 0 && (rapidas.clara || (b.todasRapidas >= 10 && rapidas.d >= 0.1))) {
    console.log(`  ⚠ SEÑAL DE QUE EMPUJA: en la nueva sube la proporción de aceptaciones en menos de 1 s (${rapidas.texto}).`);
  } else {
    console.log(`  Aceptaciones en < 1 s, nueva – actual: ${rapidas.texto}. Sin señal de que empuje.`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
