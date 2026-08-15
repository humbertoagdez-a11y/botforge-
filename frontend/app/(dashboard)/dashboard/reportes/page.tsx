'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle, CalendarDays, Clock, Download, FileText, Layers, Loader2,
  MessageSquare, Plus, Sparkles, TrendingDown, TrendingUp, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  api,
  type ApiError,
  type ConsolidatedDetail,
  type ConsolidatedSummary,
  type PuntoHistorial,
  type ResumenEjecutivo,
  type TonoResumen,
  type WeeklyReportDetail,
  type WeeklyReportSummary,
} from '@/lib/api';

/** NPS en BotForge es escala 1 a 5, igual que en Estadísticas */
const NPS_MAX = 5;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** El informe cubre días paraguayos; se muestran como tales, no en la hora local del navegador */
function fechaPy(iso: string): string {
  const py = new Date(new Date(iso).getTime() - 4 * 3600 * 1000);
  return `${py.getUTCDate()} ${MESES[py.getUTCMonth()]}`;
}

function rangoSemana(weekStart: string, weekEnd: string): string {
  // weekEnd es exclusivo: el último día cubierto es el anterior
  const ultimo = new Date(new Date(weekEnd).getTime() - 1).toISOString();
  return `${fechaPy(weekStart)} al ${fechaPy(ultimo)}`;
}

const TONO_CLASS: Record<TonoResumen, string> = {
  positivo: 'border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-500',
  neutral: 'border-primary/40 bg-primary/[0.07] text-primary',
  alerta: 'border-orange-500/40 bg-orange-500/[0.07] text-orange-500',
};

export default function ReportesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <Rendimiento />
    </Suspense>
  );
}

