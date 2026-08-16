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
