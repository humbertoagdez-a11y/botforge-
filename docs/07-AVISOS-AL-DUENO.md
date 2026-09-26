# Avisos al dueño del negocio

Cuando un cliente final concreta algo —un pedido, un turno, o deja sus datos—
el bot llama a `avisar_pedido` y hay que avisarle al dueño. Este documento es
la plantilla de WhatsApp que hay que aprobar en Meta y lo que se sabe del
costo.

## Por qué WhatsApp y no solo email

Un pedido de rotisería tiene minutos de vida útil. El dueño está en el local,
no mirando el correo. El email queda como red de contención y como canal por
defecto mientras no haya un celular cargado.

## La plantilla que hay que aprobar

Se crea en **WhatsApp Manager → Herramientas de la cuenta → Plantillas de
mensajes → Crear plantilla**, en la WABA de BotForge (no en la del cliente,
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
| `{{3}}` | `2 milanesas completas con delivery a Cerro Corá 1234, Lambaré` |
| `{{4}}` | `Carla Ramírez` |
| `{{5}}` | `0981 555 444` |

Si cambiás una coma del cuerpo, hay que volver a aprobarla y hay que cambiar
`PLANTILLA_AVISO` en `backend/src/services/avisoWhatsApp.ts`.

### Detalles que hacen que Meta la rechace

- **El cuerpo no puede empezar ni terminar con una variable.** Por eso arranca
  con "Hola," y cierra con la línea del panel.
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

## Costo por aviso — PENDIENTE

Lo que se pudo confirmar contra la documentación de Meta el 2026-09-26:

- **Paraguay no tiene tarifa propia.** Entra en el grupo *Rest of Latin
  America*; en la tabla de códigos de país de Meta aparece solo dentro de ese
  grupo, no como mercado con tarjeta propia.
- **Las plantillas de utilidad dentro de una ventana de atención abierta son
  gratis.** Meta las marca `type: free_customer_service`. No aplica a nuestro
  caso normal: el dueño no le escribió al bot, así que no hay ventana abierta
  y el aviso se cobra.

**El número exacto quedó sin confirmar.** Las fuentes de terceros que publican
tarifas por país no listan Paraguay, y la página de precios de Meta muestra la
tarjeta de tarifas de forma interactiva, no en el HTML. No se pone un número
acá para no documentar una cifra inventada.

**Dónde leerlo de verdad:** WhatsApp Manager → Configuración de la cuenta →
Facturación, que muestra la tarjeta de tarifas real de la cuenta, en su moneda.
Ahí está la fila *Utility* para Rest of Latin America.

Para dimensionar el gasto alcanza con multiplicar esa tarifa por la cantidad
de filas en `pedido_avisos` con `canal` que contenga `whatsapp`.
