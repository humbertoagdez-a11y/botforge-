import { toast } from 'sonner';
import { useAuthStore } from './store';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  plan: 'FREE' | 'STARTER' | 'PRO' | 'AGENCY';
  /** CI o RUC. Solo se pide al pagar, así que es null hasta el primer checkout */
  documento?: string | null;
  createdAt: string;
  accessToken?: string;
}

export interface Bot {
  id: string;
  userId: string;
  name: string;
  personality: string;
  language: string;
  whatsappNumber: string | null;
  isActive: boolean;
  /** Encuesta de satisfacción al cliente final. Apagada por defecto. */
  npsEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { documents: number; conversations: number };
}

export interface BotDocument {
  id: string;
  botId: string;
  name: string;
  mimeType: string;
  fileSize: number;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'ERROR';
  errorMsg: string | null;
  createdAt: string;
  _count?: { chunks: number };
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  tokensUsed: number;
  createdAt: string;
}

export interface ActivityEvent {
  type: 'message' | 'document' | 'whatsapp';
  description: string;
  botName: string;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  botId: string;
  channel: string;
  channelId: string;
  createdAt: string;
  updatedAt: string;
  bot: { name: string };
  messages: { content: string; role: 'USER' | 'ASSISTANT'; createdAt: string }[];
  _count: { messages: number };
}

export interface ConversationDetail {
  id: string;
  botId: string;
  channel: string;
  channelId: string;
  createdAt: string;
  updatedAt: string;
  bot: { name: string };
  messages: { id: string; role: 'USER' | 'ASSISTANT'; content: string; createdAt: string }[];
}

export interface AccountStats {
  plan: 'FREE' | 'STARTER' | 'PRO' | 'AGENCY';
  planLimits: {
    bots: number | null;
    docsPerBot: number | null;
    monthlyMessages: number;
    whatsapp: boolean;
  };
  totalBots: number;
  activeBots: number;
  botsWithWhatsApp: number;
  botsWithoutWhatsApp: number;
  totalDocs: number;
  readyDocs: number;
  totalConversations: number;
  activeConversations: number;
  monthlyMessages: number;
  messagesToday: number;
  totalMessages: number;
  recentConversations: ConversationSummary[];
}

/** Respuesta del registro: ya no devuelve sesión, hay que verificar el email */
export interface RegisterPending {
  needsVerification: boolean;
  email: string;
}

export type NpsSentiment = 'PROMOTOR' | 'PASIVO' | 'DETRACTOR';

export interface NpsComment {
  id: string;
  score: number;
  sentiment: NpsSentiment;
  comment: string | null;
  reviewed: boolean;
  createdAt: string;
  bot: string;
}

export interface NpsStats {
  /** false cuando el plan no incluye NPS: la UI muestra la sección bloqueada */
  enabled: boolean;
  plan: 'FREE' | 'STARTER' | 'PRO' | 'AGENCY';
  total?: number;
  promedio?: number | null;
  preguntas?: number;
  tasaRespuesta?: number;
  sinRevisar?: number;
  distribucion?: Array<{ score: number; cantidad: number }>;
  evolucion?: Array<{ semana: string; promedio: number; cantidad: number }>;
  comentarios?: NpsComment[];
}

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'RESOLVED' | 'CLOSED';
export type TicketCategory =
  | 'CONSULTA' | 'RECLAMO' | 'INTEGRACION' | 'BOT_MAL_RESPONDE' | 'FACTURACION' | 'OTRO';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface SupportTicket {
  id: string;
  ref: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  context: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  bot: { name: string } | null;
  /** Solo en la vista de admin */
  user?: { name: string; email: string; plan: string };
  _count?: { messages: number };
}

export interface SupportTicketMessage {
  id: string;
  author: 'client' | 'admin';
  body: string;
  createdAt: string;
}

export interface SupportTicketDetail extends SupportTicket {
  user: { name: string; email: string; plan: string };
  messages: SupportTicketMessage[];
}

// ─── Reportes semanales ───────────────────────────────────────────────────────
// El contenido lo calcula el backend con queries sobre las conversaciones
// reales. Nada de esto lo redacta el modelo de IA.

