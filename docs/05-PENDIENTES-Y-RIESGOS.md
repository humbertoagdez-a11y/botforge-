# Pendientes y riesgos

Lo que se sabe que falta. Nada de esto bloquea el lanzamiento; están ordenados
por relación valor/esfuerzo.

> Consolidado de la auditoría de pre-lanzamiento del 2026-08-15, más lo que
> quedó explícitamente sin resolver en sesiones anteriores. Revisado en la
> auditoría previa a la venta del 2026-09-23.

## Pendientes

| # | Qué | Por qué importa | Esfuerzo |
|---|---|---|---|
| 1 | **Sentry en el frontend** | El backend ya está integrado (ver `06-MONITOREO.md`). Falta el lado del cliente: errores de React y fetch fallidos. Se postergó porque el cupo gratuito es compartido y los errores de navegador podrían quemarlo, dejando sin alertas al backend | Mediano |
| ~~2~~ | ~~**Arreglar `/apple-icon`**~~ | **Resuelto el 2026-09-23.** Se reemplazó la ruta dinámica de `@vercel/og` por un PNG estático en `app/apple-icon.png`, con el mismo dibujo. El build del frontend vuelve a terminar sin errores | — |
| 3 | **Índice en `messages(conversationId, createdAt)`** | El informe semanal y el historial filtran por eso constantemente. Con volumen se va a notar | Chico |
| 4 | **Zona horaria de `fechaPago` de Pagopar** | Pagopar manda la fecha sin zona (`"2026-08-16 22:50:00"`) y se parsea como hora local del servidor. En Railway (UTC) queda ~4h corrida respecto de Paraguay. Solo afecta conciliación, no el cobro ni la activación | Chico |
| 5 | **Rotación del Chat de prueba** | El historial crece sin techo por conversación. Hoy solo se leen los últimos 10 mensajes, pero la fila sigue engordando | Chico |
| 6 | **Reintento con backoff para Resend** | Un email fallido es best-effort y se pierde. Para verificación de cuenta y recuperación de contraseña, perderlo **bloquea al usuario** | Mediano |
| ~~7~~ | ~~**Sincronizar límites de planes por endpoint**~~ | **Resuelto el 2026-09-23.** Eran siete espejos manuales, no cuatro. Ahora hay una sola fuente por lado: `services/planCatalog.ts` (deriva de `LIMITS` + `PLAN_MONTOS`, sin números a mano) y `frontend/lib/planes.ts`. `npm run verificar:planes` compara los once campos de cada plan y sale con código 1 si difieren | — |
| 8 | **Tests automatizados de los caminos críticos** | Todo lo verificado en las últimas sesiones fue con scripts temporales que se borraron. Auth, pago y límites deberían tener tests permanentes en Jest | Grande |

## Lo que se corrigió en la auditoría del 2026-09-23

Queda anotado para no volver a auditarlo, y porque cada uno explica por qué el
código quedó como quedó.

