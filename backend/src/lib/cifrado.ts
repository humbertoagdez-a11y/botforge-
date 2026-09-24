/**
 * Cifrado en reposo de las credenciales de terceros que guardamos.
 *
 * Hoy `Bot.metaBusinessToken` y `Bot.metaRegistrationPin` viven en texto plano
 * en Postgres. El token es la credencial del negocio DEL CLIENTE: con él se
 * pueden leer y enviar mensajes de su WhatsApp. Un volcado de la base, un
 * backup mal guardado o un acceso de solo lectura alcanzan para llevárselo.
 *
 * Cómo está pensado para poder activarlo sin ventana de corte:
 *
 * - Sin `TOKEN_ENCRYPTION_KEY` cargada, cifrar() devuelve el valor tal cual y
 *   descifrar() también. El comportamiento es EXACTAMENTE el de hoy, así que
 *   desplegar esto no cambia nada ni pone en riesgo a los bots conectados.
 * - Con la clave cargada, lo que se escriba de ahí en adelante se guarda
 *   cifrado, y descifrar() sigue leyendo bien las filas viejas en texto plano
 *   porque las reconoce por el prefijo. No hace falta migrar nada de golpe:
 *   cada bot queda cifrado la próxima vez que reconecta.
 * - Si la clave se pierde, los valores cifrados no se recuperan. El cliente
 *   tiene que reconectar su WhatsApp. Por eso la clave va guardada donde se
 *   guardan las otras: en las variables de Railway, y anotada aparte.
 *
 * AES-256-GCM y no AES-CBC: GCM viene con autenticación incluida, así que una
 * fila manipulada falla al descifrar en vez de devolver basura silenciosa.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../config/env';

/** Marca de formato. Si algún día cambia el algoritmo, cambia el prefijo. */
const PREFIJO = 'v1';
const ALGORITMO = 'aes-256-gcm';
/** 12 bytes es el tamaño de IV recomendado para GCM. */
const IV_BYTES = 12;
const CLAVE_HEX_LARGO = 64; // 32 bytes

let claveCache: Buffer | null | undefined;

/**
 * La clave, o null si no está configurada.
 *
 * Una clave con formato inválido es un error de configuración, no algo para
 * ignorar: se avisa fuerte y se sigue sin cifrar, que es el estado anterior.
 * Arrancar sin poder descifrar sería peor que no cifrar.
 */
function clave(): Buffer | null {
  if (claveCache !== undefined) return claveCache;

  const bruta = env.TOKEN_ENCRYPTION_KEY.trim();
  if (!bruta) {
    claveCache = null;
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(bruta)) {
    console.error(
      `[cifrado] TOKEN_ENCRYPTION_KEY tiene que ser ${CLAVE_HEX_LARGO} caracteres hexadecimales ` +
        `(32 bytes). Llegó algo de ${bruta.length}. Se sigue SIN cifrar.`,
    );
    claveCache = null;
    return null;
  }
  claveCache = Buffer.from(bruta, 'hex');
  return claveCache;
}

/** ¿Está activo el cifrado en este entorno? Lo usa el log de arranque. */
export function cifradoActivo(): boolean {
  return clave() !== null;
}

/** ¿Este valor ya está cifrado por nosotros? */
export function estaCifrado(valor: string): boolean {
  return valor.startsWith(`${PREFIJO}:`);
}

/**
 * Devuelve el valor listo para guardar en la base.
 * Sin clave configurada, lo devuelve igual: el estado de hoy.
 */
export function cifrar(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const k = clave();
  if (!k) return valor;
  // Ya viene cifrado: no encadenar capas
  if (estaCifrado(valor)) return valor;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITMO, k, iv);
  const datos = Buffer.concat([cipher.update(valor, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIJO}:${iv.toString('hex')}:${tag.toString('hex')}:${datos.toString('hex')}`;
}

/**
 * Devuelve el valor usable.
 *
 * Un valor sin prefijo es una fila vieja en texto plano y se devuelve tal
 * cual: eso es lo que permite activar el cifrado sin migrar la base.
 *
 * Nunca lanza. Si un valor cifrado no se puede abrir —clave rotada, fila
 * manipulada— devuelve null: sin token, tokenDelBot() cae al global y el
 * panel muestra el bot como desconectado, que es un fallo visible y
 * reparable. Lanzar tiraría abajo el webhook de un mensaje entrante.
 */
export function descifrar(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (!estaCifrado(valor)) return valor;

  const k = clave();
  if (!k) {
    console.error('[cifrado] hay valores cifrados en la base pero no está TOKEN_ENCRYPTION_KEY');
    return null;
  }

  const partes = valor.split(':');
  if (partes.length !== 4) {
    console.error('[cifrado] valor con formato inesperado');
    return null;
  }
  const [, ivHex, tagHex, datosHex] = partes;

  try {
    const decipher = createDecipheriv(ALGORITMO, k, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const abierto = Buffer.concat([
      decipher.update(Buffer.from(datosHex, 'hex')),
      decipher.final(),
    ]);
    return abierto.toString('utf8');
  } catch {
    // Nunca se loguea el valor, ni cifrado ni en claro
    console.error('[cifrado] no se pudo descifrar un valor guardado');
    return null;
  }
}
