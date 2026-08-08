'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CalendarDays,
  Clock,
  Download,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Smile,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  api,
  type ApiError,
  type Bot,
  type WeeklyReportDetail,
  type WeeklyReportSummary,
} from '@/lib/api';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** El reporte cubre días paraguayos; se muestran como tales, no en hora local del navegador */
function fechaPy(iso: string): string {
  const py = new Date(new Date(iso).getTime() - 4 * 3600 * 1000);
  return `${py.getUTCDate()} ${MESES[py.getUTCMonth()]}`;
}

function rangoSemana(weekStart: string, weekEnd: string): string {
  // weekEnd es exclusivo: el último día cubierto es el anterior
  const ultimo = new Date(new Date(weekEnd).getTime() - 1).toISOString();
  return `${fechaPy(weekStart)} — ${fechaPy(ultimo)}`;
}

export default function ReportesPage() {
  const [reports, setReports] = useState<WeeklyReportSummary[] | null>(null);
  const [detail, setDetail] = useState<WeeklyReportDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** Mensaje del backend cuando el plan no incluye reportes */
  const [bloqueado, setBloqueado] = useState<string | null>(null);
  const [pregunta, setPregunta] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const { reports: lista } = await api.reports.list();
      setReports(lista);
      setBloqueado(null);
      if (lista.length > 0) setSelectedId((prev) => prev ?? lista[0].id);
    } catch (err) {
      const e = err as ApiError;
      // 403 acá es siempre "tu plan no lo incluye": la pantalla se convierte
      // en la propuesta de mejora en vez de mostrar un error
      if (e.statusCode === 403) setBloqueado(e.message);
      else toast.error('No se pudieron cargar los reportes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    api.bots.list().then(setBots).catch(() => { /* solo se usa para generar */ });
  }, [cargar]);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingDetail(true);
    api.reports
      .get(selectedId)
      .then(setDetail)
      .catch(() => toast.error('No se pudo abrir el reporte'))
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  async function handleGenerar() {
    if (bots.length === 0) {
      toast.error('Primero creá un bot');
      return;
    }
    setGenerating(true);
    try {
      const nuevo = await api.reports.generate(bots[0].id);
      toast.success('Reporte generado');
      await cargar();
      setSelectedId(nuevo.id);
      setDetail(nuevo);
    } catch (err) {
      toast.error((err as ApiError).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleExport() {
    if (!detail) return;
    setExporting(true);
    try {
      const { blob, filename } = await api.reports.exportPdf(detail.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error((err as ApiError).message);
    } finally {
      setExporting(false);
    }
  }

  async function handleGuardarConocimiento() {
    if (!detail || !pregunta || respuesta.trim().length < 10) return;
    setGuardando(true);
    try {
      const r = await api.reports.addKnowledge(detail.id, pregunta.slice(0, 120), respuesta.trim());
      toast.success(r.mensaje);
      setPregunta(null);
      setRespuesta('');
    } catch (err) {
      toast.error((err as ApiError).message);
    } finally {
      setGuardando(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Plan sin reportes ───────────────────────────────────────────────────────
  if (bloqueado) {
    return (
      <div className="p-6 md:p-8">
        <h1 className="text-2xl font-bold">Reportes semanales</h1>
        <Card className="mx-auto mt-8 max-w-lg text-center">
          <CardContent className="p-8">
            <Sparkles className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">Disponible desde el plan Profesional</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{bloqueado}</p>
            <p className="mx-auto mt-4 max-w-sm text-sm text-muted-foreground">
              Todos los lunes a la mañana te llega un resumen de cómo le fue a tu bot: qué le
              preguntaron, qué no supo responder y en qué horarios te escriben más.
            </p>
            <Button asChild className="mt-6">
              <Link href="/pricing">Ver planes</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const c = detail?.content;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reportes semanales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Se generan solos todos los lunes a las 7 de la mañana
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleGenerar} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Generar el de la semana pasada
          </Button>
          {detail && (
            <Button size="sm" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Descargar PDF
            </Button>
          )}
        </div>
      </div>

      {reports && reports.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <CalendarDays className="mx-auto h-9 w-9 text-muted-foreground" />
            <h2 className="mt-4 font-semibold">Todavía no hay reportes</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              El primero llega el lunes. Si querés verlo ahora, generá el de la semana pasada con
              el botón de arriba.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* ── Semanas ───────────────────────────────────────────────────── */}
          <div className="space-y-2">
            {reports?.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  r.id === selectedId ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                }`}
              >
                <p className="text-sm font-medium">{rangoSemana(r.weekStart, r.weekEnd)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{r.botName}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {r.resumen.totalMessages} mensajes · {r.resumen.totalConversations} conversaciones
                </p>
              </button>
            ))}
          </div>

          {/* ── Detalle ───────────────────────────────────────────────────── */}
          <div>
            {loadingDetail || !c || !detail ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold">{detail.botName}</h2>
                  <p className="text-sm text-muted-foreground">
                    Semana del {rangoSemana(detail.weekStart, detail.weekEnd)}
                  </p>
                </div>

                {/* Números */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard
                    icon={MessageSquare}
                    label="Conversaciones"
                    value={c.totalConversations}
                  />
                  <MetricCard icon={MessageSquare} label="Mensajes" value={c.totalMessages} />
                  <MetricCard
                    icon={AlertCircle}
                    label="No resueltas"
                    value={c.humanRequestedCount}
                    tone={c.humanRequestedCount > 0 ? 'warning' : undefined}
                  />
                  <MetricCard
                    icon={Smile}
                    label="Satisfacción"
                    value={c.npsAverage === null ? '—' : `${c.npsAverage}/10`}
                    hint={
                      c.npsAverage !== null && c.npsPreviousAverage !== null
                        ? `${c.npsAverage >= c.npsPreviousAverage ? '+' : ''}${(c.npsAverage - c.npsPreviousAverage).toFixed(2)} vs. semana anterior`
                        : c.npsResponseCount > 0
                          ? `${c.npsResponseCount} respuestas`
                          : 'Sin respuestas'
                    }
                    trend={
                      c.npsAverage !== null && c.npsPreviousAverage !== null
                        ? c.npsAverage >= c.npsPreviousAverage
                          ? 'up'
                          : 'down'
                        : undefined
                    }
                  />
                </div>

                {/* Lo más consultado */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Lo más consultado</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {c.topQuestions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No hubo consultas repetidas esta semana.
                      </p>
                    ) : (
                      <ol className="space-y-3">
                        {c.topQuestions.map((q, i) => (
                          <li key={i} className="flex gap-3">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                              {i + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm">{q.pregunta}</p>
                              <p className="text-xs text-muted-foreground">
                                {q.cantidad} {q.cantidad === 1 ? 'vez' : 'veces'}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </CardContent>
                </Card>

                {/* Sin responder */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Lo que tu bot no supo responder</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {c.unansweredQuestions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Tu bot respondió todo lo que le preguntaron. Muy bien.
                      </p>
                    ) : (
                      <>
                        <p className="mb-4 text-sm text-muted-foreground">
                          Agregá la respuesta y tu bot la va a saber la próxima vez.
                        </p>
                        <ul className="space-y-3">
                          {c.unansweredQuestions.map((q, i) => (
                            <li
                              key={i}
                              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm">{q.pregunta}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  Preguntado {q.veces} {q.veces === 1 ? 'vez' : 'veces'}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setPregunta(q.pregunta);
                                  setRespuesta('');
                                }}
                              >
                                <Plus className="h-4 w-4" />
                                Agregar esta información
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Horarios */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Horarios de mayor actividad</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {c.peakHours.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No hubo actividad esta semana.</p>
                    ) : (
                      <HourChart hours={c.peakHours} />
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Agregar conocimiento ────────────────────────────────────────────── */}
      <Dialog open={pregunta !== null} onOpenChange={(o) => !o && setPregunta(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enseñale esto a tu bot</DialogTitle>
            <DialogDescription>
              Se guarda como un documento nuevo. No toca nada de lo que tu bot ya sabe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Lo que te preguntaron</Label>
              <Input value={pregunta ?? ''} readOnly className="text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="respuesta">Lo que tu bot debería contestar</Label>
              <Textarea
                id="respuesta"
                rows={5}
                value={respuesta}
                onChange={(e) => setRespuesta(e.target.value)}
                placeholder="Escribí la respuesta como se la darías a un cliente."
              />
              <p className="text-xs text-muted-foreground">
                Queda activo en uno o dos minutos.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPregunta(null)}>
                Cancelar
              </Button>
              <Button
                onClick={handleGuardarConocimiento}
                disabled={guardando || respuesta.trim().length < 10}
              >
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                Agregar al bot
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  trend,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'warning';
  trend?: 'up' | 'down';
}) {
  const Trend = trend === 'up' ? TrendingUp : TrendingDown;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className={`h-4 w-4 ${tone === 'warning' ? 'text-orange-500' : ''}`} />
          <span className="text-xs">{label}</span>
        </div>
        <p className="mt-2 text-2xl font-bold">{value}</p>
        {hint && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {trend && <Trend className={`h-3 w-3 ${trend === 'up' ? 'text-emerald-500' : 'text-orange-500'}`} />}
            {hint}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function HourChart({ hours }: { hours: Array<{ hora: number; cantidad: number }> }) {
  const max = Math.max(...hours.map((h) => h.cantidad));
  // Se muestran las 6 franjas más cargadas, ordenadas por hora del día
  const top = [...hours].sort((a, b) => b.cantidad - a.cantidad).slice(0, 6).sort((a, b) => a.hora - b.hora);
  return (
    <div className="space-y-2">
      {top.map((h) => (
        <div key={h.hora} className="flex items-center gap-3">
          <span className="flex w-14 shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {String(h.hora).padStart(2, '0')}h
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(3, (h.cantidad / max) * 100)}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">{h.cantidad}</span>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">Horario de Paraguay.</p>
    </div>
  );
}