| Qué era | Por qué importaba | Dónde |
|---|---|---|
| **CSRF por cookie** | Las cookies salen con `SameSite=None` (frontend y backend en dominios distintos) y `requireAuth` las aceptaba antes que el header. Con `express.urlencoded` global, un formulario oculto en cualquier sitio hacía un POST simple —sin preflight, lo único que CORS habría frenado— y la cookie viajaba igual | `middleware/auth.ts`: la cookie solo vale en GET/HEAD/OPTIONS |
| **Inyección de HTML en los emails** | Ninguna plantilla escapaba. El mensaje de un cliente de WhatsApp, el comentario de una encuesta, el asunto de un ticket y las preguntas que el bot no supo responder llegaban crudos a un email con remitente de BotForge que lee el dueño del negocio. Phishing contra el cliente | `escaparHtml()` en `services/email.ts`, aplicado en las ocho plantillas |
| **Widget público sin techo propio** | Único endpoint que llama a Anthropic sin sesión, y cada respuesta descuenta del cupo del dueño. El `botId` viaja en el HTML de cualquier página donde esté embebido | `widgetPorVisitante` y `widgetPorBot` en `middleware/rateLimit.ts` |
| **Asistente de la landing sin tope de gasto** | El historial lo manda entero el cliente: 40 × 2000 = 40.000 caracteres de input por request, 20 por minuto, sin techo horario | `routes/assistant.ts`: 20 mensajes, 12.000 caracteres, límite por hora |
| **WhatsApp seguía andando con el plan vencido** | `checkWhatsAppAccess` solo corre al CONECTAR. Después, un plan vencido caía a FREE y el bot seguía atendiendo con los 100 mensajes de Free, para siempre | `services/inboundMessage.ts` mira `effectivePlan()` en cada mensaje |
| **Sin detección de acceso revocado** | Si el cliente sacaba el permiso desde Meta, los envíos rebotaban y el panel seguía diciendo "WhatsApp conectado" | `ErrorEnvioMeta` distingue credencial muerta de fallo pasajero; marca `REVOCADO` y el panel lo muestra |
| **Desconectar dejaba rastro** | Solo limpiaba `whatsappNumber` y `metaPhoneNumberId`: quedaban el token del cliente, el wabaId, el PIN y `metaEstado` en ACTIVO | `DELETE /connect` limpia las ocho columnas |
| **Textos del flujo viejo** | El prompt del asistente explicaba conectar WhatsApp "mandando el código BF-XXXXXX al número de Twilio"; el bloque "Cómo funciona" le decía a todos que atendían desde el número de BotForge (H-7) | `platformAgent.ts`, `assistant.ts`, `WhatsAppOnboarding.tsx` |
| **Pestañas invisibles en móvil** | A 375px entraban 2 de las 7 pestañas del bot. Las otras 5 —incluida WhatsApp— eran alcanzables por scroll pero sin ninguna señal de que existieran | Degradado en el borde y pestaña activa a la vista, en `ui/tabs.tsx` |
| **Subir documento verificaba pertenencia tarde** | `checkDocLimit` contaba los documentos de un bot ajeno y multer escribía el archivo antes del 403, dejándolo huérfano | `requireOwnedBot` antes de todo, en `routes/documents.ts` |

## Riesgos conocidos

**El caché del bot tenant probablemente no está acertando.** El prefijo
cacheable es de ~566 a ~924 tokens y el mínimo de Anthropic en Sonnet es 1024.
No cuesta plata (no cobra recargo si no cachea), pero el ahorro esperado no está
ocurriendo. Confirmable en los logs `[cache] tenant` de producción. Ver
`03-DECISIONES-CLAVE.md` §2.

**El agrupado de preguntas del informe es por texto, no por significado.**
"cuánto sale el sillón" y "qué precio tiene el sillón" cuentan como dos
preguntas distintas. Agrupar por similitud pediría un embedding por mensaje, que
es caro para un informe semanal. Si los tops se ven fragmentados en producción,
ese es el motivo.

**No hay débito automático.** Cada mes el usuario tiene que volver a pagar. El
cron de las 03:00 avisa antes de vencer y degrada después.

**El router OAuth de Google sigue montado.** No es alcanzable desde ningún
botón, pero responde si alguien conoce la URL. No se desmontó para no romper a
usuarios que ya tengan Drive conectado y necesiten refrescar el token.

**Las páginas legales todavía describen Google Drive.** Decisión deliberada: una
política de privacidad divulga un tratamiento de datos, no promete un beneficio,
y puede haber usuarios con una carpeta conectada. Revisar si se desmonta la
integración del todo.

**Las credenciales de terceros siguen en texto plano.** `Bot.metaBusinessToken`
y `Bot.metaRegistrationPin` se guardan sin cifrar. El cifrado ya está escrito
(`lib/cifrado.ts`, AES-256-GCM) y aplicado en los dos puntos donde se escribe y
se lee, pero queda **apagado** hasta que se cargue `TOKEN_ENCRYPTION_KEY` en
Railway: 64 caracteres hexadecimales, que se generan con
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
Sin la variable el comportamiento es idéntico al de hoy. Al cargarla, lo nuevo
queda cifrado y las filas viejas se siguen leyendo, así que no hay que migrar
nada de golpe. Si la clave se pierde, cada cliente tiene que reconectar su
WhatsApp.

