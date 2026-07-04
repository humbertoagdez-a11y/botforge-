# ARCHITECTURE.md — BotForge

Documento maestro de contexto. Actualizar al final de cada sesión.
Última actualización: 4 de julio de 2026 (arquitectura de agentes dual)

---

## 1. RESUMEN EJECUTIVO

BotForge es una plataforma SaaS paraguaya donde negocios crean chatbots de IA
entrenados con sus propios documentos (RAG) y los conectan a WhatsApp y chat web.
El cliente sube su menú/catálogo/instructivo, el bot aprende y responde solo 24/7.

- **Stack**: Next.js 14 (App Router) + Express/TypeScript + PostgreSQL/Prisma + Redis/Bull + Pinecone + Claude (claude-fable-5)
- **Producción**: backend en Railway (`https://botforge-production-b16f.up.railway.app`), frontend en Railway (servicio separado)
- **Repositorio**: `https://github.com/humbertoagdez-a11y/botforge-` (branch `master`)
- **Servicios externos**: Anthropic (IA), Pinecone (vectores), Twilio (WhatsApp sandbox), Stripe (pagos), Resend (emails, pendiente de API key), Railway (hosting + PostgreSQL + Redis)

---

## 2. STACK Y SERVICIOS

| Tecnología | Versión | Propósito | Dónde se usa |
|---|---|---|---|
| Next.js | ^14.2.35 | Frontend App Router | `frontend/` |
| React | ^18.3.1 | UI | `frontend/` |
| Tailwind CSS | ^3.4.15 | Estilos (tema via CSS vars HSL) | `frontend/`, `tailwind.config.ts` |
| shadcn/ui (parcial) | — | Componentes base (Button, Card, Dialog, Tabs, Select, etc.) | `frontend/components/ui/` |
| lucide-react | ^0.460.0 | Iconografía (única fuente de íconos) | todo el frontend |
| Zustand | ^5.0.1 | Estado global de auth (persistido) | `frontend/lib/store.ts` |
| react-hook-form + zod | ^7.54 / ^3.23 | Formularios y validación client-side | wizard, config, perfil, auth |
| sonner | ^1.7.0 | Toasts | todo el dashboard |
| Express | ^4.21.2 | API REST backend | `backend/src/` |
| Prisma | ^5.22.0 | ORM PostgreSQL | `backend/prisma/`, `backend/src/lib/prisma.ts` |
| PostgreSQL | Railway | Base de datos principal | `DATABASE_URL` |
| Redis + Bull | ^4.16.3 | Cola de procesamiento de documentos | `backend/src/lib/queue.ts`, `jobs/` |
| @anthropic-ai/sdk | ^0.36.0 | Claude API (chat, streaming, visión) | `services/ai.ts`, `routes/assistant*.ts` |
| @pinecone-database/pinecone | ^3.0.3 | Vector DB (dimensión 384) | `services/pinecone.ts` |
| @xenova/transformers | ^2.17.2 | Embeddings locales all-MiniLM-L6-v2 | `services/embeddings.ts` |
| Twilio | ^5.3.7 | WhatsApp (sandbox) | `routes/whatsapp.ts` |
| Stripe | ^22.3.0 | Suscripciones | `routes/stripe.ts` |
| Resend | fetch nativo | Email de bienvenida | `routes/auth.ts` |
| multer | ^1.4.5 | Upload de archivos (20MB) | `routes/documents.ts` |
| pdf-parse / mammoth / xlsx | — | Extracción de texto PDF/Word/Excel | `services/documentProcessor.ts` |
| bcryptjs / jsonwebtoken | — | Hash de passwords / JWT | `routes/auth.ts`, `middleware/auth.ts` |
| Railway | — | Hosting backend + frontend + Postgres + Redis | deploy automático desde master |

---

## 3. ÁRBOL DE DIRECTORIOS COMENTADO

