'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Bot,
  FileText,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Plus,
  Smartphone,
  Trash2,
  ExternalLink,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import OnboardingGuide, { ONBOARDING_KEY } from '@/components/OnboardingGuide';
import { api, type Bot as BotType, type AccountStats, type ActivityEvent } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { formatDate } from '@/lib/utils';

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    const duration = 1100;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span ref={ref}>{display.toLocaleString('es-PY')}</span>;
}

const LANG_LABEL: Record<string, string> = { es: 'Español', en: 'English', pt: 'Português' };
const CHANNEL_LABEL: Record<string, string> = { web: 'Web', whatsapp: 'WhatsApp', widget: 'Widget' };

const ONBOARDING_STEPS = [
  {
    icon: Bot,
    title: '1. Creá tu bot',
    desc: 'Elegí nombre, idioma y personalidad en menos de un minuto',
  },
  {
    icon: Upload,
    title: '2. Subí tu instructivo',
    desc: 'Cargá documentos o generá uno con IA respondiendo preguntas guiadas',
  },
  {
    icon: Smartphone,
    title: '3. Conectá WhatsApp',
    desc: 'Vinculá tu número y el bot empieza a responder solo',
  },
];

function EmptyState({ userName }: { userName: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
        <Image
          src="/mascota.svg"
          alt="Mascota de BotForge"
          width={180}
          height={180}
          unoptimized
          className="mb-4 h-28 w-28 md:h-40 md:w-40"
        />
        <h2 className="text-xl font-bold">
          {userName ? `Hola, ${userName}. ` : 'Hola. '}Creá tu primer asistente con IA
        </h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          En tres pasos tu negocio responde solo, las 24 horas
        </p>

        <div className="mt-8 grid w-full gap-4 sm:grid-cols-3">
          {ONBOARDING_STEPS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl border bg-card p-4 text-left">
              <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>

        {/* data-onboarding aca: la guia hace spotlight en el empty state,
            donde el boton del header ya no se renderiza */}
        <Button size="lg" className="mt-8" asChild data-onboarding="new-bot">
          <Link href="/dashboard/bots/new">
            <Plus className="h-4 w-4" /> Crear mi primer bot
          </Link>
        </Button>
      </div>
    </div>
  );
}

function MetricsRow({ stats }: { stats: AccountStats }) {
  const cards = [
    {
      icon: MessageSquare,
      label: 'Mensajes hoy',
      value: stats.messagesToday,
      sub: `${stats.totalMessages.toLocaleString('es-PY')} en total`,
    },
    {
      icon: MessagesSquare,
      label: 'Conversaciones activas',
      value: stats.activeConversations,
      sub: `${stats.totalConversations} en total`,
    },
    {
      icon: Smartphone,
      label: 'WhatsApp conectado',
      value: stats.botsWithWhatsApp,
      sub: stats.botsWithoutWhatsApp > 0
        ? `${stats.botsWithoutWhatsApp} sin conectar`
        : 'todos tus bots conectados',
    },
    {
      icon: FileText,
      label: 'Documentos procesados',
      value: stats.readyDocs,
      sub: stats.totalDocs > stats.readyDocs
        ? `${stats.totalDocs - stats.readyDocs} en proceso`
        : `${stats.totalDocs} en total`,
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ icon: Icon, label, value, sub }) => (
        <Card key={label} className="transition-colors hover:border-cyan-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-cyan-400/90">{label}</p>
              <Icon className="h-4 w-4 text-cyan-400/70" />
            </div>
            <p className="mt-1.5 text-2xl font-bold text-foreground"><AnimatedNumber value={value} /></p>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}

const ACTIVITY_ICON: Record<ActivityEvent['type'], { icon: typeof MessageSquare; className: string }> = {
  message: { icon: MessageSquare, className: 'text-violet-400' },
  document: { icon: FileText, className: 'text-blue-400' },
  whatsapp: { icon: Smartphone, className: 'text-green-400' },
};

function ActivitySection({ events }: { events: ActivityEvent[] }) {
  return (
    <Card className="mb-8">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Actividad reciente</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Tu actividad reciente aparecerá aquí
          </p>
        ) : (
          <div className="space-y-1">
            {events.slice(0, 8).map((ev, i) => {
              const { icon: Icon, className } = ACTIVITY_ICON[ev.type];
              return (
                <div key={`${ev.createdAt}-${i}`} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <Icon className={`h-4 w-4 shrink-0 ${className}`} />
                  <p className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                    {ev.description}
                    <span className="ml-1.5 text-xs text-muted-foreground">· {ev.botName}</span>
                  </p>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(ev.createdAt)}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 border-t pt-3 text-right">
          <Link href="/dashboard/stats" className="text-xs font-medium text-primary hover:underline">
            Ver estadísticas completas
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentConversations({ stats }: { stats: AccountStats }) {
  if (stats.recentConversations.length === 0) return null;

  return (
    <Card className="mb-8">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Últimas conversaciones</CardTitle>
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" asChild>
          <Link href="/dashboard/conversations">Ver todas</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {stats.recentConversations.map((conv) => {
          const last = conv.messages[0];
          return (
            <Link
              key={conv.id}
              href="/dashboard/conversations"
              className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{conv.bot.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {CHANNEL_LABEL[conv.channel] ?? conv.channel}
                  </Badge>
                </div>
                {last && (
                  <p className="truncate text-xs text-muted-foreground">
                    {last.role === 'USER' ? 'Cliente: ' : 'Bot: '}
                    {last.content}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDate(conv.updatedAt)}
              </span>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user, setAuth } = useAuthStore();
  const [bots, setBots] = useState<BotType[]>([]);
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    Promise.all([
      api.bots.list(),
      api.stats.get().catch(() => null),
      api.activity.get().catch(() => [] as ActivityEvent[]),
    ])
      .then(([b, s, a]) => {
        setBots(b);
        setStats(s);
        setActivity(a);
        try {
          if (b.length === 0 && !localStorage.getItem(ONBOARDING_KEY)) {
            setShowGuide(true);
          }
        } catch { /* localStorage no disponible */ }
      })
      .catch(() => toast.error('Error al cargar los bots'))
      .finally(() => setLoading(false));
  }, []);

  // Vuelta del checkout de Stripe: confirmar y refrescar el plan del usuario
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgrade') !== 'success') return;

    toast.success('Plan actualizado exitosamente');
    // Limpia el query param para no repetir el toast al recargar
    window.history.replaceState({}, '', '/dashboard');

    // El webhook de Stripe puede tardar unos segundos en actualizar el plan
    const refreshUser = async (attempt: number) => {
      try {
        const fresh = await api.auth.me();
        const currentToken = useAuthStore.getState().token;
        if (currentToken) setAuth(currentToken, fresh);
        if (fresh.plan === 'FREE' && attempt < 3) {
          setTimeout(() => void refreshUser(attempt + 1), 3000);
        }
      } catch { /* el sidebar lo refresca en la proxima carga */ }
    };
    void refreshUser(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmDelete(id: string) {
    try {
      await api.bots.delete(id);
      setBots((b) => b.filter((x) => x.id !== id));
      toast.success('Bot eliminado');
    } catch {
      toast.error('No se pudo eliminar el bot');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mis Bots</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {bots.length > 0 && user?.name ? `Hola, ${user.name}. ` : ''}
            Gestioná tus asistentes de IA
          </p>
        </div>
        {/* Solo con bots existentes: en el empty state el CTA es
            "Crear mi primer bot" (evita el boton duplicado) */}
        {bots.length > 0 && (
          <Button asChild className="shrink-0">
            <Link href="/dashboard/bots/new">
              <Plus className="h-4 w-4" />
              Nuevo bot
            </Link>
          </Button>
        )}
      </div>

      <OnboardingGuide open={showGuide} onFinish={() => setShowGuide(false)} />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : bots.length === 0 ? (
        <EmptyState userName={user?.name ?? ''} />
      ) : (
        <>
          {stats && <MetricsRow stats={stats} />}
          {stats && <RecentConversations stats={stats} />}
          <ActivitySection events={activity} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {bots.map((bot) => (
              <Card
                key={bot.id}
                className="group flex flex-col border-t-2 border-t-cyan-500/20 transition-all duration-300 hover:border-cyan-400/40 hover:shadow-lg hover:shadow-cyan-500/10 active:scale-[0.98] md:active:scale-100"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 transition-transform duration-300 motion-safe:group-hover:rotate-[5deg]">
                        <Bot className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{bot.name}</CardTitle>
                        <Badge variant="secondary" className="mt-0.5 text-[10px]">
                          {LANG_LABEL[bot.language] ?? bot.language}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={bot.isActive ? 'success' : 'outline'} className="text-[10px]">
                        {bot.isActive ? 'Activo' : 'Inactivo'}
                      </Badge>
                      {bot.whatsappNumber && (
                        <Badge variant="outline" className="gap-1 text-[10px] text-green-700">
                          <Smartphone className="h-2.5 w-2.5" /> WhatsApp
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pb-3">
                  <p className="line-clamp-2 text-xs text-muted-foreground">{bot.personality}</p>
                  <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      {bot._count?.documents ?? 0} docs
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {bot._count?.conversations ?? 0} chats
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Creado {formatDate(bot.createdAt)}
                  </p>
                </CardContent>
                <CardFooter className="gap-2 pt-3">
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <Link href={`/dashboard/bots/${bot.id}`}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeletingId(bot.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="theme-dashboard max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar bot?</DialogTitle>
            <DialogDescription>
              Se eliminará el bot con todos sus documentos y conversaciones. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeletingId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deletingId && confirmDelete(deletingId)}>
              Eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