export type TonoResumen = 'positivo' | 'neutral' | 'alerta';

/** Prosa armada por reglas en el backend, nunca por el modelo de IA */
export interface ResumenEjecutivo {
  titulo: string;
  tono: TonoResumen;
  parrafos: string[];
}

export interface WeeklyReportContent {
  totalConversations: number;
  totalMessages: number;
  botMessages?: number;
  topQuestions: Array<{ pregunta: string; cantidad: number }>;
  unansweredQuestions: Array<{ pregunta: string; veces: number }>;
  humanRequestedCount: number;
  humanRequestedReasons: Array<{ motivo: string; cantidad: number }>;
  peakHours: Array<{ hora: number; cantidad: number }>;
  /** Escala 1 a 5, igual que el resto del producto */
  npsAverage: number | null;
  npsResponseCount: number;
  npsPreviousAverage: number | null;
  prevConversations?: number | null;
  prevMessages?: number | null;
  resumen?: ResumenEjecutivo;
}

export interface PuntoHistorial {
  weekStart: string;
  conversations: number;
  messages: number;
  nps: number | null;
}

export interface WeeklyReportSummary {
  id: string;
  botId: string;
  botName: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  resumen: {
    totalConversations: number;
    totalMessages: number;
    humanRequestedCount: number;
    npsAverage: number | null;
    unansweredCount: number;
    titulo: string | null;
    tono: TonoResumen | null;
  };
}

export interface WeeklyReportDetail {
  id: string;
  botId: string;
  botName: string;
  weekStart: string;
  weekEnd: string;
  generatedAt?: string;
  content: WeeklyReportContent;
  historial: PuntoHistorial[];
}

export interface WeeklyReportList {
  reports: WeeklyReportSummary[];
  bots: Array<{ id: string; name: string }>;
  /** Lo decide el backend con el plan vigente, no el frontend con user.plan */
  capabilities: { consolidated: boolean };
}

// ─── Consolidado (Agencia) ────────────────────────────────────────────────────

export interface FilaConsolidada {
  botId: string;
  botName: string;
  conversations: number;
  messages: number;
  nps: number | null;
  npsResponses: number;
  unanswered: number;
  unansweredQuestions: number;
  deltaConversations: number | null;
}

export interface ConsolidatedContent {
  totalBots: number;
  totalConversations: number;
  totalMessages: number;
  totalUnanswered: number;
  npsAverage: number | null;
  npsResponseCount: number;
  prevConversations: number | null;
  bots: FilaConsolidada[];
  topUnanswered: Array<{ pregunta: string; veces: number; botName: string }>;
  resumen?: ResumenEjecutivo;
}

export interface ConsolidatedSummary {
  id: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  resumen: {
    totalBots: number;
    totalConversations: number;
    totalUnanswered: number;
    npsAverage: number | null;
    titulo: string | null;
    tono: TonoResumen | null;
  };
}

export interface ConsolidatedDetail {
  id: string;
  weekStart: string;
  weekEnd: string;
  generatedAt?: string;
  content: ConsolidatedContent;
}

/** Cupo del asistente de plataforma según el plan */
export interface AssistantQuota {
  allowed: boolean;
  scope: 'daily' | 'monthly' | null;
  remaining: number;
  dailyRemaining: number;
  limit: number;
  dailyLimit: number;
  resetsAt: string;
  plan: 'FREE' | 'STARTER' | 'PRO' | 'AGENCY';
}

export interface PagoparEstado {
  plan: string;
  montoTotal: number;
  pagado: boolean;
  /** true solo si el webhook validó el token y aplicó el plan */
  confirmadoPorWebhook: boolean;
  fechaPago: string | null;
  formaPago: string | null;
  cancelado: boolean;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const direct = localStorage.getItem('bf_token');
  if (direct) return direct;

  // Fallback: sesion persistida por zustand ('botforge-auth') cuando
  // 'bf_token' falta o quedo desincronizado — evita 401 con sesion valida
  try {
    const raw = localStorage.getItem('botforge-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string | null } };
    const token = parsed.state?.token ?? null;
    if (token) localStorage.setItem('bf_token', token);
    return token;
  } catch {
    return null;
  }
}

// ─── Refresh silencioso de sesion ────────────────────────────────────────────

// Endpoints donde un 401 NO debe disparar refresh: login/register (401 =
// credenciales invalidas), refresh (evita loop) y logout (mantiene su flujo)
const REFRESH_SKIP_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
];

