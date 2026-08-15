# BotForge SaaS — Instrucciones para Claude Code

## LEER PRIMERO

Antes de cualquier tarea, leé **`docs/00-INDICE.md`**. Son 30 líneas y te dice
qué documento abrir según lo que tengas que hacer. Está pensado justamente para
no tener que releer 40 archivos en cada sesión.

| Si vas a… | Leé |
|---|---|
| Entender el sistema o ubicar dónde vive algo | `docs/01-ARQUITECTURA.md` |
| Escribir una query o tocar el schema | `docs/02-MODELOS-DE-DATOS.md` |
| Cambiar algo que parece raro o mal hecho | `docs/03-DECISIONES-CLAVE.md` ← **el más importante** |
| Tocar precios, cupos o gates por plan | `docs/04-PLANES-Y-LIMITES.md` |
| Planificar qué sigue | `docs/05-PENDIENTES-Y-RIESGOS.md` |

`ARCHITECTURE.md` en la raíz es del 2026-07-04 y quedó desactualizado.
`docs/` lo reemplaza.

## LO QUE NUNCA HAY QUE ROMPER

Cada una está explicada con su bug de origen en `docs/03-DECISIONES-CLAVE.md`.

1. **`effectivePlan(user)`, nunca `user.plan`.** Un plan pago vencido vale FREE
   desde el segundo en que vence. Si escribís `LIMITS[` con algo que no salió de
   `effectivePlan()`, es un bug.

2. **Verificar pertenencia en todo endpoint con `:id` o `:botId`.** El recurso
   se resuelve primero y se compara el dueño contra `req.user.userId` antes de
   devolver o modificar nada. Vale también para los ids que elige el modelo en
   las herramientas del asistente.

3. **No romper el prompt caching.** Nada variable entra al bloque estable: ni
   fechas, ni nombres de usuario, ni el resultado del RAG. El `cache_control` va
   en la última herramienta de la lista.

4. **Cero llamadas a IA en los informes semanales.** Todo sale de queries y
   reglas, incluido el resumen en prosa. Es costo recurrente, riesgo de
   alucinar cifras, y no sería reproducible.

5. **Un solo motor para el bot tenant.** WhatsApp, Chat de prueba y widget
   entran por `runTenantTurn()`. Si un canal necesita algo distinto, va como
   parámetro — nunca como segunda implementación.

## Qué estamos construyendo

Plataforma SaaS donde empresas se registran, suben documentos (PDF, Word, Excel,
URLs), y se genera automáticamente un chatbot con IA conectado a WhatsApp
Business.

## Stack tecnológico

- Backend: Node.js 20+ con TypeScript + Express
- ORM: Prisma con PostgreSQL
- IA: Anthropic Claude API con RAG. `claude-sonnet-5` primario,
  `claude-opus-4-8` de respaldo ante `stop_reason: 'refusal'`
- Vector DB: Pinecone (dimensión 384, modelo `all-MiniLM-L6-v2`)
- Procesamiento docs: pdf-parse, mammoth, xlsx
- WhatsApp: **Meta Cloud API**. Twilio quedó apagado con kill switch
  (`TWILIO_WHATSAPP_ENABLED`), el código sigue por si hay que volver
- Pagos: **Pagopar**. Stripe está desmontado, el código quedó
- Frontend: Next.js 14 + Tailwind CSS + shadcn/ui
- Queue: Bull + Redis
- Hosting: Railway (despliega solo al pushear a `master`, ~2,5 min)

## Comandos útiles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Backend con hot reload |
| `npm run dev:frontend` | Next.js |
| `npm run typecheck` | Verificar tipos. **Correr antes de cada commit** |
| `npm run build` | Compilar (backend: tsc, frontend: next build) |
| `npx prisma migrate deploy` | Aplicar migraciones |
| `npx prisma studio` | GUI de base de datos |
| `docker-compose up -d` | PostgreSQL y Redis locales |
| `npm run reporte:muestra` | PDFs de informe de ejemplo en `backend/tmp/` |
| `curl <backend>/health` | Ver qué commit está desplegado |

## Reglas de código

- TypeScript estricto, nunca usar `any`
- Validar inputs con zod en todas las rutas
- Respuestas API siempre en formato `{ data, error, meta }`
- Rutas en kebab-case: `/api/v1/bots/:id/documents`
- Nunca loguear tokens, passwords ni contenido de documentos
- Variables de entorno siempre desde `process.env`, nunca hardcodeadas
- Un commit por feature, mensaje descriptivo en español
- Migraciones: escribirlas a mano en `prisma/migrations/`, `migrate dev` necesita
  una TTY que no siempre está disponible
