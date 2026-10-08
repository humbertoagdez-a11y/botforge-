# Monitoreo de errores (Sentry)

Está **integrado pero apagado**. Se enciende cargando una variable de entorno.
Sin `SENTRY_DSN` el sistema funciona exactamente igual que antes: los errores
quedan solo en los logs de Railway.

## Cómo activarlo (10 minutos, una sola vez)

### 1. Crear la cuenta

1. Entrá a **https://sentry.io/signup/** y creá una cuenta gratuita (podés usar
   tu cuenta de Google o GitHub).
2. Cuando pregunte por la organización, poné **BotForge**.
3. Al pedirte crear el primer proyecto:
   - **Plataforma**: buscá y elegí **Node.js** → **Express**
   - **Nombre del proyecto**: `botforge-backend`
   - **Alert frequency**: elegí **"Alert me on every new issue"**

### 2. Copiar el DSN

Al terminar de crear el proyecto, Sentry muestra un bloque de código con una
línea así:

```
dsn: "https://a1b2c3d4e5f6@o123456.ingest.us.sentry.io/7890123"
```

**Copiá solo la URL entre comillas.** Eso es el DSN.

Si cerraste esa pantalla: **Settings → Projects → botforge-backend → Client Keys
(DSN)**.

> El DSN no es una clave secreta —está pensado para ser público— pero igual va
> como variable de entorno para poder rotarlo o apagarlo sin tocar código.

### 3. Cargarlo en Railway

1. Entrá a tu proyecto en **railway.app**
2. Elegí el servicio del **backend**
3. Pestaña **Variables** → **+ New Variable**
4. Nombre: `SENTRY_DSN` — Valor: la URL que copiaste
5. Guardá. Railway redespliega solo (~2,5 min)

### 4. Confirmar que quedó activo

```bash
curl https://botforge-production-b16f.up.railway.app/health
```

Esperá a que el `commit` sea el último tuyo. En los logs de Railway tenés que
ver al arrancar:

```
[sentry] monitoreo activo (production)
```

Si en cambio dice `SENTRY_DSN no configurado`, la variable no llegó.

### 5. Probar de punta a punta

Con tu sesión iniciada (sos el primer usuario, así que sos el admin), disparás
un error a propósito:

```bash
curl -X POST https://botforge-production-b16f.up.railway.app/api/v1/dev/probar-monitoreo \
  -H "Authorization: Bearer <tu-token>"
```

En menos de un minuto tiene que aparecer en Sentry un issue llamado
**"Error de prueba disparado a mano"**, con el tag `ambito: prueba-de-monitoreo`.

Si aparece, está todo conectado. Ese endpoint queda disponible para volver a
probar cuando quieras; decime si preferís que lo saque.

### 6. Configurar el email de alerta

Sentry crea una regla por defecto que ya avisa por email en cada issue **nuevo**.
Para revisarla o ajustarla:

**Settings → Alerts → Alert Rules → (la regla por defecto)**

La configuración que conviene:

| Opción | Valor | Por qué |
|---|---|---|
| **When** | `A new issue is created` | Solo la primera vez que aparece un error, no en cada repetición |
| **If** | (sin filtros) | Al principio conviene enterarse de todo |
| **Then** | `Send a notification to Suggested Assignees` → tu email | Es la vía más simple |
| **Action interval** | `30 minutes` | Evita ráfagas si algo falla en loop |

En **Settings → Notifications** confirmá que tu email esté verificado y que
"Issue Alerts" esté en **On**.

> **Importante**: elegí *new issue*, no *every event*. Un bot que falla 200
> veces en una hora te mandaría 200 emails y dejarías de leerlos.

## Cuando la IA deja de responder

Sentry avisa de los errores que revientan. Esto cubre el otro caso, que es
peor: la cuenta de Anthropic deja de funcionar y **nada se rompe**. Los bots
siguen levantados, el webhook sigue contestando 200, y desde afuera se ve
igual que un bot lento.

Pasó de verdad: se acabó el crédito de la API, los bots dejaron de contestar,
al cliente final le llegaba "Hubo un problema, intentá de nuevo" —que además
es un mal consejo, porque reintentar no arregla una cuenta sin saldo— y nadie
se enteró hasta probarlo a mano.

Lo maneja `backend/src/services/alertaIA.ts`. Ante un error de cuenta (sin
crédito, clave inválida, sin permiso):

| | |
|---|---|
| **Al admin** | Email a `ADMIN_EMAIL` **y** WhatsApp a `ADMIN_CELULAR` (por defecto +595981679869) |
| **Al cliente final** | "Perdón, en un momento te respondemos". Va como `isNotice`: no se guarda como mensaje del bot ni se le descuenta el cupo al dueño |
| **En los logs** | `[alerta-ia] LA IA NO RESPONDE`, con el motivo, el bot y el canal |

**Un aviso por incidente, no por mensaje.** Con la cuenta caída cada mensaje
que entra dispara el mismo error; sin deduplicar, el admin recibiría un aviso
por cada cliente que escriba, justo cuando lo último que necesita es que le
tapen la casilla. El incidente se cierra solo cuando una respuesta vuelve a
salir bien. El log, en cambio, sale **siempre**: ahí sí se quiere ver cada
ocurrencia, para saber cuántos clientes quedaron sin respuesta.

La detección vive en el loop del agente y no en el canal, así avisa venga el
mensaje de WhatsApp, del widget o del chat de prueba.

### Qué NO dispara la alerta

Un 429 (rate limit), un 529 (Anthropic saturado) y un `ECONNRESET` se
reintentan solos: no son problemas de la cuenta y no avisan nada.

### La plantilla de WhatsApp

El admin casi nunca va a tener una ventana de 24 horas abierta con el número
—si algo se rompe de madrugada, hace rato que no le escribió— y fuera de esa
ventana Meta solo acepta plantillas aprobadas.

