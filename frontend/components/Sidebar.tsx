'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart2, LayoutDashboard, LogOut, MessageSquare, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/store';
import { api, type AccountStats } from '@/lib/api';
import { Button } from './ui/button';
import { Progress } from './ui/progress';

const NAV = [
  { href: '/dashboard', label: 'Mis Bots', icon: LayoutDashboard },
  { href: '/dashboard/conversations', label: 'Conversaciones', icon: MessageSquare },
  { href: '/dashboard/stats', label: 'Estadísticas', icon: BarChart2 },
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
        <span className={cn('text-[11px]', nearLimit ? 'font-medium text-orange-600' : 'text-muted-foreground')}>
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

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const [stats, setStats] = useState<AccountStats | null>(null);

  useEffect(() => {
    api.stats.get().then(setStats).catch(() => { /* la barra de uso es opcional */ });
  }, []);

  async function handleLogout() {
    try { await api.auth.logout(); } catch { /* ignore */ }
    clearAuth();
    router.push('/');
  }

  return (
    <aside className="flex h-full w-60 flex-col border-r bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
          <Zap className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-semibold text-sm">BotForge</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

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
      </div>
    </aside>
  );
}
