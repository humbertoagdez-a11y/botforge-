# Avisos al dueño del negocio

Cuando un cliente final concreta algo —un pedido, un turno, o deja sus datos—
el bot llama a `avisar_pedido` y hay que avisarle al dueño. Este documento es
la plantilla de WhatsApp que hay que aprobar en Meta y lo que se sabe del
costo.

## Las dos líneas de BotForge

Desde el 2026-09-27 los dos números propios tienen roles separados:

| Número | Bot | Rol |
|---|---|---|
| **+595992199207** | `225e2778` — "BotForge — Ventas" | Línea comercial. Recibe el tráfico de los anuncios Click-to-WhatsApp. |
| **+595991820602** | `dbab8033` — "BotForge — Avisos" | Manda los avisos de pedidos. **No vende**: se le saca `marcar_lead` por `BOT_AVISOS_ID`. |

La línea de avisos reconoce a un dueño registrado por su número, contra
`Bot.avisoCelular` — el único identificador telefónico que existe, porque
`User` guarda email y no teléfono. A quien no reconoce lo deriva a ventas.

## Por qué WhatsApp y no solo email

Un pedido de rotisería tiene minutos de vida útil. El dueño está en el local,
no mirando el correo. El email queda como red de contención y como canal por
defecto mientras no haya un celular cargado.

## Los ids que hacen falta

| Dato | Valor | Dónde vive |
|---|---|---|
| WABA de BotForge | `1988990908418096` | `META_WABA_ID` en Railway |
| Número que envía | `+595 991 820602` | `META_PHONE_NUMBER_ID` |
| Plantilla creada | `964341106027336` | la WABA de arriba |

El WABA **no se puede descubrir por API** con el token que tenemos:
`/me/businesses` necesita `business_management`, que Meta retiró. Crear y
consultar plantillas solo necesita `whatsapp_business_management`, que el
System User sí tiene. Por eso el id se carga a mano en `META_WABA_ID`; el
webhook también lo loguea (`entry[].id`) como red de contención.

## Qué versión usa el código y por qué

Meta clasifica las plantillas sola, y puede cambiarte la categoría que pediste.
Lo hace **antes de aprobar**: la categoría que muestra una plantilla en
`PENDING` ya es la que va a quedar.

| Versión | Id | Estado | Categoría | Qué cambió |
|---|---|---|---|---|
| `aviso_pedido` | `964341106027336` | **borrada** | MARKETING | La original: "Hola, tenés un {{1}} nuevo en {{2}} … Entrá a tu panel de BotForge" |
| `aviso_pedido_v2` | `2079337949615232` | **borrada** | MARKETING | Sin saludo y sin la marca, pero seguía cerrando con "Entrá a tu panel para ver la conversación y responder" |
| `aviso_pedido_v3` | `2442074942982481` | APPROVED | **UTILITY** ✅ | Sin nada que parezca llamado a la acción: cierra con "Aviso automático generado al recibir el mensaje del cliente" |

Las dos primeras se borraron de la WABA una vez que v3 quedó aprobada
(`DELETE /{waba_id}/message_templates?name=...`). Se dejan en esta tabla
porque lo que enseñan —qué texto dispara la reclasificación— es justamente
lo que hay que recordar antes de tocar el cuerpo.

**El disparador era el llamado a la acción, no la marca.** v2 ya no decía
"Hola" ni nombraba a BotForge y quedó MARKETING igual; lo único que le quedaba
era mandar al panel. Sacar esa línea alcanzó. Antes de "mejorar" este texto:
cualquier frase que invite a hacer algo lo devuelve a marketing.

Otra cosa aprendida: **la categoría que muestra una plantilla en `PENDING` no
es definitiva.** v1 estuvo en `PENDING / UTILITY` y se aprobó como MARKETING.
v2 mostró MARKETING ya en `PENDING`. O sea que ver UTILITY mientras está
pendiente no garantiza nada; hay que esperar a `APPROVED`.

`PLANTILLA_AVISO` en `backend/src/services/avisoWhatsApp.ts` dice cuál se usa.

### Por qué importa que quede UTILITY

No es solo el precio. Un mensaje de marketing:

- **cuesta unas cinco veces más** (ver el costo más abajo);
- está sujeto al **tope de mensajes de marketing** que Meta le aplica a cada
  persona, así que un aviso de un pedido real puede no entregarse sin que
  nadie avise;
- el destinatario puede **darse de baja de marketing** y cortarse sus propios
  avisos de pedido sin darse cuenta.

Por eso existe `PLANTILLA_ES_MARKETING`: mientras esté en `true`, el aviso sale
**además por email siempre**, aunque el dueño haya elegido solo WhatsApp.

Hoy está en `false`, porque v3 quedó UTILITY y no tiene ese tope: el aviso
respeta lo que el dueño eligió. Si alguna vez hay que volver a una plantilla
de marketing, se vuelve a poner en `true`.

### La apelación

La categoría de una plantilla **aprobada** no se puede cambiar por API:
responde `error_subcode 3835031`, *"No puedes actualizar una categoría de
plantilla aprobada"*. La única vía es apelar, y **solo se puede desde WhatsApp
Manager**, dentro de los 60 días del cambio de categoría:

> Message Templates → Message Template Category Updates → seleccionar la
> plantilla → **Request Review**

