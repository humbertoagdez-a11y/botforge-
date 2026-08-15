# Documentación de BotForge

Punto de entrada. Leé esto primero y andá al documento que necesites.

| Documento | Qué tiene | Cuándo leerlo |
|---|---|---|
| [01-ARQUITECTURA.md](01-ARQUITECTURA.md) | Qué es BotForge, los dos agentes, el flujo de un mensaje de WhatsApp, servicios externos y stack | Primera vez que tocás el proyecto, o cuando no sabés dónde vive algo |
| [02-MODELOS-DE-DATOS.md](02-MODELOS-DE-DATOS.md) | Qué representa cada tabla, sus relaciones y los campos cuyo nombre no alcanza | Antes de escribir una query o tocar el schema |
| [03-DECISIONES-CLAVE.md](03-DECISIONES-CLAVE.md) | Por qué el código es como es. Cada decisión con el problema que evitaba | **El más importante.** Antes de "mejorar" algo que parece raro |
| [04-PLANES-Y-LIMITES.md](04-PLANES-Y-LIMITES.md) | Qué incluye cada plan y dónde se aplica cada límite | Al tocar precios, cupos o cualquier feature con gate por plan |
| [05-PENDIENTES-Y-RIESGOS.md](05-PENDIENTES-Y-RIESGOS.md) | Lo que se sabe que falta, con esfuerzo estimado | Al planificar qué hacer después |

## Reglas que no se rompen

Están explicadas en `03-DECISIONES-CLAVE.md`, pero se repiten acá porque son
las que más caro salen:

1. **`effectivePlan(user)`, nunca `user.plan`** para leer límites. Un plan pago
   vencido vale FREE.
2. **Verificar pertenencia** en todo endpoint que reciba un `:id` o `:botId`.
3. **No romper el prompt caching**: nada variable entra al bloque estable.
4. **Cero llamadas a IA en los informes semanales**. Son queries y reglas.

## Nota sobre `ARCHITECTURE.md` (raíz)

Existe un `ARCHITECTURE.md` en la raíz del 2026-07-04. Quedó desactualizado:
es anterior a Pagopar, verificación de email, tickets, prompt caching, NPS,
informes semanales e imágenes. **Esta carpeta lo reemplaza.** Se conserva como
registro histórico, no como referencia.
