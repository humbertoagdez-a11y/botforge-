# Avisos al dueño del negocio

Cuando un cliente final concreta algo —un pedido, un turno, o deja sus datos—
el bot llama a `avisar_pedido` y hay que avisarle al dueño. Este documento es
la plantilla de WhatsApp que hay que aprobar en Meta y lo que se sabe del
costo.

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
| `aviso_pedido` | `964341106027336` | APPROVED | **MARKETING** | La original: "Hola, tenés un {{1}} nuevo en {{2}} … Entrá a tu panel de BotForge" |
| `aviso_pedido_v2` | `2079337949615232` | APPROVED | **MARKETING** | Sin saludo y sin la marca, pero seguía cerrando con "Entrá a tu panel para ver la conversación y responder" |
| `aviso_pedido_v3` | `2442074942982481` | ver abajo | ver abajo | Sin nada que parezca llamado a la acción: cierra con "Aviso automático generado al recibir el mensaje del cliente" |

`PLANTILLA_AVISO` en `backend/src/services/avisoWhatsApp.ts` dice cuál se usa.

### Por qué importa que quede UTILITY

No es solo el precio. Un mensaje de marketing:

- **cuesta unas cinco veces más** (ver el costo más abajo);
- está sujeto al **tope de mensajes de marketing** que Meta le aplica a cada
  persona, así que un aviso de un pedido real puede no entregarse sin que
  nadie avise;
- el destinatario puede **darse de baja de marketing** y cortarse sus propios
  avisos de pedido sin darse cuenta.

Por eso, mientras `PLANTILLA_ES_MARKETING` esté en `true`, el aviso sale
**además por email siempre**, aunque el dueño haya elegido solo WhatsApp. El
email cuesta cero y cubre el hueco. Cuando alguna versión quede UTILITY se
pone esa bandera en `false` y el aviso vuelve a respetar lo que el dueño eligió.

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
| **Nombre** | `aviso_pedido` |
| **Categoría** | Utilidad (*Utility*) |
| **Idioma** | Español (`es`) |
| **Encabezado** | ninguno |
| **Pie** | ninguno |
| **Botones** | ninguno |

**Cuerpo**, exactamente este texto:

```
Hola, tenés un {{1}} nuevo en {{2}}.

Qué pidió: {{3}}
Cliente: {{4}}
Contacto: {{5}}

Entrá a tu panel de BotForge para ver la conversación completa y responderle.
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

O sea: con la plantilla clasificada como MARKETING, cada aviso cuesta unas
**cinco veces** lo que costaría como UTILITY. A 100 pedidos por mes son USD 6,18
en vez de USD 1,20 — poco en plata, pero la diferencia real no es esa sino el
tope de marketing, que puede impedir que el mensaje llegue.

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