| Dato | Valor |
|---|---|
| Nombre | `alerta_bots_caidos` |
| Id | `1091557877136212` |
| Estado | APPROVED · **UTILITY** |

```
Los bots no están respondiendo.

Motivo: {{1}}
Detectado: {{2}}

Aviso automático generado al detectar la falla.
```

Sin llamado a la acción y sin nombrar el producto, que son las dos cosas que
empujaron a MARKETING las primeras versiones de `aviso_pedido` (el detalle
está en `07-AVISOS-AL-DUENO.md`). Acá la marca además no aporta: el único que
recibe esta alerta es el admin, que sabe de qué sistema se trata.

Si la plantilla no estuviera disponible, la alerta cae a texto libre, que
llega solo con la ventana abierta. El email es la vía que siempre funciona.

Se crea y se consulta con:

```
npm run plantilla:aviso -- --plantilla alerta
npm run plantilla:aviso -- --estado
```

## Límites del plan gratuito

| Recurso | Free (Developer) |
|---|---|
| Errores por mes | **5.000** |
| Usuarios | 1 |
| Retención de datos | ~30 días |
| Alertas por email | ✅ incluidas |
| Costo por exceso | ninguno — al llegar al tope deja de aceptar eventos hasta el mes siguiente |

**Cuándo preocuparse**: 5.000 errores/mes son ~166 por día. Para el volumen
actual sobra. Si te acercás al tope significa que algo está fallando en loop, y
ese es justamente el problema a resolver. El plan Team (50.000 errores) cuesta
USD 26-29/mes; no hace falta hoy.

**Ojo con el tope**: cuando se agota, Sentry **descarta** los eventos nuevos del
mes. Por eso el frontend quedó fuera por ahora (ver abajo).

## Qué se reporta

Automático:
- Excepciones que llegan al final de la cadena de Express
- `unhandledRejection` y `uncaughtException`

Explícito, con `reportarError()` / `reportarAviso()`:

| Ámbito (tag) | Cuándo salta |
|---|---|
| `pagopar-webhook` | Falla el procesamiento de una notificación de pago. Es un cobro que no activó el plan |
| `anthropic-fallback` | El modelo de respaldo también falló: el cliente se queda sin respuesta |
| `tenant-sin-respuesta` | El agente agotó las 5 rondas sin producir texto |
| `meta-mensaje` / `meta-webhook` | Falla el procesamiento de un mensaje de WhatsApp |
| `meta-envio-imagen` / `meta-envio-texto` | No se pudo entregar la respuesta al cliente |
| `drive-buscar-archivo`, `tenant-derivacion` | Fallos de herramientas del bot |
| `proceso` | Promesa rechazada o excepción no capturada |

Podés filtrar por cualquiera de esos en Sentry con `ambito:<nombre>`.

## Qué NO se envía nunca

Verificado interceptando el tráfico real del SDK contra un servidor local (31
verificaciones, cero fallas):

- **Cuerpos de request** — traen passwords, el documento del comprador y los
  mensajes de clientes finales
- **Headers de autenticación** — `Authorization`, `Cookie`, `x-twilio-signature`.
  Es una **lista blanca**: un header nuevo queda afuera por defecto
- **Query strings** — ahí viaja el token de reseteo de contraseña
- **Breadcrumbs de consola y URLs con parámetros** — era la fuga menos obvia:
  el SDK anota cada request HTTP con su query string completa
- **Datos del usuario salvo el id** — nunca email, nombre ni documento

Sí se envía: mensaje del error, stack trace, método y path sin parámetros,
entorno, commit desplegado, y los tags del ámbito. Sin eso el reporte no sirve
para nada.

El filtrado vive en `depurarEvento()` en `backend/src/instrument.ts`.

## El frontend quedó afuera, a propósito

Integrar `@sentry/nextjs` es mecánicamente simple (el `next.config` está vacío),
pero se decidió no hacerlo ahora por tres motivos:

1. **El cupo es compartido.** Los errores de navegador son ruidosos —
   extensiones, bloqueadores, cortes de red. Una racha mala podría quemar los
   5.000 eventos del mes y entonces Sentry **descartaría también los errores del
   backend**, que son los que cuestan plata.
2. **Sin source maps subidos, los stack traces del navegador son ilegibles.**
   Subirlos exige un token extra en el build y lo hace más lento.
3. **`withSentryConfig` toca el build de webpack**, y el build del frontend ya
   tiene un punto frágil conocido (`/apple-icon`).

Está listado como pendiente en `05-PENDIENTES-Y-RIESGOS.md`. El momento de
hacerlo es cuando haya presupuesto para el plan Team, o con un proyecto de
Sentry separado para que el cupo no compita.

## Apagarlo

Borrá la variable `SENTRY_DSN` de Railway. Todo sigue funcionando; los errores
vuelven a quedar solo en los logs.

## Correcciones manuales de métricas

`embudo_diario` es un contador: no guarda los eventos, así que un día no se puede
recalcular. Cuando hubo que corregirlo se restó a mano, en una transacción, y queda
anotado acá.

| Fecha | Qué | Antes → después | Motivo |
|---|---|---|---|
| 2026-10-08 | `sin-dato`: registro, verificado, primer-mensaje, bot | 1, 1, 1, 4 → filas borradas (0) | Las sumó la cuenta de demo "Pet Shop Firulais" (capturas para el video de Meta Ads). Verificado que ninguna otra cuenta sin origen tuvo actividad ese día. La cuenta quedó marcada con `cuentaInterna`, así que no vuelve a sumar. |

Para cuentas de demo o de prueba nuevas: `npm run cuenta:interna -- <email>` **antes** de usarlas.
