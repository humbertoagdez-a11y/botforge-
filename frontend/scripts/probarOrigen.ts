/**
 * Prueba de clasificarOrigen (lib/origen.ts). Sin dependencias: node:assert.
 *
 *   ../backend/node_modules/.bin/tsx scripts/probarOrigen.ts
 *
 * El frontend no tiene framework de tests y esto no justifica sumar uno.
 */
import assert from 'node:assert/strict';
import { clasificarOrigen } from '../lib/origen';

const CAMPANA = '120260357049340456';
let fallas = 0;

function caso(nombre: string, search: string, referrerExterno: boolean, esperado: string): void {
  const { origen } = clasificarOrigen(search, referrerExterno);
  try {
    assert.equal(origen, esperado);
    console.log(`OK     ${nombre} → ${origen}`);
  } catch {
    fallas++;
    console.log(`FALLA  ${nombre} → ${origen} (esperaba ${esperado})`);
  }
}

/** Que NO caiga en cierta etiqueta, sin fijar cual le toca */
function noEs(nombre: string, search: string, referrerExterno: boolean, prohibido: string): void {
  const { origen } = clasificarOrigen(search, referrerExterno);
  if (origen !== prohibido) {
    console.log(`OK     ${nombre} → ${origen} (no es ${prohibido})`);
  } else {
    fallas++;
    console.log(`FALLA  ${nombre} → ${origen}`);
  }
}

// Mismo id de campaña de Meta, tres utm_source distintos: siempre Meta web
caso('utm_source=fb + campaña Meta', `?utm_source=fb&utm_campaign=${CAMPANA}`, false, 'meta-anuncio-web');
caso('utm_source=ig + campaña Meta', `?utm_source=ig&utm_campaign=${CAMPANA}`, false, 'meta-anuncio-web');
caso('utm_source desconocido + campaña Meta', `?utm_source=xyz_desconocido&utm_campaign=${CAMPANA}`, true, 'meta-anuncio-web');
caso('id de campaña + utm_source desconocido (con fbclid)', `?utm_source=an&utm_campaign=${CAMPANA}&fbclid=AbC123`, false, 'meta-anuncio-web');

// fbclid SIN id de campaña: Facebook lo pone tambien en clics organicos, no
// alcanza para atribuirle la visita al anuncio
noEs('fbclid sin utm_campaign', '?fbclid=AbC123', false, 'meta-anuncio-web');
caso('fbclid sin utm_campaign, sin referrer', '?fbclid=AbC123', false, 'otro');
noEs('fbclid + utm_source=whatsapp, sin campaña', '?utm_source=whatsapp&fbclid=AbC123', false, 'meta-anuncio-web');
noEs('fbclid + campaña con nombre (no id)', '?fbclid=AbC123&utm_campaign=octubre', true, 'meta-anuncio-web');

// Sin campaña de Meta ni fbclid: igual que antes
caso('utm_source desconocido, sin campaña', '?utm_source=newsletter', false, 'otro');
caso('campaña con nombre (no id) + fuente desconocida', '?utm_source=newsletter&utm_campaign=octubre', false, 'otro');
caso('sin nada, referrer externo', '', true, 'otro');
caso('sin nada, sin referrer', '', false, 'directo');
caso('link del bot de ventas', '?utm_source=whatsapp&utm_medium=bot', false, 'meta-anuncio-whatsapp');
caso('utm_source=meta (URL recomendada)', '?utm_source=meta&utm_medium=cpc&utm_campaign=botforge-30-09', false, 'meta-anuncio-web');

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exitCode = fallas ? 1 : 0;
