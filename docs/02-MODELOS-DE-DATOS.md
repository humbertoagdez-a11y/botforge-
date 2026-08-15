# Modelos de datos

Resumen de `backend/prisma/schema.prisma`. No reemplaza al schema: es para
entender qué representa cada tabla sin leer 500 líneas.

## El núcleo

```
User ──< Bot ──< Document ──< Chunk        (chunk = fragmento vectorizado en Pinecone)
          │
          ├──< Conversation ──< Message
          ├──< BotImage                     (fotos que el bot manda por WhatsApp)
          ├──< NpsResponse / NpsPrompt
          └──< WeeklyReport

User ──< PagoparOrder
     └──< ConsolidatedReport                (cuelga del usuario, no de un bot)
```

## User

La cuenta del dueño del negocio. Todo cuelga de acá.

| Campo | Qué significa |
|---|---|
| `plan` | El plan **contratado**. Para saber qué puede hacer hoy hay que pasarlo por `effectivePlan()` — ver `03-DECISIONES-CLAVE.md` |
| `planExpiresAt` | Cuándo vence. `null` en FREE. Pasada esa fecha vale FREE aunque `plan` diga otra cosa |
| `emailVerified` | Sin esto no hay sesión: el registro no devuelve tokens hasta confirmar el código |
| `documento` | CI o RUC. Pagopar lo exige para cobrar; se pide recién en el primer checkout, no al registrarse |
| `messagesUsedThisMonth` / `messagesResetAt` | Cupo de mensajes de **clientes reales** |
| `assistantMsgs*` / `assistantReset*` | Cupo del asistente del panel (mensual y diario) |
| `testMsgs*` / `testReset*` | Cupo del **Chat de prueba**, separado del de clientes a propósito |
| `dailySummaryEnabled` | Si quiere el email de las 21:00 |

## Bot

Un chatbot. Un usuario puede tener varios según el plan.

| Campo | Qué significa |
|---|---|
| `personality` | El instructivo del dueño. Es lo que le da voz al bot y va en el bloque cacheado del prompt |
| `whatsappNumber` | Número del **cliente**, clave de ruteo del flujo Twilio (apagado) |
| `metaPhoneNumberId` | Id del **número de negocio** que recibe los mensajes. Es la clave de ruteo de Meta. Separado del anterior a propósito, para poder volver a Twilio sin perder el vínculo |
| `npsEnabled` | Encuesta de satisfacción. Apagada por defecto: nadie empieza a encuestar a sus clientes sin decidirlo |
| `isActive` | Un bot pausado no responde |

## Document y Chunk

`Document` es un archivo que subió el dueño (PDF, Word, Excel, TXT).
`Chunk` es un fragmento suyo, ya vectorizado.

| Campo | Qué significa |
|---|---|
| `Document.status` | `PENDING` → `PROCESSING` → `READY` / `ERROR`. Un bot sin ningún documento `READY` no responde |
| `Document.filePath` | Ruta local. En Railway el disco es efímero, por eso también se sube a Cloudinary |
| `Document.url` | URL en Cloudinary. Es la copia que sobrevive a un redeploy |
| `Chunk.pineconeId` | Id del vector en Pinecone. Es lo que permite borrarlo cuando se borra el documento |

## BotImage

Imagen que el dueño sube para que el bot se la mande a los clientes.

Es un modelo **aparte de Document**, no una extensión: un documento existe para
ser troceado, embebido y buscado por similitud, y nada de eso aplica a una foto.

| Campo | Qué significa |
|---|---|
| `description` | **El campo que decide todo.** Es lo que el modelo lee para elegir cuándo mandar esta imagen. Sin una buena descripción, el bot nunca la elige |
| `url` | Cloudinary. Meta descarga la imagen de ahí, no se re-sube al enviarla |
| `publicId` | Id de Cloudinary, para borrar el archivo cuando se borra la fila |

## Conversation y Message

Un hilo con un cliente final, y sus mensajes.

| Campo | Qué significa |
|---|---|
| `Conversation.channelId` | Clave estable del cliente: `whatsapp:+595...`, `web-<userId>-<uuid>` o `widget-<uuid>`. Único junto con `botId` |
| `Conversation.channel` | `whatsapp`, `web` (Chat de prueba) o `widget` |
| `Message.role` | `USER` o `ASSISTANT` |
| `Message.tokensUsed` | Tokens de esa respuesta, para medir costo |

## NpsResponse y NpsPrompt

| Modelo | Qué representa |
|---|---|
| `NpsResponse` | La calificación que dio un cliente. `score` va de **1 a 5** (no 0-10: por WhatsApp es más fácil). `sentiment` se deriva del score. `reviewed` lo marca el dueño |
| `NpsPrompt` | A quién ya se le preguntó, **aunque no haya contestado**. Es lo único que impide volver a molestar al mismo cliente antes de 30 días |

## WeeklyReport y ConsolidatedReport

| Modelo | Qué representa |
|---|---|
| `WeeklyReport` | Informe de **un bot** en una semana. `content` es JSON estructurado, calculado con queries — nunca redactado por IA. `weekStart` es el lunes 00:00 de Paraguay guardado en UTC |
| `ConsolidatedReport` | Informe de **Agencia** que compara todos los bots del usuario. Cuelga de `userId`, no de un bot: borrar un bot no debe borrar la comparación histórica |

## PagoparOrder

Una intención de pago.

| Campo | Qué significa |
|---|---|
| `hashPedido` | Identificador que devuelve Pagopar. **Es la clave con la que se busca el pedido** al llegar la notificación |
| `idPedidoComercio` | Nuestro identificador, el que viaja en la firma |
| `pagado` | Lo marca el webhook tras validar la firma, o la consulta al volver del checkout |
| `formaPago` / `numeroComprobante` | Datos del cobro que informa Pagopar. Se persisten para conciliar ante un reclamo |

## SupportTicket

| Campo | Qué significa |
|---|---|
| `ref` | Número corto legible tipo `BF-1042`, para que el cliente lo cite |
| `context` | Snapshot del estado de la cuenta al abrir el ticket. **Lo arma el backend leyendo la base, nunca el modelo** |

## Los demás

| Modelo | Para qué |
|---|---|
| `PlatformAssistantMessage` | Historial del asistente del panel, para que no se pierda al recargar |
| `RefreshToken` | Sesiones activas (cookie httpOnly) |
| `EmailVerificationCode` | Código de 6 dígitos del registro |
| `PasswordResetToken` | Token de recuperación. Se genera con `crypto.randomBytes`, nunca uuid |
| `WhatsAppConnection` | Código `BF-XXXXXX` del onboarding de WhatsApp, con su vencimiento |
| `NotificationConfig` | A qué email avisar por evento (`human_requested`, `new_conversation`, `daily_summary`) |
| `DriveConnection` | Tokens OAuth de Google Drive. La integración está oculta al usuario |