El caso es defendible: el texto no tiene nada promocional, ni ofertas, ni
upsell, y el aviso es crítico para la operación del negocio.

## La plantilla que hay que aprobar

Se crea sola con `npm run plantilla:aviso -- --waba 1988990908418096`, que la
manda por API con este mismo texto. Con `--estado` se consulta en qué quedó.
También se puede a mano en **WhatsApp Manager → Herramientas de la cuenta →
Plantillas de mensajes**, siempre en la WABA de BotForge (no en la del cliente,
ver más abajo por qué).

| Campo | Valor |
|---|---|
| **Nombre** | `aviso_pedido_v3` |
| **Categoría** | Utilidad (*Utility*) |
| **Idioma** | Español (`es`) |
| **Encabezado** | ninguno |
| **Pie** | ninguno |
| **Botones** | ninguno |

**Cuerpo**, exactamente este texto:

```
Nuevo {{1}} recibido en {{2}}.

Detalle: {{3}}
Cliente: {{4}}
Contacto: {{5}}

Aviso automático generado al recibir el mensaje del cliente.
```

**Ejemplos** que Meta pide para aprobar (los pide para cada variable):

| Variable | Ejemplo |
|---|---|
| `{{1}}` | `pedido` |
| `{{2}}` | `Rotisería Doña Elba` |
| `{{3}}` | `2 milanesas completas con delivery a Cerro Corá 1234, Lambaré — Total: 121.000` |
| `{{4}}` | `Carla Ramírez` |
| `{{5}}` | `0981 555 444` |

Si cambiás una coma del cuerpo, hay que volver a aprobarla y hay que cambiar
`PLANTILLA_AVISO` en `backend/src/services/avisoWhatsApp.ts`.

### Detalles que hacen que Meta la rechace

- **El cuerpo no puede empezar ni terminar con una variable.** Por eso arranca
  con "Hola," y cierra con la línea del panel.
- **El total viaja dentro de `{{3}}`**, no como una variable propia. Cuantos
  menos parámetros tenga la plantilla, más simple es la aprobación, y el total
  no siempre existe: un turno o unos datos de contacto no tienen total.
- **Un parámetro no puede ir vacío, ni traer saltos de línea, tabs, ni más de
  cuatro espacios seguidos** (error 132012). El resumen lo escribe el modelo y
  perfectamente puede traer un salto de línea, así que
  `limpiarParametro()` en `metaMessaging.ts` lo aplasta antes de mandarlo, y
  los datos que el cliente no dejó salen como "no lo dijo".

## Por qué sale del número de BotForge y no del número del cliente

Una plantilla solo existe dentro de la WABA que la aprobó. Si el aviso saliera
del número propio de cada bot conectado por Embedded Signup, **cada cliente
tendría que aprobar esta plantilla en su propia cuenta de Meta** antes de
recibir un solo aviso — y la mayoría no lo haría nunca. Saliendo del número de
BotForge se aprueba una vez y funciona para todos los bots.

## Mientras no esté aprobada

No hay que hacer nada. Meta responde con un código `132xxx` (la plantilla no
existe, está pausada o deshabilitada), `avisoWhatsApp.ts` lo reconoce y el
aviso sale por email. El `PedidoAviso` guarda en `canal` por dónde salió de
verdad, así que ante un "no me llegó" se puede distinguir entre "se intentó
WhatsApp y cayó a email" y "no salió nada".

## Costo por aviso

**Paraguay no tiene tarifa propia**: entra en el grupo *Rest of Latin America*,
confirmado en la tabla de códigos de país de la documentación de Meta. Comparte
tier con Argentina.

Tarifas de ese grupo (fuentes de terceros, ver abajo):

| Categoría | Por mensaje | Relación |
|---|---|---|
| Utility | USD 0,0120 | — |
| Authentication | USD 0,0220 | 1,8× |
| **Marketing** | **USD 0,0618** | **5,15×** |

La plantilla en uso (v3) es **UTILITY**, así que aplica la primera fila: unos
USD 0,0120 por aviso, o sea USD 1,20 cada 100 pedidos. Con las versiones
anteriores, clasificadas como MARKETING, hubiera sido USD 6,18 — poco en plata,
pero la diferencia real no era esa sino el tope de marketing, que puede impedir
que el mensaje llegue.

**Las plantillas de utilidad dentro de una ventana de atención abierta son
gratis** (Meta las marca `type: free_customer_service`). No aplica a nuestro
caso: el dueño no le escribió al bot, así que no hay ventana abierta.

### Qué tan firmes son estas cifras

Medianamente. Lo confirmado contra la documentación de Meta es la pertenencia
de Paraguay a *Rest of Latin America* y que la tarifa la determina el país del
que **recibe**. Los números salen de publicaciones de terceros que documentan
ese tier —ninguna lista Paraguay por nombre—, porque Meta muestra la tarjeta
de tarifas de forma interactiva y no en el HTML. Además esa fuente todavía las
describe "por conversación de 24 horas", que es el modelo anterior al cobro por
mensaje que rige desde el 2025-07-01.

**La cifra de verdad** está en WhatsApp Manager → Configuración de la cuenta →
Facturación, con la tarjeta real de la cuenta y en su moneda.

Para dimensionar el gasto: multiplicar esa tarifa por las filas de
`pedido_avisos` cuyo `canal` contenga `whatsapp`.
