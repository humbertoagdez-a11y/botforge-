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
import { PLANTILLA_ALERTA } from '../services/alertaIA';

const GRAPH = 'https://graph.facebook.com/v23.0';

/**
 * Las plantillas que BotForge tiene que tener aprobadas en su WABA.
 *
 * REGLAS DE META que estan metidas en la forma de estos textos, todas
 * aprendidas rebotando:
 *
 * - El cuerpo no puede empezar NI TERMINAR con una variable. Por eso ninguno
 *   arranca con {{1}} y todos cierran con una linea de texto.
 * - Esa linea final es un HECHO, no una invitacion. aviso_pedido v1 cerraba
 *   con "Entra a tu panel de BotForge" y Meta la clasifico MARKETING; v2 le
 *   saco el saludo y la marca pero mantuvo "Entra a tu panel para ver la
 *   conversacion" y quedo MARKETING igual. Recien v3, cerrando con una
 *   constatacion, quedo UTILITY. El disparador era el llamado a la accion.
 * - Marketing no es solo mas caro (unas 5 veces): esta sujeto al tope de
 *   promociones por persona, asi que un aviso real puede no entregarse.
 * - Un parametro no puede ir vacio ni traer saltos de linea (error 132012).
 * - La categoria de una plantilla APROBADA no se puede cambiar: un cambio de
 *   texto significa una version nueva con otro nombre.
 */
interface DefinicionDePlantilla {
  nombre: string;
  cuerpo: string;
  /** Meta pide un ejemplo por variable para poder revisarla */
  ejemplos: string[];
}

const PLANTILLAS: Record<string, DefinicionDePlantilla> = {
  // El aviso de que un cliente final concreto algo
  pedido: {
    nombre: PLANTILLA_AVISO,
    cuerpo: `Nuevo {{1}} recibido en {{2}}.

Detalle: {{3}}
Cliente: {{4}}
Contacto: {{5}}

Aviso automático generado al recibir el mensaje del cliente.`,
    ejemplos: [
      'pedido',
      'Rotisería Doña Elba',
      '2 milanesas completas con delivery a Cerro Corá 1234, Lambaré — Total: 121.000',
      'Carla Ramírez',
      '0981 555 444',
    ],
  },

  // La alerta al admin de que la IA dejo de responder.
  //
  // Sin el nombre del producto a proposito: la marca fue una de las cosas que
  // empujaron aviso_pedido v1 a MARKETING, y aca no hace falta — el unico que
  // recibe esto es el admin, que sabe perfectamente de que sistema se trata.
  alerta: {
    nombre: PLANTILLA_ALERTA,
    cuerpo: `Los bots no están respondiendo.

Motivo: {{1}}
Detectado: {{2}}

Aviso automático generado al detectar la falla.`,
    ejemplos: ['La cuenta de Anthropic se quedó sin crédito', '28/09/2026 10:35'],
  },
};

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
  // Todas las versiones, no solo la que usa el codigo: lo que interesa mirar
  // es cual quedo UTILITY, y esa puede no ser la que esta en uso.
  const mias = todas.filter((t) => t.name.startsWith('aviso_pedido') || t.name.startsWith('alerta_'));
  console.log(`plantillas en la WABA: ${todas.length} · versiones de aviso_pedido: ${mias.length}`);
  for (const t of mias) {
    const enUso =
      t.name === PLANTILLA_AVISO || t.name === PLANTILLA_ALERTA ? '  <- la que usa el codigo' : '';
    console.log(`  ${t.name.padEnd(18)} ${t.language}  ${t.status.padEnd(9)} ${t.category}${enUso}`);
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

  // --plantilla elige cual del registro. --nombre permite probar una version
  // nueva sin que produccion empiece a usarla: recien se cambia la constante
  // del servicio si Meta la deja UTILITY.
  const clave = argumento('plantilla') ?? 'pedido';
  const def = PLANTILLAS[clave];
  if (!def) {
    console.error(`No existe la plantilla "${clave}". Hay: ${Object.keys(PLANTILLAS).join(', ')}`);
    process.exit(1);
  }
  const nombre = argumento('nombre') ?? def.nombre;
  console.log(`creando la plantilla ${nombre} (${IDIOMA_PLANTILLA}, UTILITY)...`);
  console.log(def.cuerpo.split('\n').map((l) => `    ${l}`).join('\n'));
  const r = await graph(token, `/${waba}/message_templates`, {
    method: 'POST',
    body: {
      name: nombre,
      language: IDIOMA_PLANTILLA,
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: def.cuerpo,
          example: { body_text: [def.ejemplos] },
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
