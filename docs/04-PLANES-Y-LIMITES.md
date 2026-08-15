# Planes y límites

> **Generado a partir de `backend/src/middleware/planLimits.ts` el 2026-08-15.**
> Si algo acá no coincide con el código, **el código manda**. Esa constante
> `LIMITS` es la única fuente de verdad.

## La tabla

| Límite | FREE | BÁSICO | PROFESIONAL | AGENCIA |
|---|---|---|---|---|
| **Precio** | Gs. 0 | Gs. 150.000 | Gs. 350.000 | Gs. 750.000 |
| `bots` | 1 | 1 | 5 | ilimitados |
| `docsPerBot` | 3 | 10 | 50 | ilimitados |
| `imagesPerBot` | 0 | 8 | 30 | ilimitadas |
| `monthlyMessages` | 100 | 1.000 | 4.000 | 10.000 |
| `whatsapp` | ❌ | ✅ | ✅ | ✅ |
| `nps` | ❌ | ✅ | ✅ | ✅ |
| `weeklyReports` | ❌ | ❌ | ✅ | ✅ |
| `consolidatedReports` | ❌ | ❌ | ❌ | ✅ |
| `assistantMonthly` | 10 | 100 | 300 | 800 |
| `assistantDaily` | 5 | 15 | 40 | 100 |
| `testMonthly` | 60 | 300 | 900 | 2.500 |
| `testDaily` | 25 | 60 | 150 | 400 |

Los precios no están en `planLimits.ts` — viven en la página de precios y en la
landing. Ver la nota del final.

## Qué significa cada uno

| Campo | Qué es |
|---|---|
| `bots` | Bots que puede crear |
| `docsPerBot` | Documentos de entrenamiento por bot |
| `imagesPerBot` | Fotos que el bot puede mandarle a los clientes. **0 en Free porque Free tampoco tiene WhatsApp**: no habría canal por donde enviarlas |
| `monthlyMessages` | Mensajes de **clientes reales** (WhatsApp + widget) |
| `whatsapp` | Si puede conectar un número de WhatsApp Business |
| `nps` | Encuesta de satisfacción al cliente final |
| `weeklyReports` | Informe semanal de **cada** bot activo, no de uno solo |
| `consolidatedReports` | Informe que compara todos los bots entre sí. Exclusivo de Agencia |
| `assistantMonthly` / `assistantDaily` | Cupo del asistente del panel. Doble tope: el mensual acota el costo, el diario evita quemarlo en una tarde |
| `testMonthly` / `testDaily` | Cupo del Chat de prueba, **separado** del de clientes reales |

## Reglas transversales

**El plan vigente no siempre es el contratado.** `effectivePlan(user)` devuelve
`FREE` si `planExpiresAt` ya pasó. Todo chequeo de límite debe pasar por ahí.

**El "día" es el día calendario de Paraguay** (UTC-4). Si se usara UTC, el cupo
diario se renovaría a las 20:00 hora local, que para el usuario no significa
nada.

**Un pago cubre 30 días.** No hay débito automático: el usuario repite el pago
cada mes.

## Dónde se aplica cada límite

| Límite | Archivo |
|---|---|
| `bots` | `middleware/planLimits.ts` (`checkBotLimit`) + `assistantDashboard.ts` (`create_new_bot`) |
| `docsPerBot` | `checkDocLimit`, `services/knowledge.ts`, `assistantDashboard.ts` (`upload_instructivo_text`, `scrape_website`) |
| `imagesPerBot` | `routes/images.ts` |
| `monthlyMessages` | `assertMessageLimit` en `services/inboundMessage.ts` y `routes/public.ts` |
| `whatsapp` | `checkWhatsAppAccess` |
| `nps` | `routes/bots.ts` (PATCH, al activar `npsEnabled`) |
| `weeklyReports` / `consolidatedReports` | `routes/reports.ts` + `services/weeklyReportDispatch.ts` |
| cupos de asistente | `checkAssistantLimit` / `incrementAssistantUsage` |
| cupos de prueba | `assertTestChatLimit` / `incrementTestChatUsage` |

## Los precios están duplicados en tres lugares

El frontend no puede importar del backend, así que estos archivos son espejos
manuales de `planLimits.ts` y hay que moverlos juntos:

- `frontend/app/(dashboard)/pricing/page.tsx`
- `frontend/app/page.tsx` (landing)
- `frontend/app/(legal)/terminos/page.tsx`

Está listado como pendiente en `05-PENDIENTES-Y-RIESGOS.md`.
