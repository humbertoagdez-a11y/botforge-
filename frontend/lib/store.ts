'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from './api';

interface AuthState {
  token: string | null;
  user: User | null;
  /** false hasta que zustand termina de leer 'botforge-auth' de localStorage.
      Ver el comentario junto a onRehydrateStorage más abajo: sin esto, un
      guard que redirige a /auth/login cuando `!token` puede disparar sobre
      el estado inicial (token=null) ANTES de que la sesión persistida se
      cargue, echando a un usuario que sí tenía sesión válida. */
  hasHydrated: boolean;
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

// ─── Drawer del sidebar en movil (NO persistido: es estado de UI) ────────────
// Vive en el store y no en el layout del dashboard porque OnboardingGuide se
// renderiza dentro de la page: como page y layout son arboles separados en el
// App Router, no hay forma de pasarle el setState por props.

interface SidebarState {
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
}

export const useSidebarStore = create<SidebarState>()((set) => ({
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
}));

// ─── Consentimiento de cookies (persistido, igual que la sesión) ─────────────

type CookieChoice = 'all' | 'necessary';

interface CookieConsentState {
  /** null = todavía no eligió, y por eso se muestra el banner */
  choice: CookieChoice | null;
  decidedAt: string | null;
  accept: (choice: CookieChoice) => void;
}

export const useCookieConsentStore = create<CookieConsentState>()(
  persist(
    (set) => ({
      choice: null,
      decidedAt: null,
      accept: (choice) => set({ choice, decidedAt: new Date().toISOString() }),
    }),
    { name: 'botforge-cookies' },
  ),
);

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      hasHydrated: false,
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
      /**
       * Corre cuando termina de leer localStorage — SIEMPRE, tenga o no
       * sesión guardada. Antes de esto, `token` vale `null` (el estado
       * inicial), indistinguible de "no hay sesión". El guard de
       * (dashboard)/layout.tsx hacía `if (!token) router.replace('/auth/login')`
       * en un useEffect que corre ANTES de que termine esta rehidratación:
       * en una recarga completa de una ruta profunda del dashboard, el
       * usuario con sesión válida era expulsado al login. Reproducido con
       * Playwright: /dashboard/stats y /dashboard/perfil rebotaban 5 de 5
       * veces en una recarga con sesión guardada y válida.
       *
       * Con `hasHydrated`, el guard espera a que este flag sea true antes
       * de decidir si hay o no sesión.
       */
      onRehydrateStorage: () => (state) => {
        if (typeof window === 'undefined') return;
        if (state?.token) localStorage.setItem('bf_token', state.token);
        useAuthStore.setState({ hasHydrated: true });
      },
    },
  ),
);
