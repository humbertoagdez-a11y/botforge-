# Arquitectura

**BotForge es una plataforma donde un negocio sube sus documentos y obtiene un
chatbot con IA que atiende a sus clientes por WhatsApp.**

## Los dos agentes

Es la distinción más importante del sistema. Son dos IA distintas, con prompts,
herramientas y públicos separados. Confundirlas es la fuente de errores más cara.

|  | **Agente Tipo A — Asistente de plataforma** | **Agente Tipo B — Bot tenant** |
|---|---|---|
| **A quién le habla** | Al **dueño del negocio**, dentro del panel | Al **cliente final** del negocio |
| **Dónde vive** | `services/platformAgent.ts` + `routes/assistantDashboard.ts` | `services/tenantAgent.ts` |
| **Para qué sirve** | Configurar el bot, subir documentos, diagnosticar por qué responde mal, abrir tickets | Vender, responder consultas, mandar fotos, derivar a un humano |
| **Quién define su personalidad** | BotForge (prompt fijo) | El **dueño**, en `bot.personality` |
| **Herramientas** | ~20 (crear bots, editar personalidad, leer conversaciones, cargar conocimiento…) | 2 a 4 según el bot: `buscar_en_documentos`, `enviar_imagen`, `derivar_a_humano`, y `buscar_archivos_drive` solo si tiene Drive |
| **Por dónde entra** | `/api/v1/assistant/dashboard` | `runTenantTurn()` |

### El bot tenant tiene un solo motor

WhatsApp, el Chat de prueba del panel y el widget público entran **todos** por
`runTenantTurn()` en `services/tenantAgent.ts`. Mismo modelo, mismas
herramientas, mismo límite de rondas, mismo umbral de RAG, mismo prompt.

No es casualidad: hubo un período en que el Chat de prueba corría por un motor
propio **sin herramientas**, y el dueño aprobaba un comportamiento que sus
clientes nunca recibían. Ver `03-DECISIONES-CLAVE.md`.

## Cómo fluye un mensaje de WhatsApp

```
Cliente escribe por WhatsApp
        │
        ▼
Meta Cloud API  ──POST──▶  /api/v1/whatsapp/webhook   (routes/metaWhatsapp.ts)
        │
        │  1. Responde 200 al instante (Meta reintenta si tardás)
        │  2. Marca "visto" + "escribiendo…"
        │  3. Si es audio → Deepgram lo transcribe
        │     Si es imagen → Google Vision la describe
        ▼
processInboundMessage()   (services/inboundMessage.ts)
        │
        │  4. ¿Es una respuesta a la encuesta NPS? → se atiende y termina acá
        │     (no gasta tokens ni cupo)
        │  5. ¿El bot tiene documentos listos? ¿El plan tiene cupo?
        │  6. Guarda el mensaje y arma el historial (últimos 10)
        ▼
runTenantTurn()   (services/tenantAgent.ts)
        │
        │  7. RAG: embedding de la consulta → Pinecone → top 5 chunks (umbral 0.3)
        │  8. Arma el prompt: bloque estable (cacheado) + contexto del RAG
        │  9. Llama a Anthropic con las herramientas del bot
        │ 10. Si pide una herramienta: la ejecuta y vuelve a llamar (hasta 5 rondas)
        ▼
Respuesta
        │
        │ 11. Manda el texto al cliente
        │ 12. Si el agente eligió una imagen, la manda adjunta
        │ 13. Suma 1 al contador mensual del dueño
        ▼
Cliente recibe la respuesta
```

## Servicios externos

| Servicio | Para qué |
|---|---|
| **Anthropic** | El cerebro de los dos agentes. `claude-sonnet-5` primario, `claude-opus-4-8` de respaldo si el primario rechaza |
| **Meta Cloud API** | Canal de WhatsApp: recibe mensajes, manda texto e imágenes, muestra "escribiendo…" |
| **Pinecone** | Base vectorial: guarda los fragmentos de los documentos y los busca por similitud |
| **Pagopar** | Pasarela de pago paraguaya (tarjeta, transferencia, giro, efectivo, QR) |
| **Cloudinary** | Hospeda documentos e imágenes. Meta descarga las imágenes de ahí |
| **Resend** | Todos los emails: verificación, recuperación, resumen diario, informes, tickets |
| **Deepgram** | Transcribe los audios que mandan los clientes por WhatsApp |
| **Google Vision** | Describe las imágenes que mandan los clientes, para que el bot entienda qué le mostraron |
| **Railway** | Hosting de backend y frontend. Despliega solo al hacer push a `master` |
| **Twilio** | Canal de WhatsApp anterior. **Apagado** (`TWILIO_WHATSAPP_ENABLED=false`), el código queda por si hay que volver |
| **Google Drive** | Integración construida pero **oculta al usuario**. Ver `03-DECISIONES-CLAVE.md` |

## Stack y dónde vive cada cosa

**Backend** — Node 20, Express, TypeScript estricto, Prisma sobre PostgreSQL.

```
backend/src/
  index.ts              Arranque, CORS, montaje de rutas y los 4 crons
  config/env.ts         Validación de variables de entorno (falla al arrancar si falta algo)
  middleware/
    auth.ts             requireAuth, requireVerifiedEmail
    planLimits.ts       LIMITS y todos los chequeos de cupo  ← fuente de verdad de planes
    errorHandler.ts     AppError y el handler global
  routes/               Un archivo por área (bots, documents, images, chat, reports, support…)
  services/
    tenantAgent.ts      Agente Tipo B: prompt, herramientas y loop  ← motor único del bot
    platformAgent.ts    Prompt del Agente Tipo A
    inboundMessage.ts   Pipeline de WhatsApp compartido por Meta y Twilio
    rag.ts              Única implementación de la búsqueda semántica
    weeklyReport*.ts    Informes semanales (generación, consolidado, PDF, envío)
    nps*.ts             Encuesta de satisfacción
  scripts/
    reporteDeMuestra.ts  npm run reporte:muestra → PDFs de ejemplo para revisar diseño
  jobs/processDocument.ts  Worker de Bull: trocea, embebe y sube a Pinecone
```

**Frontend** — Next.js 14 (App Router), Tailwind, shadcn/ui, zustand.

```
frontend/
  app/(dashboard)/      Panel del dueño (bots, conversaciones, reportes, soporte, precios)
  app/(legal)/          Privacidad, términos, cookies
  app/page.tsx          Landing pública
  app/widget/[botId]/   Widget embebible en el sitio del negocio
  components/           ChatWidget, BotImages, DashboardAssistant, Sidebar…
  lib/api.ts            Único cliente HTTP del backend
```

**Crons** (en `index.ts`, todos con timezone `America/Asuncion`):

| Cuándo | Qué hace |
|---|---|
| 21:00 diario | Resumen del día por email al dueño |
| 03:00 diario | Degrada planes vencidos y avisa a los que están por vencer |
| cada 10 min | Manda encuestas NPS a conversaciones que se enfriaron |
| Lunes 07:00 | Genera los informes semanales y el consolidado de Agencia |

## Verificar qué está desplegado

```bash
curl https://botforge-production-b16f.up.railway.app/health
```

Devuelve el commit que está corriendo. Comparalo contra `git log`. Railway
tarda ~2,5 minutos desde el push.