```
botforge/
├── ARCHITECTURE.md              # Este documento
├── CLAUDE.md                    # Instrucciones del proyecto para Claude Code
├── docker-compose.yml           # PostgreSQL + Redis locales
├── backend/
│   ├── package.json             # Scripts: dev (tsx watch), build, typecheck, test
│   ├── prisma/
│   │   └── schema.prisma        # Modelos: User, RefreshToken, Bot, WhatsAppConnection, Document, Chunk, Conversation, Message
│   └── src/
│       ├── index.ts             # Entry point Express: helmet, cors(FRONTEND_URL+credentials), rate limit global, json 10mb, registro de rutas. Stripe webhook con raw body ANTES de express.json
│       ├── config/env.ts        # Variables de entorno validadas con zod (falla al arrancar si faltan)
│       ├── middleware/
│       │   ├── auth.ts          # requireAuth: acepta cookie accessToken o header Bearer; setea req.user
│       │   ├── planLimits.ts    # LIMITS por plan + checkBotLimit, checkDocLimit, checkMessageLimit, checkWhatsAppAccess (⚠ los 2 últimos NO se usan en ninguna ruta)
│       │   ├── rateLimit.ts     # globalLimiter (100/15min por IP), authLimiter (10/15min)
│       │   └── errorHandler.ts  # AppError + handler central: ZodError→400 con details, AppError→statusCode, resto→500. Formato {data,error,meta}
│       ├── routes/
│       │   ├── auth.ts          # register (+email Resend), login, refresh (rotación), logout, me, PUT profile, PUT password. Cookies httpOnly SameSite=None en prod
│       │   ├── bots.ts          # CRUD de bots + POST /:id/generate-instructivo (Claude)
│       │   ├── documents.ts     # Bajo /bots/:botId/documents: list, upload (multer→Cloudinary raw→borra local→Bull), delete (+Pinecone+Cloudinary). MIME: pdf/docx/xlsx/xls/txt/csv, 20MB
│       │   ├── chat.ts          # Bajo /bots/:botId/chat: POST / (JSON), POST /stream (SSE), GET /history/:conversationId. RAG + Claude
│       │   ├── whatsapp.ts      # request-connection (código BF-XXXXXX, TTL 10min), connection-status (polling), DELETE connect, POST /webhook (Twilio, ⚠ firma deshabilitada)
│       │   ├── stripe.ts        # checkout (sesión), portal, webhook (firma verificada, actualiza plan del user)
│       │   ├── stats.ts         # GET / (métricas completas + plan + últimas 5 conversaciones), GET /conversations (paginado), GET /conversations/:id (hilo completo)
│       │   ├── activity.ts      # GET /: últimos 20 eventos (mensajes + documentos + conexiones WhatsApp) combinados y ordenados
│       │   ├── assistant.ts     # Aria (landing, público, 20/min por IP): POST /chat SSE con claude-fable-5→opus-4-8
│       │   ├── assistantDashboard.ts # Asistente ATC (autenticado, 30/min por usuario): POST / SSE, contexto de bot desde BD, imágenes base64, marcador ===INSTRUCTIVO_LISTO===
│       │   ├── public.ts        # POST /bots/:botId/chat/stream: chat SSE sin auth para el widget embebible (channel 'widget')
│       │   └── test.ts          # POST /upload de prueba (solo NODE_ENV !== production)
│       ├── services/
│       │   ├── ai.ts            # Cliente Anthropic. PRIMARY claude-fable-5, FALLBACK claude-opus-4-8 ante refusal. generateBotResponse, streamBotResponse, generateInstructivo. System prompt con estilo WhatsApp + contexto RAG. cache_control ephemeral
│       │   ├── rag.ts           # ragChat/ragStream: embedding de la pregunta → Pinecone topK=5 filtro botId, threshold 0.3 → Claude
│       │   ├── embeddings.ts    # all-MiniLM-L6-v2 local via @xenova/transformers (384 dims, lazy load)
│       │   ├── pinecone.ts      # upsertChunks (batch 100), querySimilarChunks, deleteChunksByIds
│       │   └── documentProcessor.ts # extractAndChunk: pdf-parse/mammoth/xlsx/texto plano → chunks de 380 palabras, overlap 38
│       ├── jobs/processDocument.ts # Worker Bull: PENDING→PROCESSING→extrae→embeddings→Pinecone+Chunk→READY (o ERROR). 3 reintentos backoff exponencial
│       └── lib/
│           ├── prisma.ts        # Singleton PrismaClient
│           └── queue.ts         # documentQueue (Bull sobre REDIS_URL)
├── frontend/
│   ├── package.json             # Scripts: dev, build, start, typecheck
│   ├── tailwind.config.ts       # Colores via CSS vars HSL (shadcn), darkMode class
│   ├── app/
│   │   ├── layout.tsx           # Root: Inter, metadata SEO/OG, viewport (theme #07070E, apple-web-app), Toaster
│   │   ├── globals.css          # Vars :root (tema claro) + .theme-dashboard (dark tech scoped), dot-grid, keyframes, scrollbars, inputs 16px móvil
│   │   ├── page.tsx             # Landing pública: navbar sticky, hero + mascota, demo WhatsApp animado 6 rubros, métricas, pasos, precios, FAQ, footer, Aria. Comentario PENDIENTES al final
│   │   ├── auth/                # Segmento REAL /auth/* (era route group, se renombró para coincidir con los links)
│   │   │   ├── layout.tsx       # Fondo claro degradado + mascota decorativa + logo
│   │   │   ├── login/page.tsx   # Login → setAuth → /dashboard
│   │   │   └── register/page.tsx# Registro con confirmar contraseña + aviso legal → auto-login → /dashboard
│   │   ├── (dashboard)/         # Route group (no agrega segmento)
│   │   │   ├── layout.tsx       # Guard de token, refresh JWT proactivo (exp<2min, check cada 60s), tema dark, TechBackground, navbar móvil + Sidebar drawer
│   │   │   ├── pricing/page.tsx # /pricing: 4 planes, checkout Stripe
│   │   │   └── dashboard/
│   │   │       ├── page.tsx     # Mis Bots: empty state 3 pasos + OnboardingGuide; con bots: métricas animadas, últimas conversaciones, actividad reciente, grid de bots, FAB móvil
│   │   │       ├── conversations/page.tsx # Lista paginada + modal hilo completo (fullscreen en móvil)
│   │   │       ├── stats/page.tsx # Uso del plan con barra + 8 métricas; mensaje si no hay actividad
│   │   │       ├── perfil/page.tsx # Nombre editable, cambio de contraseña, info de cuenta
│   │   │       └── bots/
│   │   │           ├── new/page.tsx # Wizard 4 pasos: básico → personalidad (íconos SVG + badges) → editar prompt → confirmar
│   │   │           └── [id]/page.tsx # Tabs: Documentos, Chat de prueba, Instructivo, Configuración, WhatsApp. Indicador de estado, botón flotante Asistente con contexto
│   │   ├── (legal)/             # Route group → /terminos y /privacidad con layout claro propio
│   │   ├── widget/[botId]/page.tsx # Widget embebible público (ChatWidget isPublic)
│   │   └── api/                 # Next API routes (proxies, la API key nunca toca el browser)
│   │       ├── assistant/route.ts          # Proxy Aria → backend /api/v1/assistant/chat (SSE passthrough)
│   │       └── assistant/dashboard/route.ts# Proxy autenticado → backend /api/v1/assistant/dashboard (reenvía Authorization)
│   ├── components/
│   │   ├── ui/                  # button, card, badge, dialog, input, label, progress, select, tabs, textarea
│   │   ├── personalidad-icons/index.tsx # 8 íconos SVG inline bicolor por personalidad
│   │   ├── Sidebar.tsx          # Nav + drawer móvil + plan/uso + asistente + logout
│   │   ├── DashboardAssistant.tsx # Drawer 420px del asistente ATC (SSE, imágenes, instructivo editable)
│   │   ├── BotForgeAssistant.tsx  # Aria: widget flotante de la landing
│   │   ├── ChatWidget.tsx       # Chat de prueba/widget público con streaming SSE
│   │   ├── WhatsAppOnboarding.tsx # Flujo de conexión: número → código → polling → activo/desconectar
│   │   ├── DocumentUploader.tsx # Dropzone 1 archivo 20MB + DocumentRow (estado con polling del padre)
│   │   ├── DocumentDropzone.tsx # Dropzone multi (máx 5, 10MB, +CSV) del tab WhatsApp
│   │   ├── InstructivoWizard.tsx# Wizard 12 preguntas → generate-instructivo → editar/descargar/subir
│   │   ├── OnboardingGuide.tsx  # Guía 4 pasos con spotlight (localStorage botforge_onboarding_done)
│   │   └── TechBackground.tsx   # Canvas 35 partículas cyan (rAF, respeta reduced-motion)
│   ├── lib/
│   │   ├── api.ts               # Cliente central: token Bearer, interceptor 401 + refresh compartido, tipos de dominio
│   │   ├── store.ts             # Zustand persistido: token + user (re-sincroniza bf_token al rehidratar)
│   │   ├── utils.ts             # cn, formatBytes, formatDate
│   │   └── personalidades.ts    # 8 personalidades con prompts pro (600-900 palabras) + íconos + badges
│   └── public/
│       ├── mascota.svg          # Mascota animada 400x400 (hero, auth, empty state)
│       ├── logo-botforge.svg    # Logo robot 32x32 (sidebar, auth, legal, navbar móvil)
│       └── asistente-logo.svg   # Cara robótica 64x64 del asistente (drawer, botón)
```

