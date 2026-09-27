/**
 * Crea y consulta la plantilla `aviso_pedido` en la WABA de BotForge.
 *
 *   npm run plantilla:aviso -- --waba <WABA_ID>            crea la plantilla
 *   npm run plantilla:aviso -- --waba <WABA_ID> --estado   solo consulta el estado
 *
 * El WABA no se puede descubrir por API con el token que tenemos: es un System
 * User token cuyos granular_scopes vienen sin target_ids, asi que puede ENVIAR
 * mensajes desde el numero pero no listar cuentas ni negocios. El id se saca a
 * mano de business.facebook.com -> Configuracion del negocio -> Cuentas ->
 * Cuentas de WhatsApp.
 *
 * El token NUNCA se imprime: viaja solo en el header Authorization.
 *
 * El texto de abajo tiene que coincidir letra por letra con
 * docs/07-AVISOS-AL-DUENO.md. Si cambia uno, cambia el otro.
 */
import { env } from '../config/env';
import { PLANTILLA_AVISO, IDIOMA_PLANTILLA } from '../services/avisoWhatsApp';

const GRAPH = 'https://graph.facebook.com/v23.0';

/**
 * El cuerpo. Reglas de Meta que estan metidas en esta forma concreta:
 * no puede empezar ni terminar con una variable (por eso "Hola," al principio
 * y la linea del panel al final), y no puede haber dos variables pegadas.
 */
const CUERPO = `Hola, tenés un {{1}} nuevo en {{2}}.

Qué pidió: {{3}}
Cliente: {{4}}
Contacto: {{5}}

Entrá a tu panel de BotForge para ver la conversación completa y responderle.`;

/** Meta pide un ejemplo por variable para poder revisarla. */
const EJEMPLOS = [
  'pedido',
  'Rotisería Doña Elba',
  '2 milanesas completas con delivery a Cerro Corá 1234, Lambaré — Total: 121.000',
  'Carla Ramírez',
  '0981 555 444',
];

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

interface RespuestaGraph {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

async function graph(
  token: string,
  path: string,
  init?: { method: string; body: unknown },
): Promise<RespuestaGraph> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

/** Las plantillas que ya existen con este nombre, con su estado. */
async function estado(token: string, waba: string): Promise<void> {
  const r = await graph(
    token,
    `/${waba}/message_templates?fields=name,status,category,language,rejected_reason&limit=50`,
  );
  if (!r.ok) {
    console.log(`no se pudieron listar las plantillas (HTTP ${r.status})`);
    console.log('  ' + JSON.stringify(r.body).slice(0, 400));
    return;
  }
  const todas = (r.body.data ?? []) as Array<Record<string, string>>;
  const mias = todas.filter((t) => t.name === PLANTILLA_AVISO);
  console.log(`plantillas en la WABA: ${todas.length} · con el nombre ${PLANTILLA_AVISO}: ${mias.length}`);
  for (const t of mias) {
    console.log(`  ${t.language}  ${t.status}  categoría ${t.category}`);
    if (t.rejected_reason && t.rejected_reason !== 'NONE') {
      console.log(`     motivo del rechazo: ${t.rejected_reason}`);
    }
  }
}

async function main(): Promise<void> {
  const token = process.env.META_WHATSAPP_TOKEN;
  const waba = argumento('waba') ?? env.META_WABA_ID ?? null;

  if (!token) {
    console.log('falta META_WHATSAPP_TOKEN. Corré con: railway run --service botforge- -- ...');
    process.exit(1);
  }
  if (!waba) {
    console.log('falta el WABA: pasalo con --waba <id> o en META_WABA_ID');
    process.exit(1);
  }
  console.log(`token presente (${token.length} chars) · WABA ${waba}\n`);

  if (process.argv.includes('--estado')) {
    await estado(token, waba);
    return;
  }

  console.log(`creando la plantilla ${PLANTILLA_AVISO} (${IDIOMA_PLANTILLA}, UTILITY)...`);
  const r = await graph(token, `/${waba}/message_templates`, {
    method: 'POST',
    body: {
      name: PLANTILLA_AVISO,
      language: IDIOMA_PLANTILLA,
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: CUERPO,
          example: { body_text: [EJEMPLOS] },
        },
      ],
    },
  });

  if (r.ok) {
    console.log('\ncreada.');
    console.log('  ' + JSON.stringify(r.body));
    console.log('\nestado actual:');
    await estado(token, waba);
    console.log('\nPENDING significa que Meta la está revisando. Suele tardar minutos.');
    console.log('Volvé a consultar con: npm run plantilla:aviso -- --waba ' + waba + ' --estado');
    return;
  }

  const err = (r.body.error ?? {}) as Record<string, unknown>;
  console.log(`\nMeta la rechazó (HTTP ${r.status}).`);
  console.log(`  código:  ${String(err.code ?? '?')}`);
  console.log(`  mensaje: ${String(err.message ?? '(sin detalle)')}`);
  if (err.error_user_title) console.log(`  título:  ${String(err.error_user_title)}`);
  if (err.error_user_msg) console.log(`  detalle: ${String(err.error_user_msg)}`);

  // El caso mas probable con este token: puede mandar mensajes pero no
  // administrar la WABA, porque el System User esta asignado al numero y no a
  // la cuenta. Se dice explicito para no perder tiempo buscando en el texto.
  if (r.status === 403 || err.code === 200 || err.code === 10) {
    console.log(
      '\nEsto es permisos, no el texto: el System User no tiene la WABA asignada.\n' +
        'En business.facebook.com -> Usuarios -> Usuarios del sistema, elegí el System User,\n' +
        '"Agregar activos", Cuentas de WhatsApp, y dale Control total.',
    );
  }
  process.exit(1);
}

void main();
