'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import DashboardAssistant from '@/components/DashboardAssistant';
import TechBackground from '@/components/TechBackground';
import { useAuthStore, useSidebarStore } from '@/lib/store';
import { refreshSession } from '@/lib/api';
import { Z } from '@/lib/z-index';

const REFRESH_MARGIN_MS = 2 * 60 * 1000;

// Lee el campo exp del JWT sin librerias (payload base64url → atob)
function tokenExpiresSoon(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(base64)) as { exp?: number };
    if (typeof decoded.exp !== 'number') return false;
    return decoded.exp * 1000 - Date.now() < REFRESH_MARGIN_MS;
  } catch {
    return false;
  }
}

function sectionTitle(pathname: string): string {
  if (pathname === '/dashboard') return 'Mis Bots';
  if (pathname.startsWith('/dashboard/conversations')) return 'Conversaciones';
  if (pathname.startsWith('/dashboard/stats')) return 'Estadísticas';
  if (pathname.startsWith('/dashboard/perfil')) return 'Perfil';
  if (pathname.startsWith('/pricing')) return 'Planes';
  if (pathname.startsWith('/dashboard/bots/new')) return 'Nuevo Bot';
  return 'BotForge';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, hasHydrated } = useAuthStore();
  // El drawer vive en el store para que OnboardingGuide, que se renderiza en
  // la page, pueda abrirlo al llegar al paso del Asistente
  const { sidebarOpen, openSidebar, closeSidebar } = useSidebarStore();

  // hasHydrated evita expulsar a un usuario con sesión válida: `token` vale
  // null durante el instante entre el primer render y que zustand termine de
  // leer localStorage, y ese null era indistinguible de "no hay sesión".
  useEffect(() => {
    if (hasHydrated && !token) router.replace('/auth/login');
  }, [token, hasHydrated, router]);

  // Cerrar el drawer al navegar
  useEffect(() => {
    closeSidebar();
  }, [pathname, closeSidebar]);

  // Refresh proactivo: al montar y cada 60s, si el token vence en <2 min
  // lo renueva antes de que cualquier request falle
  useEffect(() => {
    if (!token) return;
    const check = () => {
      if (tokenExpiresSoon(token)) void refreshSession();
    };
    check();
    const interval = setInterval(check, 60 * 1000);
    return () => clearInterval(interval);
  }, [token]);

  if (!token) return null;

  return (
    <div className="theme-dashboard relative flex h-screen overflow-hidden bg-background text-foreground">
      {/* Particulas detras del area de contenido */}
      <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-0 md:left-60">
        <TechBackground />
      </div>

      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />

      {/* Overlay del drawer en movil (justo debajo del sidebar) */}
      {sidebarOpen && (
        <div
          style={{ zIndex: Z.sidebar - 1 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={closeSidebar}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Navbar superior solo en movil */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-cyan-500/20 bg-[#07070E] px-4 md:hidden">
          <div className="flex items-center gap-2">
            <Image src="/asistente-logo.svg" alt="" width={24} height={24} unoptimized className="h-6 w-6" />
            <span className="text-sm font-bold text-[#E8E8F0]">BotForge</span>
          </div>
          <span className="text-sm font-medium text-[#6E6E8E]">{sectionTitle(pathname)}</span>
          <button
            type="button"
            onClick={openSidebar}
            aria-label="Abrir menú"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-cyan-400 transition-colors hover:bg-white/5"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>

        <main className="dot-grid-dark relative z-10 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Asistente global: FUERA del sidebar y del main. El aside tiene
          transform (drawer), que crea un containing block y atrapaba al
          panel fixed dentro de sus 240px — por eso vive aca, en el root */}
      <DashboardAssistant withTrigger />
    </div>
  );
}
