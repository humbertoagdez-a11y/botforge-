'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Angry,
  Check,
  Frown,
  Loader2,
  Lock,
  Meh,
  MessageSquareQuote,
  Smile,
  SmilePlus,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type NpsComment, type NpsSentiment, type NpsStats } from '@/lib/api';

/** Nivel visual según el promedio (o el score puntual de un comentario) */
function nivel(valor: number) {
  if (valor >= 4.5) return { Icon: SmilePlus, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Excelente' };
  if (valor >= 3.5) return { Icon: Smile, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', label: 'Bien' };
  if (valor >= 2.5) return { Icon: Meh, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Regular' };
  return { Icon: Frown, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Malo' };
}

/** Color de cada barra de la distribución, del 1 al 5 */
const BARRA: Record<number, string> = {
  1: 'bg-red-500',
  2: 'bg-red-400',
  3: 'bg-amber-400',
  4: 'bg-cyan-400',
  5: 'bg-emerald-400',
};

const FILTROS: Array<{ id: 'TODOS' | NpsSentiment; label: string }> = [
  { id: 'TODOS', label: 'Todos' },
  { id: 'DETRACTOR', label: 'Detractores' },
  { id: 'PASIVO', label: 'Pasivos' },
  { id: 'PROMOTOR', label: 'Promotores' },
];

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-PY', { day: '2-digit', month: 'short' });
}

// ─── Sección bloqueada por plan ───────────────────────────────────────────────

function Bloqueada() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="font-semibold">Opinión de tus clientes</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Tu bot puede preguntarle a cada cliente qué tan bien lo atendió, y guardar sus
          comentarios acá. Se desbloquea desde el plan Básico.
        </p>
        <Button asChild className="mt-1">
          <Link href="/pricing">Ver planes</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Comentario ───────────────────────────────────────────────────────────────

function Comentario({ c, onVisto }: { c: NpsComment; onVisto: (id: string) => void }) {
  const n = nivel(c.score);
  const esDetractor = c.sentiment === 'DETRACTOR';
  return (
    <div
      className={`rounded-xl border p-4 ${esDetractor ? 'border-red-500/40 bg-red-500/[0.04]' : 'bg-card'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <n.Icon className={`h-4 w-4 shrink-0 ${n.color}`} />
        <span className={`text-sm font-bold ${n.color}`}>{c.score}/5</span>
        {!c.reviewed && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" title="Sin revisar" />
        )}
        <span className="text-xs text-muted-foreground">{fecha(c.createdAt)}</span>
        <span className="truncate text-xs text-muted-foreground">· {c.bot}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{c.comment}</p>
      {!c.reviewed && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 gap-1 text-xs text-muted-foreground"
          onClick={() => onVisto(c.id)}
        >
          <Check className="h-3.5 w-3.5" /> Marcar como visto
        </Button>
      )}
    </div>
  );
}

// ─── Sección completa ─────────────────────────────────────────────────────────

export default function NpsSection({ botId }: { botId?: string }) {
  const [data, setData] = useState<NpsStats | null>(null);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<'TODOS' | NpsSentiment>('TODOS');

  const cargar = useCallback(async () => {
    try {
      setData(await api.nps.get(botId));
    } catch {
      // La sección es informativa: si falla, no se muestra
    } finally {
      setCargando(false);
    }
  }, [botId]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function marcarVisto(id: string) {
    // Optimista: la lista se actualiza sola y se revierte si falla
    setData((d) =>
      d?.comentarios
        ? { ...d, comentarios: d.comentarios.map((c) => (c.id === id ? { ...c, reviewed: true } : c)), sinRevisar: Math.max(0, (d.sinRevisar ?? 1) - 1) }
        : d,
    );
    try {
      await api.nps.markReviewed(id);
    } catch {
      toast.error('No se pudo marcar como visto');
      void cargar();
    }
  }

  if (cargando) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) return null;
  if (!data.enabled) return <Bloqueada />;

  const total = data.total ?? 0;
  const promedio = data.promedio ?? null;
  const distribucion = data.distribucion ?? [];
  const comentarios = data.comentarios ?? [];
  const maxBarra = Math.max(1, ...distribucion.map((d) => d.cantidad));

  const visibles = comentarios.filter((c) => filtro === 'TODOS' || c.sentiment === filtro);

  if (total === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <MessageSquareQuote className="h-6 w-6 text-primary" />
          </div>
          <p className="font-semibold">Todavía no hay opiniones</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Activá la encuesta en la configuración de tu bot. Después de cada conversación
            le va a preguntar al cliente qué tan bien lo atendió, y las respuestas aparecen acá.
          </p>
        </CardContent>
      </Card>
    );
  }

  const n = nivel(promedio ?? 0);

  return (
    <div className="space-y-4">
      {/* Promedio + los tres números */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className={`${n.border} ${n.bg}`}>
          <CardContent className="flex items-center gap-4 py-6">
            <n.Icon className={`h-12 w-12 shrink-0 ${n.color}`} />
            <div className="min-w-0">
              <p className={`text-4xl font-bold leading-none ${n.color}`}>
                {promedio?.toFixed(1) ?? '—'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{n.label} · sobre 5</p>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardContent className="grid grid-cols-3 gap-2 py-6 text-center">
            <div>
              <p className="text-2xl font-bold">{total}</p>
              <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">respuestas</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{data.tasaRespuesta ?? 0}%</p>
              <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                de {data.preguntas ?? 0} preguntas
              </p>
            </div>
            <div>
              <p className={`text-2xl font-bold ${(data.sinRevisar ?? 0) > 0 ? 'text-red-400' : ''}`}>
                {data.sinRevisar ?? 0}
              </p>
              <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                detractores sin ver
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Distribución */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Cómo puntuaron</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[...distribucion].reverse().map((d) => (
            <div key={d.score} className="flex items-center gap-2">
              <span className="w-3 shrink-0 text-xs text-muted-foreground">{d.score}</span>
              <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5">
                <div
                  className={`h-full rounded-full ${BARRA[d.score]}`}
                  style={{ width: `${(d.cantidad / maxBarra) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {d.cantidad}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Evolución */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Evolución (8 semanas)</CardTitle>
        </CardHeader>
        <CardContent>
          {/* ResponsiveContainer evita el scroll horizontal en móvil */}
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.evolucion ?? []} margin={{ top: 5, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="semana" tick={{ fontSize: 10, fill: '#6E6E8E' }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tick={{ fontSize: 10, fill: '#6E6E8E' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: '#111120', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: '#E8E8F0' }}
                  formatter={(valor, _nombre, item) => {
                    const v = Number(valor ?? 0);
                    const cantidad = (item?.payload as { cantidad?: number } | undefined)?.cantidad ?? 0;
                    return [v === 0 ? 'sin datos' : `${v} (${cantidad} resp.)`, 'Promedio'];
                  }}
                />
                <Line type="monotone" dataKey="promedio" stroke="#22D3EE" strokeWidth={2} dot={{ r: 3, fill: '#22D3EE' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Comentarios: la parte más útil */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Qué dijeron</CardTitle>
          <div className="flex flex-wrap gap-1.5 pt-2">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltro(f.id)}
                className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                  filtro === f.id
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-white/10 text-muted-foreground hover:bg-white/5'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {visibles.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {comentarios.length === 0
                ? 'Todavía nadie dejó un comentario. Los números llegan antes que las palabras.'
                : 'No hay comentarios de ese tipo.'}
            </p>
          ) : (
            <div className="space-y-3">
              {/* Los detractores primero: es lo que hay que atender */}
              {[...visibles]
                .sort((a, b) => {
                  const peso = (s: NpsSentiment) => (s === 'DETRACTOR' ? 0 : s === 'PASIVO' ? 1 : 2);
                  return peso(a.sentiment) - peso(b.sentiment);
                })
                .map((c) => (
                  <Comentario key={c.id} c={c} onVisto={(id) => void marcarVisto(id)} />
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
