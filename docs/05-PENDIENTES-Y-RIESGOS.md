# Pendientes y riesgos

Lo que se sabe que falta. Nada de esto bloquea el lanzamiento; están ordenados
por relación valor/esfuerzo.

> Consolidado de la auditoría de pre-lanzamiento del 2026-08-15, más lo que
> quedó explícitamente sin resolver en sesiones anteriores.

## Pendientes

| # | Qué | Por qué importa | Esfuerzo |
|---|---|---|---|
| 1 | **Sentry en el frontend** | El backend ya está integrado (ver `06-MONITOREO.md`). Falta el lado del cliente: errores de React y fetch fallidos. Se postergó porque el cupo gratuito es compartido y los errores de navegador podrían quemarlo, dejando sin alertas al backend | Mediano |
| 2 | **Arreglar `/apple-icon`** | Falla en cada build desde el 2026-07-20 (`@vercel/og`, `TypeError: Invalid URL`). No bloquea el deploy, pero ensucia el output y esconde fallos nuevos | Chico |
| 3 | **Índice en `messages(conversationId, createdAt)`** | El informe semanal y el historial filtran por eso constantemente. Con volumen se va a notar | Chico |
| 4 | **Zona horaria de `fechaPago` de Pagopar** | Pagopar manda la fecha sin zona (`"2026-08-16 22:50:00"`) y se parsea como hora local del servidor. En Railway (UTC) queda ~4h corrida respecto de Paraguay. Solo afecta conciliación, no el cobro ni la activación | Chico |
| 5 | **Rotación del Chat de prueba** | El historial crece sin techo por conversación. Hoy solo se leen los últimos 10 mensajes, pero la fila sigue engordando | Chico |
| 6 | **Reintento con backoff para Resend** | Un email fallido es best-effort y se pierde. Para verificación de cuenta y recuperación de contraseña, perderlo **bloquea al usuario** | Mediano |
| 7 | **Sincronizar límites de planes por endpoint** | Pricing, landing y términos son espejos manuales de `planLimits.ts`. Un cambio de límite exige tocar 4 archivos y es fácil olvidarse de uno | Mediano |
| 8 | **Tests automatizados de los caminos críticos** | Todo lo verificado en las últimas sesiones fue con scripts temporales que se borraron. Auth, pago y límites deberían tener tests permanentes en Jest | Grande |

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