**Pagopar no verifica el monto pagado.** `activarPlan` confía en el campo
`pagado` de la notificación y no compara `monto` contra `order.montoTotal`. La
firma liga la notificación al pedido, así que el monto no lo elige el
comprador; el hueco sería un pago parcial que Pagopar reporte como pagado. No
se tocó porque cualquier cambio acá es cambio en el flujo de pagos.

**Next.js 14.2.35 tiene un aviso crítico sin aplicar.** `npm audit` marca
DoS por el Image Optimizer y deserialización de peticiones HTTP, y aplica
porque el frontend es self-hosted en Railway. El fix es `next@16`, un salto
mayor que merece su propia sesión con pruebas completas: cambia el App Router,
los defaults de caché y el build. Atenuante: `next.config.mjs` está vacío, sin
`remotePatterns`, lo que limita una de las variantes. Pendiente desde el
2026-09-20.

**`xlsx` (SheetJS) no tiene parche y procesa archivos que suben los usuarios.**
Prototype pollution y ReDoS, `fixAvailable: false` desde hace meses porque el
proyecto dejó de publicar en npm y sólo distribuye desde su propio CDN. Es la
vulnerabilidad de mayor exposición real del backend: entra por
`documents.ts`, con archivos de terceros. Las opciones evaluadas el
2026-09-20:

- **Migrar a `exceljs`**: mantenido, sin avisos abiertos. Costo real: sólo se
  usa para extraer texto de las hojas, así que es reescribir una función de
  lectura, no una integración entera. Estimado: media sesión, más una prueba
  con cada tipo de archivo que ya subieron los usuarios.
- **Instalar `xlsx` desde el CDN de SheetJS** (`https://cdn.sheetjs.com/`), que
  sí recibe parches. Es un cambio de una línea en `package.json`, pero saca la
  dependencia del registro de npm y complica auditar y reproducir el build.
- **Dejarlo y aislar**: validar tamaño y extensión antes de parsear. No cierra
  el agujero, sólo lo angosta.

La recomendación es `exceljs`, pero sin decidirlo todavía.

**Ocho avisos de `npm audit` cuelgan de `@xenova/transformers`.** Incluye uno
crítico en `protobufjs`. No se pueden resolver: el "fix" que propone npm es
bajar a `@xenova/transformers@1.4.2`, que es una versión anterior y rompería
los embeddings del RAG (`all-MiniLM-L6-v2`, dimensión 384). La librería se usa
de verdad, en `services/embeddings.ts`. Queda esperando que el upstream
actualice sus dependencias.

## Verificación de Meta para múltiples clientes de WhatsApp

> Estado al 2026-08-31. **Ninguno de estos pasos se completa desde el código.**
> Son trámites manuales en `developers.facebook.com` y `business.facebook.com`.
> Esta sección existe para no perder el hilo entre sesiones.

### El problema de fondo

La plataforma tiene **un solo número de WhatsApp** (+595 991 820602, el de
BotForge) y todos los bots lo comparten. El commit `1464380` arregló el síntoma
más grave —los mensajes salían desde el número global en vez del número del bot—
pero la causa de fondo sigue: **no hay forma de que un segundo cliente conecte su
propio número**. `Bot.metaPhoneNumberId` es `@unique`, así que el segundo intento
choca contra el primero.

La salida es **Embedded Signup**: el flujo oficial de Meta donde cada cliente da
de alta su propio número, con su propia WABA, desde un popup dentro del panel de
BotForge. La investigación completa está en la sesión del 2026-08-31; el
resumen técnico es que el ruteo de entrada (`metaWhatsapp.ts`, búsqueda por
`metaPhoneNumberId`) **ya funciona para múltiples números sin cambios**, y lo que
falta es el alta y algunos campos nuevos en `Bot`.