// Promesa compartida: si varios requests reciben 401 a la vez, todos esperan
// el MISMO refresh en lugar de disparar varios en paralelo
let refreshPromise: Promise<string | null> | null = null;

export function refreshSession(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async (): Promise<string | null> => {
      try {
        const res = await fetch(`${API}/api/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return null;
        const json = (await res.json()) as {
          data: { accessToken: string; user: User } | null;
        };
        if (!json.data?.accessToken) return null;
        useAuthStore.getState().setAuth(json.data.accessToken, json.data.user);
        return json.data.accessToken;
      } catch {
        return null;
      }
    })();
    void refreshPromise.finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function handleSessionExpired(): void {
  useAuthStore.getState().clearAuth();
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/login')) {
    window.location.href = '/auth/login';
  }
}

async function fetchWithAuth(path: string, options: RequestInit = {}): Promise<Response> {
  const isFormData = options.body instanceof FormData;

  const doFetch = (token: string | null) => {
    const headers: HeadersInit = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    };
    // credentials include: necesario para que la cookie httpOnly del refresh
    // token se guarde y viaje entre dominios distintos (frontend/backend)
    return fetch(`${API}${path}`, { ...options, headers, credentials: 'include' });
  };

  let res = await doFetch(getToken());

  if (res.status === 401 && !REFRESH_SKIP_PATHS.some((p) => path.startsWith(p))) {
    const newToken = await refreshSession();
    if (newToken) {
      res = await doFetch(newToken);
      if (res.status !== 401) return res;
    }
    // Refresh fallido o el retry volvio a dar 401: sesion realmente vencida
    handleSessionExpired();
  }

  return res;
}

interface ApiErrorBody {
  code?: string;
  message: string;
}

// Toast global cuando un limite del plan se alcanza (429/403 PLAN_LIMIT_EXCEEDED)
function notifyPlanLimit(error: ApiErrorBody | null): void {
  if (typeof window === 'undefined') return;
  if (error?.code !== 'PLAN_LIMIT_EXCEEDED') return;
  toast.error(error.message, {
    action: {
      label: 'Mejorar plan',
      onClick: () => {
        window.location.href = '/pricing';
      },
    },
    duration: 8000,
  });
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetchWithAuth(path, options);
  const json = (await res.json()) as { data: T; error: ApiErrorBody | null };

  if (!res.ok) {
    notifyPlanLimit(json.error);
    const err: ApiError = new Error(json.error?.message ?? 'Error desconocido');
    err.statusCode = res.status;
    err.code = json.error?.code;
    throw err;
  }

  return json.data;
}

async function requestWithMeta<T, M>(path: string): Promise<{ data: T; meta: M }> {
  const res = await fetchWithAuth(path);
  const json = (await res.json()) as { data: T; error: ApiErrorBody | null; meta: M };

  if (!res.ok) {
    notifyPlanLimit(json.error);
    const err: ApiError = new Error(json.error?.message ?? 'Error desconocido');
    err.statusCode = res.status;
    err.code = json.error?.code;
    throw err;
  }

  return { data: json.data, meta: json.meta };
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<User>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    /** No devuelve sesión: hay que verificar el email antes de entrar */
    register: (name: string, email: string, password: string) =>
      request<RegisterPending>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      }),
    /** Verifica el código y recién ahí devuelve la sesión */
    verifyEmail: (email: string, code: string) =>
      request<User & { alreadyVerified?: boolean }>('/api/v1/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      }),
    /** Responde { sent: true } exista o no el usuario, a propósito */
    resendVerification: (email: string) =>
      request<{ sent: boolean }>('/api/v1/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    me: () => request<User>('/api/v1/auth/me'),
    logout: () => request<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' }),
    updateProfile: (name: string) =>
      request<User>('/api/v1/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    updateDocumento: (documento: string) =>
      request<User>('/api/v1/auth/documento', {
        method: 'PUT',
        body: JSON.stringify({ documento }),
      }),
    /** Responde { sent: true } exista o no el email, a propósito */
    forgotPassword: (email: string) =>
      request<{ sent: boolean }>('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    verifyResetToken: (token: string) =>
      request<{ valid: boolean }>(
        `/api/v1/auth/reset-password/verify?token=${encodeURIComponent(token)}`,
      ),
    resetPassword: (token: string, newPassword: string) =>
      request<{ success: boolean }>('/api/v1/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      }),
    updatePassword: (currentPassword: string, newPassword: string) =>
      request<{ success: boolean }>('/api/v1/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
  },

  bots: {
    list: () => request<Bot[]>('/api/v1/bots'),
    get: (id: string) => request<Bot>(`/api/v1/bots/${id}`),
    create: (data: { name: string; personality?: string; language: string }) =>
      request<Bot>('/api/v1/bots', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<{ name: string; personality: string; language: string; isActive: boolean; npsEnabled: boolean }>) =>
      request<Bot>(`/api/v1/bots/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/api/v1/bots/${id}`, { method: 'DELETE' }),
    generateInstructivo: (id: string, answers: Record<string, string>) =>
      request<{ instructivo: string }>(`/api/v1/bots/${id}/generate-instructivo`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      }),
  },

  documents: {
    list: (botId: string) => request<BotDocument[]>(`/api/v1/bots/${botId}/documents`),
    upload: (botId: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request<BotDocument>(`/api/v1/bots/${botId}/documents`, {
        method: 'POST',
        body: form,
      });
    },
    delete: (botId: string, docId: string) =>
      request<{ ok: boolean }>(`/api/v1/bots/${botId}/documents/${docId}`, { method: 'DELETE' }),
  },

  // El chat del bot no pasa por request(): es SSE y lo maneja ChatWidget
  // directamente contra /bots/:id/chat/stream. Acá vivía un api.chat.send que
  // pegaba a un POST /chat sin streaming; nadie lo llamaba y corría por un
  // motor distinto al de WhatsApp, así que se eliminaron los dos.

  stats: {
    get: () => request<AccountStats>('/api/v1/stats'),
    conversations: (page: number) =>
      requestWithMeta<ConversationSummary[], { total: number; page: number; pages: number }>(
        `/api/v1/stats/conversations?page=${page}`,
      ),
    conversation: (id: string) =>
      request<ConversationDetail>(`/api/v1/stats/conversations/${id}`),
  },

  activity: {
    get: () => request<ActivityEvent[]>('/api/v1/activity'),
  },

  nps: {
    get: (botId?: string) =>
      request<NpsStats>(`/api/v1/stats/nps${botId ? `?botId=${botId}` : ''}`),
    markReviewed: (id: string) =>
      request<{ id: string; reviewed: boolean }>(`/api/v1/stats/nps/${id}/reviewed`, {
        method: 'PATCH',
      }),
  },

  // Stripe dado de baja: las rutas del backend están desmontadas.
  // Se deja el bloque comentado por si hay que volver atrás.
  // stripe: {
  //   checkout: (plan: 'STARTER' | 'PRO' | 'AGENCY') =>
  //     request<{ url: string }>('/api/v1/stripe/checkout', {
  //       method: 'POST',
  //       body: JSON.stringify({ plan }),
  //     }),
  //   portal: () => request<{ url: string }>('/api/v1/stripe/portal', { method: 'POST' }),
  // },

  support: {
    list: () =>
      request<{ tickets: SupportTicket[]; isAdmin: boolean }>('/api/v1/support/tickets'),
    get: (id: string) =>
      request<{ ticket: SupportTicketDetail; isAdmin: boolean }>(`/api/v1/support/tickets/${id}`),
    create: (input: {
      category: TicketCategory;
      subject: string;
      body: string;
      priority?: TicketPriority;
      botId?: string;
    }) =>
      request<{ id: string; ref: string; status: TicketStatus }>('/api/v1/support/tickets', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    reply: (id: string, body: string) =>
      request<SupportTicketMessage>(`/api/v1/support/tickets/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    adminList: (status?: TicketStatus) =>
      request<{ tickets: SupportTicket[] }>(
        `/api/v1/support/admin/tickets${status ? `?status=${status}` : ''}`,
      ),
    adminUpdate: (id: string, data: { status?: TicketStatus; priority?: TicketPriority }) =>
      request<SupportTicket>(`/api/v1/support/admin/tickets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },

  reports: {
    list: (botId?: string) =>
      request<WeeklyReportList>(
        `/api/v1/reports${botId ? `?botId=${encodeURIComponent(botId)}` : ''}`,
      ),
    get: (id: string) => request<WeeklyReportDetail>(`/api/v1/reports/${id}`),
    /**
     * Genera a demanda el informe de la semana pasada, sin esperar al lunes.
     * Sin botId genera el de todos los bots más el consolidado si corresponde.
     */
    generate: (botId?: string) =>
      request<{
        weekStart: string;
        weekEnd: string;
        reports: Array<{ id: string; botId: string; botName: string }>;
        fallidos: string[];
        consolidatedId: string | null;
      }>('/api/v1/reports/generate', {
        method: 'POST',
        body: JSON.stringify(botId ? { botId } : {}),
      }),
    addKnowledge: (id: string, titulo: string, contenido: string) =>
      request<{ documentId: string; name: string; mensaje: string }>(
        `/api/v1/reports/${id}/knowledge`,
        { method: 'POST', body: JSON.stringify({ titulo, contenido }) },
      ),
    consolidated: {
      list: () => request<{ reports: ConsolidatedSummary[] }>('/api/v1/reports/consolidated'),
      get: (id: string) => request<ConsolidatedDetail>(`/api/v1/reports/consolidated/${id}`),
    },
    /**
     * Descarga el PDF, individual o consolidado. No usa request() porque la
     * respuesta es binaria, no el sobre { data, error }: parsearla como JSON
     * rompería el archivo.
     */
    exportPdf: async (
      id: string,
      tipo: 'individual' | 'consolidado' = 'individual',
    ): Promise<{ blob: Blob; filename: string }> => {
      const path =
        tipo === 'consolidado'
          ? `/api/v1/reports/consolidated/${id}/export`
          : `/api/v1/reports/${id}/export`;
      const res = await fetchWithAuth(path);
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: ApiErrorBody } | null;
        notifyPlanLimit(json?.error ?? null);
        const err: ApiError = new Error(json?.error?.message ?? 'No se pudo generar el PDF');
        err.statusCode = res.status;
        err.code = json?.error?.code;
        throw err;
      }
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      return { blob: await res.blob(), filename: match?.[1] ?? `informe-${id}.pdf` };
    },
  },

  pagopar: {
    checkout: (plan: 'STARTER' | 'PRO' | 'AGENCY') =>
      request<{ checkoutUrl: string; hashPedido: string }>('/api/v1/pagopar/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      }),
    consultar: (hashPedido: string) =>
      request<PagoparEstado>(`/api/v1/pagopar/consultar/${hashPedido}`),
  },

  assistant: {
    history: () =>
      request<{ messages: { role: 'user' | 'assistant'; content: string; createdAt: string }[] }>(
        '/api/v1/assistant/dashboard/history',
      ),
    clearHistory: () =>
      request<{ cleared: boolean }>('/api/v1/assistant/dashboard/history/clear', { method: 'POST' }),
    quota: () => request<AssistantQuota>('/api/v1/assistant/dashboard/quota'),
  },

  drive: {
    status: (botId: string) =>
      request<{ connected: boolean; folderName: string | null; since: string | null }>(
        `/api/v1/drive/bots/${botId}/status`,
      ),
    authorize: (botId: string) =>
      request<{ authUrl: string }>(`/api/v1/drive/bots/${botId}/authorize`),
    updateFolder: (botId: string, folderName: string) =>
      request<{ folderName: string; files: number }>(`/api/v1/drive/bots/${botId}/folder`, {
        method: 'PATCH',
        body: JSON.stringify({ folderName }),
      }),
    disconnect: (botId: string) =>
      request<{ disconnected: boolean }>(`/api/v1/drive/bots/${botId}/disconnect`, {
        method: 'DELETE',
      }),
  },
};
