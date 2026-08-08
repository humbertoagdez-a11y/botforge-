'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, LifeBuoy, MessageSquare, Plus, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  api,
  type SupportTicket,
  type SupportTicketDetail,
  type TicketCategory,
  type TicketStatus,
} from '@/lib/api';
import { useAssistantStore } from '@/lib/store';

const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En curso',
  WAITING_CLIENT: 'Esperando tu respuesta',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
};

/** Cian abierto, violeta en curso, ámbar esperando, verde resuelto, gris cerrado */
const STATUS_STYLE: Record<TicketStatus, string> = {
  OPEN: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  IN_PROGRESS: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  WAITING_CLIENT: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  RESOLVED: 'border-green-500/30 bg-green-500/10 text-green-300',
  CLOSED: 'border-white/15 bg-white/5 text-muted-foreground',
};

const CATEGORY_LABEL: Record<TicketCategory, string> = {
  CONSULTA: 'Consulta',
  RECLAMO: 'Reclamo',
  INTEGRACION: 'Integración',
  BOT_MAL_RESPONDE: 'El bot responde mal',
  FACTURACION: 'Facturación',
  OTRO: 'Otro',
};

const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED'];

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-PY', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Hilo de un ticket ────────────────────────────────────────────────────────

function TicketThread({
  ticketId,
  onBack,
  onChanged,
}: {
  ticketId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<{ ticket: SupportTicketDetail; isAdmin: boolean } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [respuesta, setRespuesta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      setData(await api.support.get(ticketId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar el ticket');
      onBack();
    } finally {
      setCargando(false);
    }
  }, [ticketId, onBack]);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.ticket.messages.length]);

  async function responder() {
    const body = respuesta.trim();
    if (!body || enviando) return;
    setEnviando(true);
    try {
      await api.support.reply(ticketId, body);
      setRespuesta('');
      await cargar();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo enviar');
    } finally {
      setEnviando(false);
    }
  }

  async function cambiarEstado(status: TicketStatus) {
    try {
      await api.support.adminUpdate(ticketId, { status });
      await cargar();
      onChanged();
      toast.success(`Ticket marcado como ${STATUS_LABEL[status].toLowerCase()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo actualizar');
    }
  }

  if (cargando) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) return null;

  const { ticket, isAdmin } = data;
  const cerrado = ticket.status === 'CLOSED';

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" className="mb-4 gap-1 text-muted-foreground" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" /> Mis consultas
      </Button>

      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold text-primary">{ticket.ref}</span>
          <StatusBadge status={ticket.status} />
          <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[ticket.category]}</span>
          {ticket.priority === 'HIGH' && (
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300">
              Prioridad alta
            </span>
          )}
        </div>
        <h1 className="mt-1.5 text-xl font-bold">{ticket.subject}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Abierto el {fecha(ticket.createdAt)}
          {ticket.bot ? ` · Bot: ${ticket.bot.name}` : ''}
          {isAdmin ? ` · ${ticket.user.name} (${ticket.user.email})` : ''}
        </p>
      </div>

      {/* El contexto lo arma el backend; solo el admin necesita verlo */}
      {isAdmin && ticket.context && (
        <Card className="mb-4 border-white/10 bg-white/[0.02]">
          <CardContent className="py-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Contexto de la cuenta
            </p>
            <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground">{ticket.context}</pre>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Cambiar estado:</span>
          {STATUSES.filter((s) => s !== ticket.status).map((s) => (
            <Button key={s} variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => void cambiarEstado(s)}>
              {STATUS_LABEL[s]}
            </Button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {ticket.messages.map((m) => {
          const propio = isAdmin ? m.author === 'admin' : m.author === 'client';
          return (
            <div key={m.id} className={`flex ${propio ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  m.author === 'admin'
                    ? 'border border-violet-500/25 bg-violet-500/10'
                    : 'border border-white/10 bg-white/[0.04]'
                }`}
              >
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {m.author === 'admin' ? 'Soporte BotForge' : isAdmin ? ticket.user.name : 'Vos'}
                  {' · '}
                  {new Date(m.createdAt).toLocaleString('es-PY', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
              </div>
            </div>
          );
        })}
        <div ref={finRef} />
      </div>

      {cerrado ? (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Este ticket está cerrado. Si el tema sigue, abrí uno nuevo.
        </p>
      ) : (
        <div className="mt-6">
          <Textarea
            rows={3}
            value={respuesta}
            onChange={(e) => setRespuesta(e.target.value)}
            placeholder="Escribí tu respuesta..."
            maxLength={5000}
            className="text-base"
          />
          <div className="mt-2 flex justify-end">
            <Button onClick={() => void responder()} disabled={enviando || !respuesta.trim()}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modal para abrir un ticket a mano ────────────────────────────────────────

function NuevoTicketDialog({
  abierto,
  onClose,
  onCreado,
}: {
  abierto: boolean;
  onClose: () => void;
  onCreado: () => void;
}) {
  const { openAssistant } = useAssistantStore();
  const [category, setCategory] = useState<TicketCategory>('CONSULTA');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function crear() {
    if (subject.trim().length < 5) { setError('El asunto tiene que ser un poco más específico'); return; }
    if (body.trim().length < 10) { setError('Contanos un poco más sobre el problema'); return; }
    setGuardando(true);
    setError('');
    try {
      const { ref } = await api.support.create({ category, subject: subject.trim(), body: body.trim() });
      toast.success(`Ticket ${ref} creado. Te mandamos un email de confirmación.`);
      setSubject('');
      setBody('');
      onCreado();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el ticket');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="theme-dashboard max-w-md">
        <DialogHeader>
          <DialogTitle>Abrir una consulta</DialogTitle>
          <DialogDescription>
            Le llega directo a Humberto, el creador de BotForge.
          </DialogDescription>
        </DialogHeader>

        {/* El asistente arma el contexto técnico solo, así que es mejor vía */}
        <button
          type="button"
          onClick={() => { onClose(); openAssistant(); }}
          className="flex w-full items-start gap-2.5 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.07] p-3 text-left transition-colors hover:bg-cyan-500/[0.12]"
        >
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
          <span className="text-xs leading-relaxed text-cyan-100/90">
            <strong className="font-semibold">Mejor: contale al Asistente.</strong> Arma el ticket con
            los datos de tu cuenta y tu bot ya incluidos, así se resuelve más rápido.
          </span>
        </button>

        <div className="mt-1 space-y-3">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as TicketCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="theme-dashboard">
                {(Object.keys(CATEGORY_LABEL) as TicketCategory[]).map((c) => (
                  <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="asunto">Asunto</Label>
            <Input
              id="asunto"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setError(''); }}
              placeholder="Ej: el bot no responde los precios"
              maxLength={120}
              className="text-base"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="detalle">Contanos qué pasa</Label>
            <Textarea
              id="detalle"
              rows={4}
              value={body}
              onChange={(e) => { setBody(e.target.value); setError(''); }}
              placeholder="Incluí lo que ya intentaste, así no repetimos pasos."
              maxLength={5000}
              className="text-base"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button onClick={() => void crear()} disabled={guardando}>
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Enviar consulta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Lista ────────────────────────────────────────────────────────────────────

function TicketRow({ t, admin, onOpen }: { t: SupportTicket; admin: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-1.5 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-bold text-primary">{t.ref}</span>
        <StatusBadge status={t.status} />
        {t.priority === 'HIGH' && (
          <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300">
            Alta
          </span>
        )}
      </div>
      <p className="text-sm font-medium">{t.subject}</p>
      <p className="text-xs text-muted-foreground">
        {CATEGORY_LABEL[t.category]} · {fecha(t.createdAt)}
        {t._count ? ` · ${t._count.messages} mensaje${t._count.messages === 1 ? '' : 's'}` : ''}
        {admin && t.user ? ` · ${t.user.name}` : ''}
        {t.bot ? ` · ${t.bot.name}` : ''}
      </p>
    </button>
  );
}

function Soporte() {
  const searchParams = useSearchParams();
  const { openAssistant } = useAssistantStore();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [todos, setTodos] = useState<SupportTicket[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [vistaAdmin, setVistaAdmin] = useState(false);
  const [filtro, setFiltro] = useState<TicketStatus | 'TODOS'>('TODOS');
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(searchParams.get('ticket'));
  const [nuevoAbierto, setNuevoAbierto] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const { tickets: mios, isAdmin: admin } = await api.support.list();
      setTickets(mios);
      setIsAdmin(admin);
      if (admin) {
        const { tickets: all } = await api.support.adminList();
        setTodos(all);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudieron cargar las consultas');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  if (abierto) {
    return (
      <div className="p-6 md:p-8">
        <TicketThread
          ticketId={abierto}
          onBack={() => { setAbierto(null); void cargar(); }}
          onChanged={() => void cargar()}
        />
      </div>
    );
  }

  const lista = vistaAdmin
    ? todos.filter((t) => filtro === 'TODOS' || t.status === filtro)
    : tickets;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Soporte</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consultas directas con el creador de BotForge.
          </p>
        </div>
        <Button onClick={() => setNuevoAbierto(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Abrir un ticket
        </Button>
      </div>

      {isAdmin && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Button
            variant={vistaAdmin ? 'outline' : 'default'}
            size="sm"
            onClick={() => setVistaAdmin(false)}
          >
            Mis consultas ({tickets.length})
          </Button>
          <Button
            variant={vistaAdmin ? 'default' : 'outline'}
            size="sm"
            onClick={() => setVistaAdmin(true)}
          >
            Todos los tickets ({todos.length})
          </Button>
          {vistaAdmin && (
            <Select value={filtro} onValueChange={(v) => setFiltro(v as TicketStatus | 'TODOS')}>
              <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="theme-dashboard">
                <SelectItem value="TODOS">Todos los estados</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : lista.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <LifeBuoy className="h-7 w-7 text-primary" />
            </div>
            <p className="font-medium">
              {vistaAdmin ? 'No hay tickets con ese filtro' : 'Todavía no abriste ninguna consulta'}
            </p>
            {!vistaAdmin && (
              <>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Si algo no anda o necesitás una integración que no existe, contale al Asistente:
                  arma el ticket con los datos de tu cuenta ya incluidos.
                </p>
                <div className="mt-1 flex gap-2">
                  <Button onClick={() => openAssistant()} className="gap-1.5">
                    <MessageSquare className="h-4 w-4" /> Hablar con el Asistente
                  </Button>
                  <Button variant="outline" onClick={() => setNuevoAbierto(true)}>
                    Escribir a mano
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {lista.map((t) => (
            <TicketRow key={t.id} t={t} admin={vistaAdmin} onOpen={() => setAbierto(t.id)} />
          ))}
        </div>
      )}

      <NuevoTicketDialog
        abierto={nuevoAbierto}
        onClose={() => setNuevoAbierto(false)}
        onCreado={() => void cargar()}
      />
    </div>
  );
}

export default function SoportePage() {
  // useSearchParams necesita un límite de Suspense para el prerender
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <Soporte />
    </Suspense>
  );
}