---

## 4. MODELOS DE BASE DE DATOS

**User** — cuenta del cliente.
Campos: `id` (uuid), `email` (unique), `passwordHash` (bcrypt 12), `name`, `plan` (enum FREE/STARTER/PRO/AGENCY, default FREE), `stripeCustomerId?` (unique), `stripeSubscriptionId?` (unique), `planExpiresAt?`, `messagesUsedThisMonth` (contador de enforcement, default 0), `messagesResetAt` (para reset mensual), timestamps.
Relaciones: 1‑N `Bot`, 1‑N `RefreshToken`.

**RefreshToken** — tokens de refresh persistidos (rotación en cada uso).
Campos: `id`, `token` (unique), `userId`, `expiresAt` (7 días). Cascade delete con User.

**Bot** — asistente configurado.
Campos: `id`, `userId`, `name`, `personality` (system prompt, default genérico), `language` (default 'es'), `whatsappNumber?` (**unique** — un número solo puede estar en un bot), `isActive` (default true), timestamps.
Relaciones: N‑1 User (cascade), 1‑N Document, 1‑N Conversation, 1‑N WhatsAppConnection.

**WhatsAppConnection** — intento de vinculación de número.
Campos: `id`, `botId`, `phoneNumber`, `verificationCode` (unique, formato BF-XXXXXX), `status` (PENDING/ACTIVE/EXPIRED), `expiresAt` (10 min). Cascade con Bot.

**Document** — archivo subido para entrenar.
Campos: `id`, `botId`, `name`, `mimeType`, `filePath` (disco local, solo fallback), `url?` (Cloudinary raw — storage persistente real), `fileSize`, `status` (PENDING/PROCESSING/READY/ERROR), `errorMsg?`, timestamps. Cascade con Bot. 1‑N Chunk.

**Chunk** — fragmento vectorizado de un documento.
Campos: `id`, `documentId`, `botId` (desnormalizado para filtrar en Pinecone), `content`, `tokenCount`, `chunkIndex`, `pineconeId` (unique — id del vector en Pinecone). Cascade con Document.

**Conversation** — hilo de chat por canal.
Campos: `id`, `botId`, `channelId`, `channel` ('web' | 'whatsapp' | 'widget'), timestamps.
Constraint: `@@unique([botId, channelId])` — en WhatsApp el channelId es `whatsapp:+595...`, así cada número de cliente tiene un solo hilo por bot. 1‑N Message.

**NotificationConfig** — notificaciones por email configuradas desde el asistente.
Campos: `id`, `userId`, `botId`, `event` ('human_requested' | 'new_conversation' | 'daily_summary'), `email`, `isActive` (default true), `createdAt`. Cascade con User y Bot. Constraint `@@unique([botId, event])` (una config por evento por bot; el asistente hace upsert). Hoy solo `human_requested` dispara emails (webhook de WhatsApp detecta frases tipo "hablar con una persona").

**Message** — mensaje individual.
Campos: `id`, `conversationId`, `role` (USER/ASSISTANT), `content`, `tokensUsed` (input+output de Claude, para límites de plan), `createdAt`. Cascade con Conversation.

---

## 5. RUTAS DEL BACKEND

Prefijo común: `/api/v1`. Todas responden `{ data, error, meta }`.

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | /health | No | Healthcheck |
| POST | /auth/register | No (authLimiter 10/15min) | Registro + cookies + email bienvenida (Resend, no bloqueante) |
| POST | /auth/login | No (authLimiter) | Login, devuelve user + accessToken, setea cookies |
| POST | /auth/refresh | Cookie refreshToken | Rota refresh token, devuelve `{accessToken, user}` |
| POST | /auth/logout | Sí | Borra refresh token y cookies |
| GET | /auth/me | Sí | Usuario actual (incluye createdAt) |
| PUT | /auth/profile | Sí | Actualiza nombre |
| PUT | /auth/password | Sí | Cambia contraseña (verifica actual con bcrypt) |
| GET | /bots | Sí | Lista bots del usuario con _count |
| POST | /bots | Sí + checkBotLimit | Crea bot |
| GET | /bots/:id | Sí | Detalle (verifica propiedad) |
| PATCH | /bots/:id | Sí | Actualiza name/personality/language |
| DELETE | /bots/:id | Sí | Elimina bot (cascade) |
| POST | /bots/:id/generate-instructivo | Sí | Genera instructivo con Claude desde respuestas del wizard |
| GET | /bots/:botId/documents | Sí | Lista documentos con chunks count |
| POST | /bots/:botId/documents | Sí + checkDocLimit | Upload (multer 20MB) → encola en Bull |
| DELETE | /bots/:botId/documents/:docId | Sí | Borra doc + vectores en Pinecone |
| POST | /bots/:botId/chat | Sí + checkMessageLimit | Chat JSON (RAG + Claude); incrementa contador al responder |
| POST | /bots/:botId/chat/stream | Sí + checkMessageLimit | Chat SSE streaming; incrementa contador al responder |
| GET | /bots/:botId/chat/history/:conversationId | Sí | Hilo de una conversación |
| POST | /whatsapp/bots/:botId/request-connection | Sí + checkWhatsAppAccess | Genera código BF-XXXXXX (TTL 10 min); 403 si el plan no incluye WhatsApp |
| GET | /whatsapp/bots/:botId/connection-status | Sí | Estado para polling (IDLE/PENDING/ACTIVE/EXPIRED) |
| DELETE | /whatsapp/bots/:botId/connect | Sí | Desconecta número |
| POST | /whatsapp/webhook | Firma Twilio (X-Twilio-Signature contra BACKEND_URL; se salta con warn si falta TWILIO_AUTH_TOKEN) | Webhook Twilio: verifica códigos o responde con RAG (TwiML); respeta límite mensual del dueño del bot |
| POST | /stripe/checkout | Sí | Crea sesión de Stripe Checkout (subscription) |
| POST | /stripe/portal | Sí | Portal de facturación |
| POST | /stripe/webhook | No (firma Stripe) | checkout.completed / subscription.updated / deleted → actualiza plan |
| GET | /stats | Sí | Métricas completas + planLimits + últimas 5 conversaciones |
| GET | /stats/conversations?page=N | Sí | Conversaciones paginadas (20/página) |
| GET | /stats/conversations/:id | Sí | Hilo completo con mensajes |
| GET | /activity | Sí | Últimos 20 eventos (mensajes/docs/whatsapp) |
| POST | /assistant/chat | No (20/min por IP) | Aria (landing), SSE |
| POST | /assistant/dashboard | Sí (20/min por usuario) | Asistente agéntico con function calling (10 tools), SSE con eventos text/tool_start/tool_end/confirm_required/done, imágenes base64, confirmación stateless de acciones destructivas via `confirmedToolUseIds` |
| POST | /public/bots/:botId/chat/stream | No | Chat SSE del widget embebible; respeta límite mensual del dueño del bot |
| POST | /drive/bots/:botId/connect | Sí | Guarda DriveConnection (accessToken/refreshToken/folderName) verificando acceso real a la carpeta |
| DELETE | /drive/bots/:botId/disconnect | Sí | Elimina la DriveConnection del bot |
| GET | /drive/bots/:botId/files | Sí | Lista archivos de la carpeta de Drive configurada |
| POST | /test/upload | No (solo dev) | Upload de prueba |

