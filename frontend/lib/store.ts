'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from './api';

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
}

// ─── Estado global del Asistente (NO persistido: es estado de UI) ────────────

interface AssistantState {
  assistantOpen: boolean;
  assistantBotId: string | null;
  assistantBotName: string | null;
  openAssistant: (botId?: string | null, botName?: string | null) => void;
  closeAssistant: () => void;
}

export const useAssistantStore = create<AssistantState>()((set) => ({
  assistantOpen: false,
  assistantBotId: null,
  assistantBotName: null,
  openAssistant: (botId, botName) =>
    set({ assistantOpen: true, assistantBotId: botId ?? null, assistantBotName: botName ?? null }),
  closeAssistant: () =>
    set({ assistantOpen: false, assistantBotId: null, assistantBotName: null }),
}));

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => {
        if (typeof window !== 'undefined') localStorage.setItem('bf_token', token);
        set({ token, user });
      },
      clearAuth: () => {
        if (typeof window !== 'undefined') localStorage.removeItem('bf_token');
        set({ token: null, user: null });
      },
    }),
    {
      name: 'botforge-auth',
      // Re-sincroniza 'bf_token' (que lee api.ts) al rehidratar la sesion
      onRehydrateStorage: () => (state) => {
        if (typeof window === 'undefined') return;
        if (state?.token) localStorage.setItem('bf_token', state.token);
      },
    },
  ),
);
