'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart2, FileText, LayoutDashboard, LifeBuoy, LogOut, MessageSquare, UserCircle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Z } from '@/lib/z-index';
import { useAuthStore, useAssistantStore } from '@/lib/store';
import { api, type AccountStats } from '@/lib/api';
import { Button } from './ui/button';
import { Progress } from './ui/progress';

const NAV = [
  { href: '/dashboard', label: 'Mis Bots', icon: LayoutDashboard },
  { href: '/dashboard/conversations', label: 'Conversaciones', icon: MessageSquare },
  { href: '/dashboard/stats', label: 'Estadísticas', icon: BarChart2 },
  { href: '/dashboard/reportes', label: 'Reportes', icon: FileText },
  { href: '/dashboard/soporte', label: 'Soporte', icon: LifeBuoy },
  { href: '/dashboard/perfil', label: 'Perfil', icon: UserCircle },
  { href: '/pricing', label: 'Planes', icon: Zap },
];

const PLAN_LABEL: Record<string, string> = {
  FREE: 'Free',
  STARTER: 'Básico',
  PRO: 'Profesional',
  AGENCY: 'Agencia',
};

function PlanUsage({ stats }: { stats: AccountStats }) {
  const used = stats.monthlyMessages;
  const limit = stats.planLimits.monthlyMessages;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const nearLimit = pct >= 80;

  return (
    <div className="mx-3 mb-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{PLAN_LABEL[stats.plan] ?? stats.plan}</span>
        <span className={cn('font-mono text-[11px]', nearLimit ? 'font-medium text-orange-600' : 'text-muted-foreground')}>
          {used.toLocaleString('es-PY')}/{limit.toLocaleString('es-PY')}
        </span>
      </div>
      <Progress value={pct} className="mt-2 h-1.5" />
      <p className="mt-1.5 text-[10px] text-muted-foreground">mensajes este mes</p>
      {(nearLimit || stats.plan === 'FREE') && (
        <Link
          href="/pricing"
          className={cn(
            'mt-1.5 block text-[11px] font-medium hover:underline',
            nearLimit ? 'text-orange-600' : 'text-primary',
          )}
        >
          {nearLimit ? 'Estás cerca del límite — ver planes' : 'Mejorar plan'}
        </Link>
      )}
    </div>
  );
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, token, clearAuth } = useAuthStore();
  const { openAssistant } = useAssistantStore();
  const [stats, setStats] = useState<AccountStats | null>(null);

  useEffect(() => {
    // Guard: el Sidebar puede montarse antes de que el store rehidrate el token
    if (!token) return;
    api.stats.get().then(setStats).catch(() => { /* la barra de uso es opcional */ });
  }, [token]);

  async function handleLogout() {
    try { await api.auth.logout(); } catch { /* ignore */ }
    clearAuth();
    router.push('/');
  }

  return (
    <aside
      style={{ zIndex: Z.sidebar }}
      className={cn(
        // Base: drawer en movil (fixed, glassmorphism), fijo en desktop
        'fixed inset-y-0 left-0 flex h-full w-72 flex-col border-r bg-black/80 backdrop-blur-xl',
        'transform transition-transform duration-300',
        isOpen ? 'translate-x-0' : '-translate-x-full',
        'md:relative md:w-60 md:translate-x-0 md:bg-[#07070E] md:backdrop-blur-none md:transition-none',
      )}
    >
      <div className="group flex h-14 items-center gap-2 border-b px-4">
        <Image
          src="/logo-botforge.svg"
          alt="BotForge"
          width={28}
          height={28}
          unoptimized
          className="h-7 w-7 transition-transform motion-safe:group-hover:animate-[logo-bounce_0.5s_ease]"
        />
        <span className="font-semibold text-sm">BotForge</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={cn(
                'relative flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-l-2 border-cyan-400 bg-gradient-to-r from-cyan-500/10 to-primary/5 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-cyan-400 motion-safe:animate-[nav-indicator_0.25s_ease]" />
              )}
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Asistente: fuera de la nav, entre la navegacion y el uso del plan */}
      <div className="border-t border-white/10">
        <button
          type="button"
          data-onboarding="assistant"
          onClick={() => {
            // En movil el sidebar es un drawer: cerrarlo primero y abrir el
            // asistente cuando termina la animacion (350ms) para no colisionar
            const isMobile = window.matchMedia('(max-width: 767px)').matches;
            onClose();
            if (isMobile) {
              setTimeout(() => openAssistant(), 350);
            } else {
              openAssistant();
            }
          }}
          className="mx-3 my-3 flex min-h-[44px] w-[calc(100%-1.5rem)] cursor-pointer items-center gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 transition-colors hover:bg-cyan-500/15"
        >
          <Image src="/asistente-logo.svg" alt="" width={24} height={24} unoptimized className="h-6 w-6" />
          <span className="flex-1 text-left text-sm text-white/80">Asistente</span>
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            En línea
          </span>
        </button>
      </div>

      {stats && <PlanUsage stats={stats} />}

      <div className="border-t p-3">
        <div className="mb-2 flex items-center gap-2 px-3 py-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {user?.name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {PLAN_LABEL[user?.plan ?? ''] ?? user?.plan?.toLowerCase()}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
          Salir
        </Button>

        <nav className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-3 text-[10px] text-muted-foreground/70">
          <Link href="/terminos" className="hover:text-muted-foreground">Términos</Link>
          <Link href="/privacidad" className="hover:text-muted-foreground">Privacidad</Link>
          <Link href="/cookies" className="hover:text-muted-foreground">Cookies</Link>
        </nav>
      </div>
    </aside>
  );
}