Proxies de Next.js (mismo dominio del frontend): `POST /api/assistant` → assistant/chat, `POST /api/assistant/dashboard` → assistant/dashboard (reenvía Authorization).

---

## 6. FLUJOS PRINCIPALES

**FLUJO DE ONBOARDING**
1. Usuario se registra en `/auth/register` → backend crea User, setea cookies, dispara email de bienvenida (Resend, no bloqueante) → auto-login y redirect a `/dashboard`
2. Sin bots: empty state con 3 pasos + OnboardingGuide (spotlight sobre "Nuevo bot" y "Asistente", se guarda en localStorage)
3. Crea bot en `/dashboard/bots/new` (wizard: básico → plantilla de personalidad → editar prompt → confirmar)
4. Sube instructivo: tab Documentos (upload directo) o tab Instructivo (wizard 12 preguntas → Claude genera → editar → subir al bot). El doc se encola en Bull: extrae texto → chunks 380 palabras → embeddings MiniLM → Pinecone → estado READY
5. Conecta WhatsApp: ingresa su número → recibe código BF-XXXXXX → lo manda por WhatsApp al sandbox de Twilio → webhook lo valida → bot.whatsappNumber se setea (polling del frontend detecta ACTIVE)
6. El bot responde solo por WhatsApp y chat web

**FLUJO DE MENSAJE WHATSAPP**
1. Cliente escribe al número sandbox de Twilio
2. Twilio hace POST a `/api/v1/whatsapp/webhook` (form-encoded: From, Body)
3. Si el Body matchea `BF-\d{6}`: flujo de verificación de código
4. Si no: busca Bot con `whatsappNumber === From` e `isActive`; exige ≥1 doc READY
5. Encuentra/crea Conversation por `(botId, channelId=whatsapp:+...)`, carga últimos 10 mensajes
6. RAG: embedding de la pregunta → Pinecone (topK 5, filtro botId, threshold 0.3) → chunks al system prompt
7. Claude `claude-fable-5` responde (fallback `claude-opus-4-8` si refusal); se persisten USER y ASSISTANT con tokensUsed
8. Respuesta via TwiML

**FLUJO DE CHAT WEB (dashboard y widget)**
1. ChatWidget (autenticado en el tab Chat de prueba; `isPublic` en `/widget/[botId]`)
2. POST `/bots/:botId/chat/stream` (auth) o `/public/bots/:botId/chat/stream` (widget)
3. Backend: misma cadena RAG + Claude en streaming; eventos SSE `{type:'delta'|'done'|'error'}`
4. Frontend acumula deltas letra por letra; guarda conversationId para continuar el hilo

**FLUJO DEL ASISTENTE DASHBOARD (ATC)**
1. Se abre desde el Sidebar (sin contexto) o desde la página del bot (con botId)
2. Frontend manda historial completo (menos la bienvenida local `isLocal`) + imagen base64 opcional al proxy Next → backend
3. Backend arma contexto real del bot desde la BD (personalidad, docs, WhatsApp, últimas 3 conversaciones) e inyecta en el system prompt ATC
4. Si la respuesta contiene `===INSTRUCTIVO_LISTO===`, el frontend separa el texto y muestra el instructivo en textarea editable + descarga .txt

**FLUJO DE REFRESH JWT**
1. Access token dura 15 min; refresh 7 días en cookie httpOnly (path `/api/v1/auth/refresh`, SameSite=None en prod)
2. Proactivo: el layout del dashboard decodifica `exp` del JWT y refresca si faltan <2 min (check al montar y cada 60s)
3. Reactivo: `fetchWithAuth` intercepta 401 → refresh (promesa compartida anti-estampida) → reintenta una vez → si falla, clearAuth + redirect a `/auth/login`

---

## 7. ESTADO GLOBAL DEL FRONTEND

**Store (`lib/store.ts`)** — Zustand con `persist` (key localStorage `botforge-auth`):
- Guarda: `token` (JWT access) y `user` ({id, name, email, plan, createdAt})
- `setAuth(token, user)`: setea estado y espeja el token en localStorage `bf_token` (lo que lee api.ts)
- `clearAuth()`: limpia estado y `bf_token`
- `onRehydrateStorage`: re-sincroniza `bf_token` al recargar la página
- Se consume en: layout del dashboard (guard + refresh proactivo), Sidebar, páginas del dashboard, ChatWidget, DashboardAssistant, login/registro, pricing

**Cliente API (`lib/api.ts`)** — patrón centralizado:
- `getToken()`: lee `bf_token` con fallback a la sesión persistida de zustand (auto-repara desincronización)
- `fetchWithAuth()`: agrega `Authorization: Bearer`, `credentials: 'include'` (necesario para la cookie cross-site del refresh) y aplica el interceptor de 401
- Interceptor: 401 → `refreshSession()` (promesa compartida module-level: N requests fallidos esperan UN refresh) → reintento único → si falla, `clearAuth()` + redirect. Rutas excluidas: login, register, refresh, logout
- Respuesta esperada del backend: `{ data, error: {message} | null, meta }`; errores se lanzan como `ApiError` con `statusCode`
- Expone: `api.auth.*`, `api.bots.*` (incl. generateInstructivo), `api.documents.*`, `api.chat.*`, `api.stats.*`, `api.activity.*` + tipos de dominio (User, Bot, BotDocument, ConversationSummary/Detail, AccountStats, ActivityEvent)
- ⚠ Los fetch de streaming SSE (ChatWidget, DashboardAssistant, WhatsAppOnboarding) NO pasan por el interceptor; los cubre el refresh proactivo del layout