function Rendimiento() {
  const searchParams = useSearchParams();

  const [reports, setReports] = useState<WeeklyReportSummary[]>([]);
  const [bots, setBots] = useState<Array<{ id: string; name: string }>>([]);
  const [puedeConsolidado, setPuedeConsolidado] = useState(false);
  const [consolidados, setConsolidados] = useState<ConsolidatedSummary[]>([]);

  /** Bot seleccionado, o 'consolidado' para la vista de cartera */
  const [vista, setVista] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<WeeklyReportDetail | null>(null);
  const [detalleCons, setDetalleCons] = useState<ConsolidatedDetail | null>(null);
  const [semanaId, setSemanaId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [exportando, setExportando] = useState(false);
  /** Mensaje del backend cuando el plan no incluye la sección */
  const [bloqueado, setBloqueado] = useState<string | null>(null);

  const [pregunta, setPregunta] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState('');
  const [guardando, setGuardando] = useState(false);

  const esConsolidado = vista === 'consolidado';

  // ── Carga inicial ─────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    try {
      const data = await api.reports.list();
      setReports(data.reports);
      setBots(data.bots);
      setPuedeConsolidado(data.capabilities.consolidated);
      setBloqueado(null);

      if (data.capabilities.consolidated) {
        // Un fallo acá no debe tumbar la pantalla: el consolidado es adicional
        api.reports.consolidated
          .list()
          .then((c) => setConsolidados(c.reports))
          .catch(() => { /* la cartera es opcional */ });
      }
      return data;
    } catch (err) {
      const e = err as ApiError;
      // 403 acá es siempre "tu plan no lo incluye": la pantalla se convierte
      // en la propuesta de mejora en vez de mostrar un error
      if (e.statusCode === 403) setBloqueado(e.message);
      else toast.error('No se pudieron cargar los informes');
      return null;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const data = await cargar();
      if (data) {
        const quiereConsolidado =
          searchParams.get('vista') === 'consolidado' && data.capabilities.consolidated;
        setVista(quiereConsolidado ? 'consolidado' : (data.reports[0]?.botId ?? data.bots[0]?.id ?? null));
      }
      setLoading(false);
    })();
    // searchParams solo importa en el primer montaje: después manda la selección del usuario
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargar]);

  // ── Semanas disponibles para la vista actual ──────────────────────────────
  const semanas = useMemo(
    () =>
      esConsolidado
        ? consolidados.map((c) => ({ id: c.id, weekStart: c.weekStart, weekEnd: c.weekEnd }))
        : reports
            .filter((r) => r.botId === vista)
            .map((r) => ({ id: r.id, weekStart: r.weekStart, weekEnd: r.weekEnd })),
    [esConsolidado, consolidados, reports, vista],
  );

  // Al cambiar de bot la semana elegida deja de existir: se cae a la más reciente
  useEffect(() => {
    if (semanas.length === 0) {
      setSemanaId(null);
      return;
    }
    setSemanaId((prev) => (prev && semanas.some((s) => s.id === prev) ? prev : semanas[0].id));
  }, [semanas]);

  // ── Detalle ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!semanaId) {
      setDetalle(null);
      setDetalleCons(null);
      return;
    }
    setLoadingDetalle(true);
    const p = esConsolidado
      ? api.reports.consolidated.get(semanaId).then((d) => { setDetalleCons(d); setDetalle(null); })
      : api.reports.get(semanaId).then((d) => { setDetalle(d); setDetalleCons(null); });
    p.catch(() => toast.error('No se pudo abrir el informe')).finally(() => setLoadingDetalle(false));
  }, [semanaId, esConsolidado]);

  // ── Acciones ──────────────────────────────────────────────────────────────
  async function handleGenerar() {
    setGenerando(true);
    try {
      const r = await api.reports.generate();
      if (r.fallidos.length > 0) {
        toast.warning(`Listo, pero falló el de: ${r.fallidos.join(', ')}`);
      } else {
        toast.success(
          r.reports.length === 1
            ? 'Informe generado'
            : `${r.reports.length} informes generados`,
        );
      }
      await cargar();
      if (r.consolidatedId) {
        const c = await api.reports.consolidated.list().catch(() => null);
        if (c) setConsolidados(c.reports);
      }
      // Se salta a lo recién generado para que se vea el resultado
      if (!esConsolidado && r.reports[0]) {
        setVista(r.reports[0].botId);
        setSemanaId(r.reports[0].id);
      } else if (esConsolidado && r.consolidatedId) {
        setSemanaId(r.consolidatedId);
      }
    } catch (err) {
      toast.error((err as ApiError).message);
    } finally {
      setGenerando(false);
    }
  }

  async function handleExport() {
    if (!semanaId) return;
    setExportando(true);
    try {
      const { blob, filename } = await api.reports.exportPdf(
        semanaId,
        esConsolidado ? 'consolidado' : 'individual',
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error((err as ApiError).message);
    } finally {
      setExportando(false);
    }
  }

  async function handleGuardarConocimiento() {
    if (!detalle || !pregunta || respuesta.trim().length < 10) return;
    setGuardando(true);
    try {
      const r = await api.reports.addKnowledge(detalle.id, pregunta.slice(0, 120), respuesta.trim());
      toast.success(r.mensaje);
      setPregunta(null);
      setRespuesta('');
    } catch (err) {
      toast.error((err as ApiError).message);
    } finally {
      setGuardando(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (bloqueado) return <Upsell mensaje={bloqueado} />;

  const sinInformes = reports.length === 0 && consolidados.length === 0;

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Rendimiento</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cómo le fue a {bots.length === 1 ? 'tu bot' : 'cada bot'} cada semana, con lo que
            conviene mejorar
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerar}
            disabled={generando || bots.length === 0}
          >
            {generando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
            <span className="hidden sm:inline">Generar la semana pasada</span>
            <span className="sm:hidden">Generar</span>
          </Button>
          {semanaId && (
            <Button size="sm" onClick={handleExport} disabled={exportando}>
              {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">
                Descargar {esConsolidado ? 'consolidado' : 'informe'} en PDF
              </span>
              <span className="sm:hidden">PDF</span>
            </Button>
          )}
        </div>
      </div>

      {sinInformes ? (
        <EstadoVacio onGenerar={handleGenerar} generando={generando} sinBots={bots.length === 0} />
      ) : (
        <>
          {/* ── Selector de bot + consolidado ─────────────────────────────── */}
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {bots.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setVista(b.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  vista === b.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-white/10 text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                {b.name}
              </button>
            ))}
            {puedeConsolidado && bots.length > 1 && (
              <button
                type="button"
                onClick={() => setVista('consolidado')}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  esConsolidado
                    ? 'border-cyan-400 bg-cyan-500/10 text-cyan-400'
                    : 'border-white/10 text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Consolidado
              </button>
            )}
          </div>

          {/* ── Selector de semana ─────────────────────────────────────────── */}
          {semanas.length > 0 && (
            <div className="mb-6 flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">Semana</span>
              <Select value={semanaId ?? undefined} onValueChange={setSemanaId}>
                <SelectTrigger className="h-9 w-full max-w-[280px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="theme-dashboard">
                  {semanas.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {rangoSemana(s.weekStart, s.weekEnd)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {loadingDetalle ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : semanas.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
                  {esConsolidado
                    ? 'Todavía no hay ningún consolidado. Se arma solo, los lunes, comparando todos tus bots.'
                    : 'Este bot todavía no tiene informes. El primero llega el lunes, o generalo ahora con el botón de arriba.'}
                </p>
              </CardContent>
            </Card>
          ) : esConsolidado && detalleCons ? (
            <VistaConsolidado detalle={detalleCons} />
          ) : detalle ? (
            <VistaIndividual
              detalle={detalle}
              onAgregar={(q) => { setPregunta(q); setRespuesta(''); }}
            />
          ) : null}
        </>
      )}

      {/* ── Agregar conocimiento ─────────────────────────────────────────── */}
      <Dialog open={pregunta !== null} onOpenChange={(o) => !o && setPregunta(null)}>
        <DialogContent className="theme-dashboard">
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
              <p className="text-xs text-muted-foreground">Queda activo en uno o dos minutos.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPregunta(null)}>Cancelar</Button>
              <Button onClick={handleGuardarConocimiento} disabled={guardando || respuesta.trim().length < 10}>
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

// ─── Vista de un bot ──────────────────────────────────────────────────────────

function VistaIndividual({
  detalle,
  onAgregar,
}: {
  detalle: WeeklyReportDetail;
  onAgregar: (pregunta: string) => void;
}) {
  const c = detalle.content;
  return (
    <div className="space-y-6">
      {c.resumen && <ResumenBloque resumen={c.resumen} />}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Metrica
          icon={MessageSquare}
          label="Conversaciones"
          value={c.totalConversations}
          hint={delta(c.totalConversations, c.prevConversations)}
        />
        <Metrica
          icon={MessageSquare}
          label="Mensajes"
          value={c.totalMessages}
          hint={delta(c.totalMessages, c.prevMessages)}
        />
        <Metrica
          icon={AlertCircle}
          label="No resueltas"
          value={c.humanRequestedCount}
          hint={c.humanRequestedCount === 0 ? 'resolvió todo' : 'derivadas a vos'}
          tone={c.humanRequestedCount > 0 ? 'warn' : 'ok'}
        />
        <Metrica
          icon={TrendingUp}
          label="Satisfacción"
          value={c.npsAverage === null ? '—' : `${c.npsAverage.toFixed(1)}/${NPS_MAX}`}
          hint={
            c.npsAverage !== null && c.npsPreviousAverage !== null
              ? `${c.npsAverage >= c.npsPreviousAverage ? '+' : '−'}${Math.abs(c.npsAverage - c.npsPreviousAverage).toFixed(1)} vs. anterior`
              : c.npsResponseCount > 0
                ? `${c.npsResponseCount} respuestas`
                : 'sin respuestas'
          }
          tone={c.npsAverage === null ? undefined : c.npsAverage >= 4 ? 'ok' : c.npsAverage < 3.5 ? 'warn' : undefined}
        />
      </div>

      {detalle.historial.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolución</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <Sparkline
              titulo="Conversaciones por semana"
              puntos={detalle.historial.map((h) => ({ x: h.weekStart, y: h.conversations }))}
              color="hsl(var(--primary))"
            />
            {detalle.historial.some((h) => h.nps !== null) && (
              <Sparkline
                titulo={`Satisfacción por semana (sobre ${NPS_MAX})`}
                puntos={detalle.historial.map((h) => ({ x: h.weekStart, y: h.nps }))}
                color="#22D3EE"
                min={1}
                max={NPS_MAX}
                decimals={1}
              />
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lo más consultado</CardTitle>
        </CardHeader>
        <CardContent>
          {c.topQuestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hubo consultas repetidas esta semana.</p>
          ) : (
            <Barras
              filas={c.topQuestions.map((q) => ({ label: q.pregunta, value: q.cantidad }))}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lo que tu bot no supo responder</CardTitle>
        </CardHeader>
        <CardContent>
          {c.unansweredQuestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tu bot respondió todo lo que le preguntaron. No quedó nada pendiente.
            </p>
          ) : (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                Cargá la respuesta y tu bot la va a saber la próxima vez.
              </p>
              <ul className="space-y-3">
                {c.unansweredQuestions.map((q, i) => (
                  <li
                    key={i}
                    className="flex flex-col gap-3 rounded-lg border border-orange-500/20 bg-orange-500/[0.04] p-3 sm:flex-row sm:items-start sm:justify-between"
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
                      className="w-full shrink-0 sm:w-auto"
                      onClick={() => onAgregar(q.pregunta)}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Horarios de mayor actividad</CardTitle>
        </CardHeader>
        <CardContent>
          {c.peakHours.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hubo actividad esta semana.</p>
          ) : (
            <>
              <Barras
                filas={[...c.peakHours]
                  .sort((a, b) => b.cantidad - a.cantidad)
                  .slice(0, 6)
                  .sort((a, b) => a.hora - b.hora)
                  .map((h) => ({
                    label: `${String(h.hora).padStart(2, '0')}:00`,
                    value: h.cantidad,
                    icon: true,
                  }))}
                color="bg-cyan-500"
              />
              <p className="pt-3 text-xs text-muted-foreground">Horario de Paraguay.</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Vista consolidada ────────────────────────────────────────────────────────

function VistaConsolidado({ detalle }: { detalle: ConsolidatedDetail }) {
  const c = detalle.content;
  const conNps = c.bots.filter((b) => b.nps !== null && b.npsResponses > 0);
  const conDeuda = [...c.bots].filter((b) => b.unanswered > 0).sort((a, b) => b.unanswered - a.unanswered);

  return (
    <div className="space-y-6">
      {c.resumen && <ResumenBloque resumen={c.resumen} />}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Metrica icon={Users} label="Bots activos" value={c.totalBots} />
        <Metrica
          icon={MessageSquare}
          label="Conversaciones"
          value={c.totalConversations}
          hint={delta(c.totalConversations, c.prevConversations)}
        />
        <Metrica
          icon={AlertCircle}
          label="No resueltas"
          value={c.totalUnanswered}
          hint="en toda la cartera"
          tone={c.totalUnanswered > 0 ? 'warn' : 'ok'}
        />
        <Metrica
          icon={TrendingUp}
          label="Satisfacción"
          value={c.npsAverage === null ? '—' : `${c.npsAverage.toFixed(1)}/${NPS_MAX}`}
          hint={c.npsResponseCount > 0 ? `${c.npsResponseCount} respuestas` : 'sin respuestas'}
          tone={c.npsAverage === null ? undefined : c.npsAverage >= 4 ? 'ok' : c.npsAverage < 3.5 ? 'warn' : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bot por bot</CardTitle>
        </CardHeader>
        <CardContent>
          {/* La tabla scrollea sola en móvil: la página nunca scrollea al costado */}
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">Bot</th>
                  <th className="py-2 px-2 text-right font-medium">Conv.</th>
                  <th className="py-2 px-2 text-right font-medium">Msj.</th>
                  <th className="py-2 px-2 text-right font-medium">NPS</th>
                  <th className="py-2 px-2 text-right font-medium">Sin resp.</th>
                  <th className="py-2 pl-2 text-right font-medium">vs. sem.</th>
                </tr>
              </thead>
              <tbody>
                {c.bots.map((b) => (
                  <tr key={b.botId} className="border-b border-white/5 last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{b.botName}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{b.conversations}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-muted-foreground">{b.messages}</td>
                    <td className={`py-2.5 px-2 text-right tabular-nums ${b.nps !== null && b.nps < 3.5 ? 'text-orange-500' : ''}`}>
                      {b.nps === null ? '—' : b.nps.toFixed(1)}
                    </td>
                    <td className={`py-2.5 px-2 text-right tabular-nums ${b.unanswered > 0 ? 'text-orange-500' : 'text-muted-foreground'}`}>
                      {b.unanswered}
                    </td>
                    <td className="py-2.5 pl-2 text-right tabular-nums">
                      {b.deltaConversations === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={b.deltaConversations > 0 ? 'text-emerald-500' : b.deltaConversations < 0 ? 'text-orange-500' : 'text-muted-foreground'}>
                          {b.deltaConversations > 0 ? '+' : b.deltaConversations < 0 ? '−' : ''}
                          {Math.round(Math.abs(b.deltaConversations) * 100)}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ranking por satisfacción</CardTitle>
          </CardHeader>
          <CardContent>
            {conNps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ningún bot recibió calificaciones esta semana. Activá la encuesta automática para
                empezar a medirlo.
              </p>
            ) : (
              <Barras
                max={NPS_MAX}
                filas={[...conNps]
                  .sort((a, b) => b.nps! - a.nps!)
                  .map((b) => ({
                    label: b.botName,
                    value: b.nps!,
                    valueLabel: b.nps!.toFixed(1),
                    color: b.nps! >= 4 ? 'bg-emerald-500' : b.nps! < 3.5 ? 'bg-orange-500' : undefined,
                  }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dónde meter mano primero</CardTitle>
          </CardHeader>
          <CardContent>
            {conDeuda.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ningún bot dejó consultas sin responder esta semana.
              </p>
            ) : (
              <Barras
                color="bg-orange-500"
                filas={conDeuda.map((b) => ({ label: b.botName, value: b.unanswered }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {c.topUnanswered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preguntas sin responder de toda la cartera</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {c.topUnanswered.map((q, i) => (
                <li
                  key={i}
                  className="flex items-start justify-between gap-3 rounded-lg border border-orange-500/20 bg-orange-500/[0.04] p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm">{q.pregunta}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{q.botName}</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-orange-500">{q.veces}×</span>
                </li>
              ))}
            </ul>
            <p className="pt-3 text-xs text-muted-foreground">
              Para cargarlas, abrí el informe del bot correspondiente.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Piezas compartidas ───────────────────────────────────────────────────────

function delta(actual: number, previo: number | null | undefined): string {
  if (previo === null || previo === undefined) return 'primera semana medida';
  const dif = actual - previo;
  if (dif === 0) return 'igual que la semana pasada';
  if (previo === 0) return `${dif > 0 ? '+' : '−'}${Math.abs(dif)} vs. anterior`;
  return `${dif > 0 ? '+' : '−'}${Math.abs(Math.round((dif / previo) * 100))}% vs. anterior`;
}

function ResumenBloque({ resumen }: { resumen: ResumenEjecutivo }) {
  const Icon = resumen.tono === 'positivo' ? TrendingUp : resumen.tono === 'alerta' ? AlertCircle : Sparkles;
  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${TONO_CLASS[resumen.tono]}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <h2 className="text-base font-semibold">{resumen.titulo}</h2>
      </div>
      <div className="mt-2.5 space-y-2">
        {resumen.parrafos.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-foreground/80">{p}</p>
        ))}
      </div>
    </div>
  );
}

function Metrica({
  icon: Icon, label, value, hint, tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${tone === 'warn' ? 'text-orange-500' : tone === 'ok' ? 'text-emerald-500' : ''}`} />
          <span className="truncate text-xs">{label}</span>
        </div>
        <p className="mt-1.5 text-xl font-bold sm:text-2xl">{value}</p>
        {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Barras({
  filas, color = 'bg-primary', max,
}: {
  filas: Array<{ label: string; value: number; valueLabel?: string; color?: string; icon?: boolean }>;
  color?: string;
  max?: number;
}) {
  const tope = Math.max(max ?? 0, ...filas.map((f) => f.value), 1);
  return (
    <div className="space-y-2.5">
      {filas.map((f, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="flex w-24 shrink-0 items-center gap-1 text-xs text-muted-foreground sm:w-40">
            {f.icon && <Clock className="h-3 w-3 shrink-0" />}
            <span className="truncate">{f.label}</span>
          </span>
          <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5">
            <div
              className={`h-full rounded-full ${f.color ?? color}`}
              style={{ width: `${Math.max(3, (f.value / tope) * 100)}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums">
            {f.valueLabel ?? f.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Línea de tendencia en SVG puro: son 8 puntos, no justifica traer una
 * librería de gráficos al bundle del panel.
 */
function Sparkline({
  titulo, puntos, color, min = 0, max, decimals = 0,
}: {
  titulo: string;
  puntos: Array<{ x: string; y: number | null }>;
  color: string;
  min?: number;
  max?: number;
  decimals?: number;
}) {
  const W = 300;
  const H = 90;
  const reales = puntos.map((p) => p.y).filter((y): y is number => y !== null);
  const tope = Math.max(max ?? 0, ...reales, min + 1);
  const n = puntos.length;
  const px = (i: number) => (n === 1 ? W / 2 : (W / (n - 1)) * i);
  const py = (y: number) => H - ((Math.min(Math.max(y, min), tope) - min) / (tope - min)) * H;

  const conY = puntos
    .map((p, i) => (p.y === null ? null : { x: px(i), y: py(p.y) }))
    .filter((p): p is { x: number; y: number } => p !== null);
  if (conY.length === 0) return null;

  const linea = conY.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${linea} L${conY[conY.length - 1].x.toFixed(1)},${H} L${conY[0].x.toFixed(1)},${H} Z`;
  const ultimo = conY[conY.length - 1];

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{titulo}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label={titulo}>
        <path d={area} fill={color} opacity={0.12} />
        <path d={linea} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <circle cx={ultimo.x} cy={ultimo.y} r={3} fill={color} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{fechaPy(puntos[0].x)}</span>
        <span className="font-medium text-foreground">
          {reales[reales.length - 1]?.toFixed(decimals)}
        </span>
        <span>{fechaPy(puntos[n - 1].x)}</span>
      </div>
    </div>
  );
}

// ─── Estado vacío ─────────────────────────────────────────────────────────────

const QUE_MUESTRA = [
  { icon: MessageSquare, titulo: 'Lo más consultado', texto: 'Las preguntas que más te repitieron, ordenadas' },
  { icon: AlertCircle, titulo: 'Lo que tu bot no supo', texto: 'Con un botón para enseñarle la respuesta ahí mismo' },
  { icon: TrendingUp, titulo: 'Satisfacción de tus clientes', texto: 'El promedio de la semana y si subió o bajó' },
  { icon: Clock, titulo: 'A qué hora te escriben', texto: 'Para saber cuándo conviene tener a alguien atento' },
];

function EstadoVacio({
  onGenerar, generando, sinBots,
}: {
  onGenerar: () => void;
  generando: boolean;
  sinBots: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6 sm:p-8">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <TrendingUp className="h-6 w-6 text-primary" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">Todos los lunes vas a encontrar acá cómo le fue a tu bot</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Un informe por bot, generado solo a las 7 de la mañana con las conversaciones reales de
            la semana que terminó. Te llega también por email, y lo podés bajar en PDF.
          </p>
        </div>

        <div className="mx-auto mt-7 grid max-w-2xl gap-3 sm:grid-cols-2">
          {QUE_MUESTRA.map(({ icon: Icon, titulo, texto }) => (
            <div key={titulo} className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3.5 text-left">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{titulo}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{texto}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-7 text-center">
          {sinBots ? (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                Todavía no tenés ningún bot activo para medir.
              </p>
              <Button asChild>
                <Link href="/dashboard">Crear mi primer bot</Link>
              </Button>
            </>
          ) : (
            <>
              <Button onClick={onGenerar} disabled={generando}>
                {generando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                Ver el de la semana pasada ahora
              </Button>
              <p className="mt-2.5 text-xs text-muted-foreground">
                No hace falta esperar al lunes para ver cómo se ve
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Plan sin la sección ──────────────────────────────────────────────────────

const BENEFICIOS = [
  'Enterarte de lo que tu bot no supo responder, antes de que el cliente se vaya con la competencia',
  'Ver si tus clientes están más o menos conformes que la semana pasada, con un número',
  'Saber a qué hora te escriben para no perder consultas',
  'Un PDF listo para mandarle a un socio o guardar de respaldo',
];

function Upsell({ mensaje }: { mensaje: string }) {
  const esConsolidado = mensaje.includes('Agencia');
  return (
    <div className="p-4 sm:p-6 md:p-8">
      <h1 className="text-2xl font-bold">Rendimiento</h1>
      <Card className="mx-auto mt-6 max-w-xl overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-primary to-cyan-400" />
        <CardContent className="p-6 sm:p-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">
            {esConsolidado
              ? 'Compará todos tus bots en una sola vista'
              : 'Dejá de adivinar cómo le va a tu bot'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{mensaje}</p>

          <ul className="mt-5 space-y-2.5">
            {(esConsolidado
              ? [
                  'Ranking de tus bots por volumen y por satisfacción',
                  'Cuál necesita atención primero, para no repartir el tiempo a ciegas',
                  'Un PDF consolidado para presentarle a tu cliente o a tu socio',
                ]
              : BENEFICIOS
            ).map((b) => (
              <li key={b} className="flex gap-2.5 text-sm">
                <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 rotate-180 text-emerald-500" />
                <span className="text-muted-foreground">{b}</span>
              </li>
            ))}
          </ul>

          <p className="mt-5 text-sm text-muted-foreground">
            Se genera solo todos los lunes y te llega por email. No hay nada que configurar.
          </p>

          <Button asChild className="mt-5 w-full sm:w-auto">
            <Link href="/pricing">Ver planes</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