- Todos los `@types` van en `dependencies`, no en `devDependencies`: Railway
  instala con `NODE_ENV=production` y omite las dev

## Flujo principal del sistema

1. Registro con verificación de email obligatoria (código de 6 dígitos). Sin
   verificar no hay sesión
2. Crear bot: nombre, personalidad, idioma
3. Subir documentos: llegan a `/uploads`, se encolan en Bull y se suben a
   Cloudinary
4. Procesar en background: extraer texto → chunks de 500 tokens con overlap 50 →
   embedding por chunk → Pinecone con metadata `{botId, documentId}`
5. Chat: pregunta → embedding → top 5 chunks (umbral 0.3) → prompt con contexto
   → Claude responde, con loop de herramientas de hasta 5 rondas
6. WhatsApp: webhook de Meta → identifica el bot por `metaPhoneNumberId` → mismo
   motor → responde por la API

El flujo completo con el detalle de cada paso está en `docs/01-ARQUITECTURA.md`.

## Base de datos

Modelos principales: `User`, `Bot`, `Document`, `Chunk`, `Conversation`,
`Message`, `BotImage`, `NpsResponse`, `WeeklyReport`, `ConsolidatedReport`,
`PagoparOrder`, `SupportTicket`.

- `User` tiene muchos `Bot`
- `Bot` tiene muchos `Document`, `Conversation`, `BotImage` y `WeeklyReport`
- `Document` tiene muchos `Chunk` (vectores en Pinecone)
- `Conversation` tiene muchos `Message`
- `ConsolidatedReport` cuelga del `User`, no de un bot

Detalle de cada campo no obvio en `docs/02-MODELOS-DE-DATOS.md`.

## Variables de entorno

Las valida `backend/src/config/env.ts` al arrancar: si falta una crítica, el
proceso sale con `exit(1)` listando cuáles.

**Obligatorias**: `DATABASE_URL`, `JWT_SECRET` (mín. 32), `JWT_REFRESH_SECRET`,
`ANTHROPIC_API_KEY`, `PINECONE_API_KEY`.

**Opcionales con degradación**: `META_*`, `PAGOPAR_*`, `CLOUDINARY_*`,
`RESEND_API_KEY`, `TWILIO_*`, `GOOGLE_*`. Si falta alguna, la feature se apaga
con un guard explícito en vez de romper. El log de arranque dice cuáles quedaron
activas.

## Modelo de precios

La fuente de verdad es `backend/src/middleware/planLimits.ts`. La tabla completa
está en `docs/04-PLANES-Y-LIMITES.md`. Resumen:

| | FREE | BÁSICO | PROFESIONAL | AGENCIA |
|---|---|---|---|---|
| Precio | Gs. 0 | 150.000 | 350.000 | 750.000 |
| Bots | 1 | 1 | 5 | ilimitados |
| Docs por bot | 3 | 10 | 50 | ilimitados |
| Imágenes por bot | 0 | 8 | 30 | ilimitadas |
| Mensajes/mes | 100 | 1.000 | 4.000 | 10.000 |
| WhatsApp | ❌ | ✅ | ✅ | ✅ |
| Informes semanales | ❌ | ❌ | ✅ | ✅ |
| Informe consolidado | ❌ | ❌ | ❌ | ✅ |

Los precios están duplicados en pricing, landing y términos: el frontend no
puede importar del backend. Si cambiás un límite, tocá los cuatro lugares.

## Estado del proyecto

El MVP de tres fases está **completo**: core con RAG, WhatsApp por Meta Cloud
API, y producto (dashboard, límites por plan, pagos con Pagopar, deploy en
Railway). Lo construido después: verificación de email, tickets de soporte, NPS,
informes semanales con PDF, imágenes del bot, prompt caching y páginas legales.

Lo que falta está en `docs/05-PENDIENTES-Y-RIESGOS.md`.

## Notas importantes

- Correr `docker-compose up -d` antes de empezar a desarrollar
- Pinecone necesita dimensión 384 (`all-MiniLM-L6-v2`)
- En desarrollo los archivos van a `backend/uploads/`; en producción, Cloudinary
  (el disco de Railway es efímero)
- `npm run typecheck` antes de cada commit
- El build del frontend falla en `/apple-icon` desde el 2026-07-20. Es
  preexistente y no bloquea el deploy — no perder tiempo ahí salvo que cambie
  de naturaleza
- Al compactar contexto con `/compact`, preservar: archivos modificados, fase
  actual, decisiones de arquitectura tomadas