---

## 8. PLANES Y LÍMITES

Valores reales de `backend/src/middleware/planLimits.ts`:

| Plan | Bots | Docs/bot | Mensajes/mes | WhatsApp |
|------|------|----------|--------------|----------|
| FREE | 1 | 3 | 100 | No |
| STARTER (Básico) | 1 | 10 | 1.000 | Sí |
| PRO (Profesional) | 5 | 50 | 10.000 | Sí |
| AGENCY (Agencia) | ∞ | ∞ | 100.000 | Sí |

Precios: Free Gs. 0 / Básico Gs. 150.000 (USD 20) / Profesional Gs. 350.000
(USD 47) / Agencia Gs. 750.000 (USD 99). Landing y pricing alineados con estos números.

Enforcement (completo desde jul 2026): `checkBotLimit` (crear bot), `checkDocLimit`
(subir doc), `checkMessageLimit` (chat autenticado) y `checkWhatsAppAccess`
(request-connection). El webhook de WhatsApp y el widget público validan por
`bot.userId` via `assertMessageLimit()`. Contador: `User.messagesUsedThisMonth`
con reset al cambiar el mes (`messagesResetAt`), incrementado por
`incrementMessageUsage()` solo tras respuesta exitosa. Errores de límite:
429/403 con `error.code = 'PLAN_LIMIT_EXCEEDED'` y `data = {limit, used, plan}`;
el frontend (api.ts) muestra toast con acción "Mejorar plan" → /pricing.

---

## 9. COMPONENTES CLAVE DEL FRONTEND

