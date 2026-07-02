const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface ApiError extends Error {
  statusCode?: number;
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

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('bf_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isFormData = options.body instanceof FormData;

  const headers: HeadersInit = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers ?? {}),
  };

  const res = await fetch(`${API}${path}`, { ...options, headers });
  const json = (await res.json()) as { data: T; error: { message: string } | null };

  if (!res.ok) {
    const err: ApiError = new Error(json.error?.message ?? 'Error desconocido');
    err.statusCode = res.status;
    throw err;
  }

  return json.data;
}

async function requestWithMeta<T, M>(path: string): Promise<{ data: T; meta: M }> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const json = (await res.json()) as { data: T; error: { message: string } | null; meta: M };

  if (!res.ok) {
    const err: ApiError = new Error(json.error?.message ?? 'Error desconocido');
    err.statusCode = res.status;
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
  },

  bots: {
    list: () => request<Bot[]>('/api/v1/bots'),
    get: (id: string) => request<Bot>(`/api/v1/bots/${id}`),
    create: (data: { name: string; personality?: string; language: string }) =>
      request<Bot>('/api/v1/bots', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<{ name: string; personality: string; language: string }>) =>
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
};
