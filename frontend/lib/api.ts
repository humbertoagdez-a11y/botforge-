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
    register: (name: string, email: string, password: string) =>
      request<User>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      }),
    me: () => request<User>('/api/v1/auth/me'),
    logout: () => request<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' }),
    updateProfile: (name: string) =>
      request<User>('/api/v1/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ name }),
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
    update: (id: string, data: Partial<{ name: string; personality: string; language: string; isActive: boolean }>) =>
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

  chat: {
    send: (botId: string, message: string, conversationId?: string) =>
      request<{ conversationId: string; message: ChatMessage }>(`/api/v1/bots/${botId}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
      }),
  },

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