| Componente | Propósito | Props principales | Dónde se usa | Dependencias |
|---|---|---|---|---|
| **Sidebar** | Navegación + drawer móvil + plan/uso + logout | `isOpen`, `onClose` | Layout del dashboard | store, api.stats, DashboardAssistant, Progress |
| **DashboardAssistant** | Drawer 420px del asistente ATC: SSE, imágenes adjuntas (5MB), instructivo editable con `===INSTRUCTIVO_LISTO===`, descarga .txt. Bienvenida `isLocal` excluida del historial | `open`, `onClose`, `botId?`, `botName?` | Sidebar (sin contexto), página del bot (con contexto) | store (token), proxy `/api/assistant/dashboard` |
| **BotForgeAssistant** (Aria) | Widget flotante de la landing, streaming SSE público | — | `app/page.tsx` | proxy `/api/assistant` |
| **ChatWidget** | Chat con streaming SSE + saludo inicial local + typing dots | `botId`, `botName`, `isPublic?` | Tab Chat de prueba, `/widget/[botId]` | store (token si no es público) |
| **WhatsAppOnboarding** | Máquina de estados idle→requesting→pending→polling→active/expired con countdown y polling cada 3s | `bot`, `onUpdate` | Tab WhatsApp | fetch directo a `/whatsapp/*` |
| **DocumentUploader** | Dropzone single-file 20MB + export `DocumentRow` (fila con estado/borrar) | `botId`, `onUploaded` | Tab Documentos | api.documents |
| **DocumentDropzone** | Dropzone multi-archivo (máx 5, 10MB, +CSV) | `botId`, `docs`, `onUploaded`, `onDeleted` | Tab WhatsApp (entrenamiento rápido) | DocumentRow, api.documents |
| **InstructivoWizard** | Fases start→wizard(12 preguntas chat)→generating→result(editar/descargar/subir)→uploaded | `botId`, `botName`, `onUploaded` | Tab Instructivo | api.bots.generateInstructivo, api.documents |
| **OnboardingGuide** | Guía 4 pasos con spotlight (box-shadow 9999px sobre `[data-onboarding]`) | `open`, `onFinish` | Dashboard (sin bots + sin localStorage key) | — |
| **TechBackground** | Canvas 35 partículas cyan flotantes (rAF, off si reduced-motion) | — | Layout del dashboard | — |
| **personalidad-icons** | 8 SVGs inline bicolor (violeta/cian, stroke 1.5) | `className` | Wizard de creación, personalidades.ts | — |
| **ui/** | Primitivas shadcn: Button, Card, Badge, Dialog, Input, Label, Progress, Select, Tabs, Textarea | — | Todo el dashboard | Radix. ⚠ Dialog/Select portalean fuera del árbol: necesitan `className="theme-dashboard"` |

---

## 10. PERSONALIDADES DE BOT

Definidas en `frontend/lib/personalidades.ts` (prompts de 600-900 palabras con
identidad, técnicas del rubro, 5 objeciones, humanización, derivación y reglas
comunes de comunicación estilo WhatsApp):

| ID | Nombre | Rubro objetivo | Inicio del prompt |
|---|---|---|---|
| `vendedor_universal` | Vendedor Profesional | Cualquier negocio que venda | "Sos el asesor comercial de este negocio. Si el dueño no configuró un nombre, podés presentarte como Valentina o Lucas..." |
| `restaurante` | Anfitrión de Restaurante | Restaurantes, rotiserías, cafés | "Sos el anfitrión virtual de este restaurante... Tu modelo a seguir es el mozo bueno del restaurante de barrio..." |
| `clinica` | Recepcionista de Salud | Clínicas, consultorios, odontólogos | "Sos el recepcionista virtual de esta institución de salud... La gente que te escribe suele estar preocupada..." |
| `tienda` | Asesor de Tienda | Comercios (ropa, electro, ferretería) | "Sos el asesor de esta tienda... Tu vibra es la del vendedor joven y copado de una buena tienda..." |
| `servicios` | Coordinador de Turnos | Peluquerías, belleza, gimnasios | "Sos el coordinador de agenda de este negocio... que nadie se quede sin su turno y que nadie se vaya con dudas..." |
| `inmobiliaria` | Asesor Inmobiliario | Inmobiliarias, desarrolladoras | "Sos el asesor inmobiliario de esta empresa. Trabajás con decisiones grandes... calificar bien a cada interesado..." |
| `soporte` | Agente de Soporte | Atención al cliente, postventa | "Sos el agente de soporte de esta empresa. Tu misión es resolver el problema del cliente en el menor tiempo posible..." |
| `educacion` | Asesor Educativo | Institutos, academias, cursos | "Sos el asesor de admisiones de esta institución educativa. Tu rol es orientar, no vender a presión..." |

Badges del wizard: "Técnicas de ventas LATAM", "Gestión de reservas y pedidos",
"Protocolo médico y empatía", "Catálogo y conversión", "Agenda inteligente",
"Calificación de leads", "Resolución de problemas", "Orientación vocacional".

---

## 11. VARIABLES DE ENTORNO

**BACKEND (.env)** — validadas en `src/config/env.ts` (el server no arranca si falta una requerida):

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| NODE_ENV | No (default development) | En producción activa cookies Secure/SameSite=None |
| PORT | No (default 3001) | Puerto Express |
| DATABASE_URL | **Sí** | PostgreSQL |
| JWT_SECRET | **Sí** (min 32 chars) | Firma del access token |
| JWT_REFRESH_SECRET | **Sí** (min 32 chars) | Firma del refresh token |
| JWT_EXPIRES_IN | No (default 15m) | Vida del access token |
| JWT_REFRESH_EXPIRES_IN | No (default 7d) | Vida del refresh token |
| ANTHROPIC_API_KEY | **Sí** (sk-ant-...) | Claude API |
| PINECONE_API_KEY | **Sí** | Vector DB |
| PINECONE_INDEX | No (default botforge) | Índice (dimensión 384) |
| TWILIO_ACCOUNT_SID | No | WhatsApp sandbox |
| TWILIO_AUTH_TOKEN | No | Firma de webhooks (si falta, la validación se salta con warn) |
| TWILIO_WHATSAPP_FROM | No | Número sandbox (whatsapp:+14155238886) |
| STRIPE_SECRET_KEY | No | Pagos (503 si se usa checkout sin configurar) |
| STRIPE_WEBHOOK_SECRET | No | Firma del webhook Stripe |
| STRIPE_PRICE_STARTER / _PRO / _AGENCY | No | Price IDs de suscripción |
| RESEND_API_KEY | No | Email de bienvenida (se omite con log si falta) |
| CLOUDINARY_CLOUD_NAME | **Sí en prod** | Storage persistente de documentos (sin ella, uploads quedan en disco efímero) |
| CLOUDINARY_API_KEY | **Sí en prod** | Cloudinary |
| CLOUDINARY_API_SECRET | **Sí en prod** | Cloudinary |
| REDIS_URL | No (default localhost) | Cola Bull |
| FRONTEND_URL | No (default localhost:3000) | CORS + links en emails + redirects Stripe |
| BACKEND_URL | **Sí en prod** (default localhost:3001) | URL pública del backend para validar la firma de Twilio. En Railway: `https://botforge-production-b16f.up.railway.app` |
| UPLOADS_DIR | No (default ./uploads) | Archivos subidos (⚠ disco local, ver sección 12) |
| TAVILY_API_KEY | No | Búsqueda web (tool search_web del asistente); sin ella responde "no disponible" |
| FIRECRAWL_API_KEY | No | Scraping de URLs (tool scrape_website); sin ella el scrape devuelve vacío |
| DEEPGRAM_API_KEY | No | Transcripción de audios de WhatsApp (nova-3, es); sin ella los audios se ignoran |
| GOOGLE_VISION_API_KEY | No | Análisis de imágenes de WhatsApp (texto/labels/objetos); sin ella se ignoran |
| GOOGLE_CLIENT_ID | No | OAuth2 de Google Drive (cliente para refresh de tokens) |
| GOOGLE_CLIENT_SECRET | No | OAuth2 de Google Drive |

**FRONTEND (.env.local / variables Railway)**:

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| NEXT_PUBLIC_API_URL | **Sí en prod** | URL del backend (la usan api.ts y los componentes con fetch directo) |
| BACKEND_URL | No | Override server-side para los proxies de `/app/api/*` (fallback: NEXT_PUBLIC_API_URL → URL de Railway hardcodeada) |

---

## 12. PENDIENTES Y DEUDA TÉCNICA

**Seguridad / enforcement**
1. ~~Validación de firma de Twilio deshabilitada~~ **RESUELTO (jul 2026)**: middleware `validateTwilioSignature` activo en el webhook, validando contra `BACKEND_URL` fija (evita el problema del proxy de Railway). ⚠ Pendiente operativo: setear `BACKEND_URL` en Railway y probar con un mensaje real de Twilio; si rechaza (403), los logs de debug imprimen la URL usada y la firma recibida. Si falta `TWILIO_AUTH_TOKEN` la validación se salta con warn (no bloquea dev).
2. ~~checkMessageLimit / checkWhatsAppAccess sin montar~~ **RESUELTO (jul 2026)**: enforcement completo en chat, whatsapp, webhook y widget público con contador mensual en User (ver sección 8). Nota: los chats del asistente ATC y de Aria NO descuentan del límite (decisión: son soporte de la plataforma, no mensajes del bot del cliente).
3. El widget público (`/public/bots/:botId/chat/stream`) no tiene rate limit propio más allá del global de 100/15min por IP.
4. `express.json` global a 10mb (por las imágenes del asistente) amplía la superficie de payloads grandes en todos los endpoints.

**Infraestructura**
5. `RESEND_API_KEY` sin configurar en Railway + dominio `botforge.com.py` sin verificar en Resend (el remitente `noreply@botforge.com.py` no saldrá hasta verificar DNS).
6. Stripe: código completo (checkout con Customer persistido, portal, webhook con firma, `?upgrade=success` con toast y refresh de plan en el dashboard; sin configurar devuelve 503 `STRIPE_NOT_CONFIGURED` y el frontend muestra "Los pagos estarán disponibles pronto"). ⚠ Pendiente operativo: crear productos/precios en Stripe y setear `STRIPE_SECRET_KEY`, `STRIPE_PRICE_STARTER/PRO/AGENCY` (mapeo: Básico=STARTER, Profesional=PRO, Agencia=AGENCY) y `STRIPE_WEBHOOK_SECRET` en Railway + registrar el endpoint del webhook en Stripe.
7. ~~Uploads en disco local efímero~~ **RESUELTO (jul 2026)**: los documentos se suben a Cloudinary (raw, carpeta `botforge/documents`, public_id `doc_<id>`) tras recibirse; el archivo local se borra y el procesador descarga desde `Document.url` (disco local queda como fallback si Cloudinary no está configurado o falla). ⚠ Pendiente operativo: setear `CLOUDINARY_*` en Railway; documentos viejos sin `url` se pierden en el próximo redeploy (re-subirlos). Nota de seguridad: las URLs de Cloudinary son públicas-por-URL (uuid inadivinable, pero sin auth) — si los documentos son sensibles, migrar a signed URLs.
8. Cookies SameSite=None requieren `NODE_ENV=production` en el backend de Railway (verificar).
9. `metadataBase` del frontend apunta a `https://botforge.ai` (dominio placeholder); actualizar cuando exista dominio propio.

**Producto / UX**
10. Contadores de la landing (1.247 / 43 / 2 seg) son estáticos, no vienen de la BD.
11. ~~Inconsistencia landing vs límites reales~~ **RESUELTO (jul 2026)**: la landing muestra los números exactos de `planLimits.ts` (Básico 1 bot/1.000 msgs/10 docs, Profesional 10.000 msgs/50 docs, Agencia 100.000 msgs). Regla: `planLimits.ts` es la única fuente de verdad; si cambian los planes, tocar landing + pricing juntos.
12. Bots creados antes del rediseño de personalidades conservan el prompt viejo copiado en la BD.
13. Las imágenes adjuntas del asistente no se re-envían en turnos siguientes (solo el turno en que se mandan).
14. Historial del DashboardAssistant se pierde al cerrar el drawer (por diseño de spec, pero molesto para soporte largo). Además, en el historial re-enviado los turnos con tools se colapsan a su texto final (los tool_use/results intermedios no se re-envían, salvo el turno pendiente de confirmación).
14b. NotificationConfig: los eventos `new_conversation` y `daily_summary` se guardan pero no disparan emails todavía (solo `human_requested` está cableado al webhook). El asistente lo aclara al configurarlos.
14c. La detección de "pide humano" es por keywords simples (puede tener falsos positivos con palabras como "agente").
15. Onboarding paso 1 apunta al botón "Nuevo bot" del header, oculto en móvil → degrada a tooltip centrado.
16. Dos pestañas simultáneas pueden desloguearse entre sí al competir por la rotación del refresh token (falta período de gracia).
17. Refresh de sesión no cubre los fetch SSE directos (mitigado por el refresh proactivo del layout).
18. `formatDate` usa locale `es-AR` mientras el resto usa `es-PY` (cosmético).
19. Cambio de email del usuario no implementado (solo lectura en Perfil); eliminación de cuenta self-service tampoco (la política de privacidad la ofrece vía email).
20. Falta suite de tests (Jest configurado en backend, sin tests escritos).

**Integraciones externas (jul 2026)**
21. Google Drive OAuth2 incompleto: el backend guarda accessToken/refreshToken en DriveConnection (POST /drive/bots/:botId/connect) pero NO existe el flujo de autorización (pantalla de consentimiento, intercambio de code, refresh automático con expiresAt). Pendiente: credenciales en console.cloud.google.com + habilitar Drive API + implementar el redirect OAuth. Sin conexión, buscar_archivos_drive responde "no configurado".
22. Meta Cloud API: migración futura desde Twilio para multimedia nativa sin Cloudinary intermedio. Hoy las imágenes salen via Cloudinary (tag whatsapp_temp, limpiar en lote periódicamente desde el dashboard de Cloudinary).
23. Las cards de notification_config del Generative UI son informativas (disabled): no hay endpoint público para desactivar una NotificationConfig desde el frontend.
24. El streaming del chat web/widget (chat/stream, public) NO pasa por el loop de tools del tenant (streamear tool use rompería los deltas); solo usa RAG + prompt del tenant. Las tools del Agente Tipo B corren en WhatsApp y en el chat JSON.
25. Deepgram/Vision: el audio transcripto reemplaza al Body y el análisis de imagen se antepone como [contexto]; si las API keys faltan, los medios se ignoran silenciosamente (el bot responde solo al texto).

---

## 13. REGLAS DE NEGOCIO Y ESTILO — DIRECTIVAS ESTRICTAS

**DISEÑO**
- Paleta: negro `#0A0A0F`/`#09090F`, violeta `#7C3AED`, índigo `#4F46E5`, cian `#22D3EE`, blanco `#FFFFFF`/`#E8E8F0`, gris `#9CA3AF`/`#6E6E8E`
- Estilo: dark tech-noir, minimalista, profesional. El tema del dashboard vive en la clase `.theme-dashboard` (globals.css) — NO tocar las vars `:root` (las usan auth y legal en claro)
- Sin emojis en ninguna UI del dashboard
- Solo íconos de lucide-react (+ los 3 SVGs propios de `/public` y `personalidad-icons`)
- Responsivo mobile-first en todo el dashboard (drawer, FAB, grids 2→4, targets 44px, inputs 16px)
- Tipografía: Inter
- La landing (`app/page.tsx`) y las páginas de auth NO usan el tema del dashboard — no aplicarles `.theme-dashboard`
- Componentes Radix que portalean (Dialog, Select) necesitan `className="theme-dashboard"` explícita dentro del dashboard

**CÓDIGO**
- TypeScript estricto, cero errores antes de cada commit (`npm run typecheck` en ambos)
- Patrón de respuesta API: `{ data, error, meta }` — sin excepciones
- Autenticación siempre via middleware `requireAuth` (acepta cookie o Bearer)
- El frontend nunca toca la BD: todo pasa por la API (y por `lib/api.ts`, no fetch sueltos salvo SSE)
- Rate limiting en todos los endpoints públicos (global + limiter propio por endpoint sensible)
- Validar inputs con zod en todas las rutas
- Commits en español, un feature por commit

**SEGURIDAD**
- Passwords con bcrypt cost 12
- JWT access 15 min; refresh 7 días en cookie httpOnly (SameSite=None+Secure en prod, path `/api/v1/auth/refresh`), con rotación en cada refresh
- Verificar propiedad del recurso (`userId`) antes de cualquier operación (patrón `getOwnedBot`) — incluye TODAS las tools del asistente
- Tools destructivas del asistente (update_bot_config, disconnect_whatsapp, delete_document) SIEMPRE piden confirmación explícita antes de ejecutar
- Secretos solo en variables de entorno; nunca loguear tokens, passwords ni contenido de documentos
- La ANTHROPIC_API_KEY vive solo en el backend; el browser habla con proxies de Next

**ARQUITECTURA DE AGENTES DUAL (desde jul 2026)**
- AGENTE TIPO A (Plataforma): vive en el dashboard, habla con el dueño. Prompt fijo en `services/platformAgent.ts` (buildPlatformSystemPrompt). Tools PLATFORM_TOOLS en `routes/assistantDashboard.ts` (ejecución acoplada al protocolo SSE + confirmación).
- AGENTE TIPO B (Tenant): vive en WhatsApp/widget, habla con clientes finales. Todo en `services/tenantAgent.ts`: buildTenantSystemPrompt (personalidad del dueño + reglas base de BotForge), TENANT_TOOLS, executeTenantTool y runTenantAgentLoop (loop nativo de tool use, 5 rondas).
- Regla: el dueño controla la voz (bot.personality); BotForge controla las reglas de calidad (baseRules). Nunca mezclar tools de un agente en el otro.
- ai.ts delega su system prompt en buildTenantSystemPrompt: los tres canales del bot (WhatsApp, chat JSON, streaming) comparten el mismo prompt.

**MODELO DE IA**
- Modelo primario: `claude-fable-5`
- Fallback: `claude-opus-4-8` cuando fable-5 devuelve `stop_reason === 'refusal'` (patrón en `services/ai.ts`, `services/tenantAgent.ts`, `assistant.ts`, `assistantDashboard.ts`)
- Siempre chequear `stop_reason` antes de usar la respuesta
- Streaming SSE para toda respuesta conversacional (formato `data: {json}\n\n`, cierre `data: [DONE]` en asistentes / `{type:'done'}` en chat de bots)
- System prompts con `cache_control: ephemeral` donde el prefijo es estable (ai.ts)
- Embeddings: all-MiniLM-L6-v2 local, 384 dimensiones — el índice de Pinecone DEBE ser dimensión 384

---

## 14. TOOL REGISTRY DEL ASISTENTE DASHBOARD

Estado actual (jul 2026): el DashboardAssistant es un **agente con function
calling nativo** (bloques `tool_use`/`tool_result`, loop de hasta 5 rondas en
`assistantDashboard.ts`, ejecución directa contra Prisma con verificación de
propiedad por `userId` del JWT — nunca se confía en IDs que diga el modelo).
Las tools destructivas cortan el turno con `confirm_required`; el frontend
muestra confirmación y reanuda re-enviando los content blocks del turno +
`confirmedToolUseIds` (protocolo stateless). Cancelar descarta el turno local.

| Tool | Estado | Destructiva | Descripción |
|------|--------|-------------|-------------|
| get_bot_details | implementado | No | Bot + documentos + WhatsApp + últimas 3 conversaciones |
| update_bot_config | implementado | Sí (confirma) | Nombre, personalidad, idioma, activar/pausar |
| upload_instructivo_text | implementado | No | Crea documento .txt desde texto (respeta límite del plan, sube a Cloudinary, encola procesamiento) |
| disconnect_whatsapp | implementado | Sí (confirma) | Expira conexiones y limpia whatsappNumber |
| get_account_stats | implementado | No | Plan, contador mensual, mensajes hoy/mes/total, bots, docs, conversaciones |
| get_conversations | implementado | No | Lista paginada con preview (filtro opcional por bot) |
| send_notification_email | implementado | No | Upsert de NotificationConfig; hoy solo human_requested dispara emails reales |
| create_new_bot | implementado | No | Crea bot respetando límite del plan |
| delete_document | implementado | Sí (confirma) | Borra documento + chunks en Pinecone + archivo |
| request_plan_upgrade | implementado | No | Info del plan objetivo + link a /pricing (no crea sesión de Stripe) |
| update_bot_personality | implementado | No | Actualiza instrucciones guardando la anterior; emite card config_change con undo |
| toggle_bot_active | implementado | No | Activa/pausa el bot; emite card bot_status con toggle |
| search_web | implementado | No | Búsqueda web via Tavily (services/webSearch.ts); degrada sin API key |
| scrape_website | implementado | No | Firecrawl → archivo .txt → Cloudinary → cola de procesamiento (respeta límite de docs); emite card instructivo_preview |
| send_drive_image | implementado | No | Baja imagen de Drive del bot y la manda por WhatsApp via twilioMessaging; solo a clientes con conversación existente |
| análisis de imágenes | implementado | No | Content block image (base64, máx 5MB) |
| generate_instructivo (marcador) | implementado | No | `===INSTRUCTIVO_LISTO===` → textarea editable + descarga + puede subirse con upload_instructivo_text |

Eventos SSE del endpoint: `text`, `tool_start`, `tool_end`,
`assistant_blocks` (turno pendiente para reanudar), `confirm_required`,
`generative_ui` (card interactiva con toggle apply/undo, ver GenerativeUICard.tsx), `done`.
Emiten generative_ui: update_bot_personality (config_change),
toggle_bot_active (bot_status), upload_instructivo_text y scrape_website
(instructivo_preview), send_notification_email (notification_config, informativa).

**TOOL REGISTRY DEL AGENTE TIPO B** (`services/tenantAgent.ts`, TENANT_TOOLS —
corre en el webhook de WhatsApp y en el chat JSON via runTenantAgentLoop):

| Tool | Descripción |
|------|-------------|
| buscar_en_documentos | RAG on-demand: embedding + Pinecone (topK 5, threshold 0.3) filtrado por botId |
| buscar_archivos_drive | searchFileByName fuzzy en la carpeta del DriveConnection; la imagen queda en context.pendingImage (el base64 nunca entra al tool_result) y el canal la manda con sendImageMessage |
| derivar_a_humano | Email al dueño via NotificationConfig human_requested con el motivo |

Pendientes: request_whatsapp_connection (conexión guiada desde el chat),
eventos new_conversation y daily_summary de NotificationConfig (se guardan
pero no disparan emails todavía).

---

## 15. SESIÓN DE TRABAJO — CHECKLIST

Antes de empezar cualquier tarea compleja:
- [ ] Leer este archivo completo
- [ ] Identificar qué archivos toca la tarea
- [ ] Leer esos archivos antes de modificarlos
- [ ] Verificar que no hay conflictos con las reglas de sección 13

Al terminar cualquier tarea compleja:
- [ ] TypeScript sin errores (`npm run typecheck` en backend y frontend)
- [ ] Actualizar sección 12 (Pendientes) si corresponde
- [ ] Actualizar sección 14 (Tool Registry) si se agregaron tools
- [ ] `git add -A && git commit && git push` (mensaje en español, Railway despliega solo)
