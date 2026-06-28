# BotForge SaaS — Instrucciones para Claude Code

## Qué estamos construyendo
Plataforma SaaS donde empresas se registran, suben documentos (PDF, Word, Excel, URLs),
y se genera automáticamente un chatbot con IA conectado a WhatsApp Business.

## Stack tecnológico
- Backend: Node.js 20+ con TypeScript + Express
- ORM: Prisma con PostgreSQL
- IA: Anthropic Claude API con RAG (Retrieval-Augmented Generation)
- Vector DB: Pinecone
- Procesamiento docs: pdf-parse, mammoth, xlsx
- WhatsApp: Twilio Sandbox (dev) luego 360dialog (prod)
- Frontend: Next.js 14 + Tailwind CSS + shadcn/ui
- Queue: Bull + Redis

## Comandos útiles
- npm run dev: Levantar backend con hot reload
- npm run dev:frontend: Levantar Next.js
- npx prisma migrate dev: Aplicar migraciones
- npx prisma studio: GUI de base de datos
- docker-compose up -d: Levantar PostgreSQL y Redis
- npm run typecheck: Verificar tipos TypeScript
- npm run test: Correr tests con Jest

## Estructura del proyecto
botforge/
  backend/src/
    index.ts
    config/env.ts
    routes/ (auth, bots, documents, whatsapp, chat)
    middleware/ (auth, rateLimit, errorHandler)
    services/ (rag, ai, whatsapp, documentProcessor)
    jobs/processDocument.ts
    prisma/schema.prisma
  frontend/
    app/ (layout, page, auth pages, dashboard pages)
    components/ (BotCard, DocumentUploader, ChatPreview, WhatsAppConnect)
    lib/ (api.ts, store.ts)

## Base de datos
Tablas: users, bots, documents, chunks, conversations, messages
- User tiene muchos Bot
- Bot tiene muchos Document y Conversation
- Document tiene muchos Chunk (vectores embeddings)
- Conversation tiene muchos Message

## Variables de entorno requeridas
DATABASE_URL=postgresql://user:pass@localhost:5432/botforge
JWT_SECRET=string-aleatorio-largo
ANTHROPIC_API_KEY=sk-ant-...
PINECONE_API_KEY=...
PINECONE_INDEX=botforge
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
REDIS_URL=redis://localhost:6379
PORT=3001
FRONTEND_URL=http://localhost:3000
NODE_ENV=development

## Reglas de código
- TypeScript estricto, nunca usar any
- Validar inputs con zod en todas las rutas
- Respuestas API siempre en formato { data, error, meta }
- Rutas en kebab-case: /api/v1/bots/:id/documents
- Nunca loguear tokens, passwords ni contenido de documentos
- Variables de entorno siempre desde process.env, nunca hardcodeadas
- Un commit por feature, mensaje descriptivo en español

## Flujo principal del sistema
1. Registro/Login con JWT en httpOnly cookie
2. Crear bot: nombre, personalidad, idioma
3. Subir documentos: PDF/Word/Excel llega a /uploads, se encola en Bull
4. Procesar documento en background:
   - Extraer texto con pdf-parse/mammoth/xlsx
   - Dividir en chunks de 500 tokens con overlap de 50
   - Generar embedding por chunk con all-MiniLM-L6-v2
   - Guardar en Pinecone con metadata {botId, documentId}
5. Chat: pregunta -> embedding -> buscar chunks similares -> prompt con contexto -> Claude responde
6. WhatsApp: webhook recibe mensaje -> identifica bot por numero -> mismo flujo de chat -> responde via API

## Modelo de precios
- Free: /mes, 1 bot, 3 docs, 100 mensajes, sin WhatsApp
- Starter: /mes, 1 bot, 10 docs, 1000 mensajes, con WhatsApp
- Pro: /mes, 5 bots, 50 docs, 10000 mensajes, con WhatsApp
- Agency: /mes, bots ilimitados, docs ilimitados, 100000 mensajes, con WhatsApp

## Roadmap MVP
Fase 1 - Core (semana 1-2):
- Setup Docker + PostgreSQL + Prisma schema + Express base
- Auth: registro, login, JWT refresh token
- CRUD de bots
- Upload y procesamiento de documentos con RAG completo
- Chat de prueba en web

Fase 2 - WhatsApp (semana 3):
- Integracion Twilio Sandbox
- Webhook recibe y responde mensajes
- Panel de conversaciones en dashboard

Fase 3 - Producto (semana 4):
- Frontend completo con dashboard y wizard de creacion de bot
- Limites por plan con middleware de cuotas
- Integracion Stripe para pagos
- Deploy en Railway o Render

## Notas importantes
- Siempre correr docker-compose up -d antes de empezar a desarrollar
- Pinecone index necesita dimension 384 (modelo all-MiniLM-L6-v2)
- Twilio Sandbox requiere que el cliente active enviando un mensaje primero
- En desarrollo los archivos van a backend/uploads/, en produccion usar S3
- Correr npm run typecheck antes de cada commit
- Al compactar contexto con /compact, preservar: archivos modificados, fase actual, decisiones de arquitectura tomadas