Pero antes del código hay una fila de trámites de Meta, y ese es el camino
crítico.

### La secuencia, en orden

Cada paso depende del anterior. No se pueden adelantar.

| # | Paso | Estado al 2026-08-31 | Notas |
|---|---|---|---|
| 1 | **Business Verification** | **EN REVISIÓN** — enviado el 2026-08-31, ~2 días hábiles | Verifica que el negocio existe, con documentación |
| 2 | **Access Verification** | NO INICIADO | Depende de que se apruebe el paso 1 |
| 3 | **Convertirse en Tech Provider** | NO INICIADO | ⚠️ **IRREVERSIBLE** |
| 4 | **App Review** | NO INICIADO | ⚠️ **NO SE PUEDE EDITAR NI CANCELAR** una vez enviada |

### Las dos advertencias que importan

**Tech Provider es irreversible.** Una vez aceptado el rol no se puede volver
atrás. Implica revisiones periódicas y requisitos de seguridad de datos más
estrictos, porque pasás a operar credenciales y datos de terceros. No es un
casillero más: es un cambio de categoría de la cuenta.

**La App Review no se puede editar ni cancelar una vez enviada.** Y no revisa
solo el permiso que pedís: **revisa la app entera** — el ícono, el nombre
visible, la configuración, la URL de política de privacidad y la URL de
eliminación de datos. Si se envía con algo a medias, hay que esperar el rechazo
para poder corregir. Por eso el checklist de abajo va **antes** de enviar.

### Checklist previo a enviar la App Review

Todo esto tiene que estar listo y verificado antes de tocar "enviar":

| Requisito | Estado | Dónde |
|---|---|---|
| URL de política de privacidad | ✅ existe | `/privacidad` |
| URL de eliminación de datos | ✅ existe | `/eliminar-datos` |
| Ícono de la app | ⏳ **a confirmar a mano** | panel de Meta → Configuración básica |
| Nombre visible de la app | ⏳ **a confirmar a mano** | panel de Meta → Configuración básica |
| Advanced Access de `whatsapp_business_management` | ⏳ a confirmar | panel → App Review → Permissions |
| Advanced Access de `whatsapp_business_messaging` | ⏳ a confirmar | panel → App Review → Permissions |

Los dos ⏳ del ícono y el nombre no se pueden verificar desde el código ni desde
la API: hay que mirarlos en el panel.

### Límites que dependen de esto

- **Sin Business Verification**: 2 números por portfolio y **10 clientes nuevos
  cada 7 días**.
- **Con Business Verification + Access Verification + App Review**: hasta 20
  números y **200 clientes nuevos cada 7 días**.

El número actual está en `TIER_250` (250 destinatarios únicos por 24h) y con
`is_official_business_account: false`, lo que es coherente con una cuenta que
todavía no completó la verificación.

### Costos

Meta no cobra por dar de alta números ni por usar Cloud API. Se paga por mensaje
(modelo vigente desde el 2025-07-01). Para el caso de BotForge casi todo cae en
la categoría *service*, que es gratis: el bot responde a clientes que escribieron
primero. Lo que sí se paga son los mensajes proactivos fuera de la ventana de
24h — **revisar cuándo dispara `npsDispatch`**, porque una encuesta enviada
tarde es un template pago.

## Cosas que ya se verificaron y NO son riesgo

Para no volver a auditarlas sin motivo:

- **Pertenencia de recursos**: los 30+ endpoints con `:id`/`:botId` y las ~20
  herramientas del asistente verifican dueño. Auditado el 2026-08-15.
- **Llamadas externas sin proteger**: ninguna puede tumbar el proceso ni
  devolver un 502 crudo. Los tres call sites del agente están envueltos, y
  `processDocument` marca el documento como `ERROR`.
- **Validación de variables de entorno**: `env.ts` sale con `exit(1)` listando
  los campos inválidos al arrancar.
- **Circuito de pago de Pagopar**: probado end-to-end contra Postgres real.
- **Prompt caching**: verificado byte a byte después de todos los cambios.
