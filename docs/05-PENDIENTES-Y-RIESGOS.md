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
