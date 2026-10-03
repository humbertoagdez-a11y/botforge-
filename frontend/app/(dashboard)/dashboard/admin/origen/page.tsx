'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { api, type ApiError, type FilaEmbudo, type PanelOrigen } from '@/lib/api';

/**
 * Embudo por origen. Solo para el dueño de la plataforma: el backend
 * devuelve 403 a cualquier otra cuenta, y esta pagina no aparece en el menu.
 * Se entra por /admin/origen (redireccion en next.config).
 *
 * Todo sale de contadores por dia (embudo_diario): no hay personas, solo
 * numeros por origen.
 */

const PASOS = [
  { id: 'visita', corto: 'Visitas', largo: 'Visitas' },
  { id: 'registro', corto: 'Registros', largo: 'Se registraron' },
  { id: 'verificado', corto: 'Verif.', largo: 'Verificaron el email' },
  { id: 'bot', corto: 'Bots', largo: 'Crearon su bot' },
  { id: 'primer-mensaje', corto: '1er msj', largo: 'Probaron el chat' },
  { id: 'whatsapp', corto: 'WhatsApp', largo: 'Conectaron WhatsApp' },
  { id: 'pago-iniciado', corto: 'Pago ini.', largo: 'Empezaron a pagar' },
  { id: 'pagado', corto: 'Pagaron', largo: 'Pagaron' },
] as const;

const ORIGEN_LABEL: Record<string, string> = {
  'meta-anuncio-web': 'Anuncio Meta → web',
  'meta-anuncio-whatsapp': 'Anuncio Meta → WhatsApp',
  directo: 'Directo',
  otro: 'Otro sitio',
  'sin-dato': 'Sin dato (cuentas viejas)',
};
const ORDEN_ORIGEN = ['meta-anuncio-web', 'meta-anuncio-whatsapp', 'directo', 'otro', 'sin-dato'];

type Conteo = Record<string, number>;

function sumarPorTipo(filas: FilaEmbudo[]): Conteo {
  const c: Conteo = {};
  for (const f of filas) c[f.tipo] = (c[f.tipo] ?? 0) + f.cantidad;
  return c;
}

/** "12 de cada 100" o "—" si no hay base */
function deCada100(parte: number, total: number): string {
  if (!total) return '—';
  const x = (parte / total) * 100;
  return `${x < 10 && x > 0 ? x.toFixed(1) : Math.round(x)} de cada 100`;
}

const fechaCorta = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

export default function OrigenPage() {
  const [dias, setDias] = useState(30);
  const [panel, setPanel] = useState<PanelOrigen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [prohibido, setProhibido] = useState(false);

  useEffect(() => {
    setCargando(true);
    api.origen
      .panel(dias)
      .then((p) => {
        setPanel(p);
        setProhibido(false);
      })
      .catch((err: ApiError) => {
        if (err.statusCode === 403) setProhibido(true);
      })
      .finally(() => setCargando(false));
  }, [dias]);

  const porOrigen = useMemo(() => {
    if (!panel) return [];
    const grupos = new Map<string, FilaEmbudo[]>();
    for (const f of panel.filas) grupos.set(f.origen, [...(grupos.get(f.origen) ?? []), f]);
    return [...grupos.entries()]
      .map(([origen, filas]) => ({ origen, conteo: sumarPorTipo(filas) }))
      .sort((a, b) => ORDEN_ORIGEN.indexOf(a.origen) - ORDEN_ORIGEN.indexOf(b.origen));
  }, [panel]);

  const porDia = useMemo(() => {
    if (!panel) return [];
    const m = new Map<string, FilaEmbudo[]>();
    for (const f of panel.filas) {
      const k = `${f.fecha}|${f.origen}`;
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    return [...m.entries()]
      .map(([k, filas]) => {
        const [fecha, origen] = k.split('|');
        return { fecha, origen, conteo: sumarPorTipo(filas) };
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || ORDEN_ORIGEN.indexOf(a.origen) - ORDEN_ORIGEN.indexOf(b.origen));
  }, [panel]);

  const porAnuncio = useMemo(() => {
    if (!panel) return [];
    const m = new Map<string, Conteo>();
    for (const f of panel.filas) {
      if (f.tipo !== 'visita' && f.tipo !== 'registro') continue;
      if (!f.campana && !f.anuncio) continue;
      const k = `${f.origen}|${f.campana || '—'}|${f.anuncio || '—'}`;
      const c = m.get(k) ?? {};
      c[f.tipo] = (c[f.tipo] ?? 0) + f.cantidad;
      m.set(k, c);
    }
    return [...m.entries()]
      .map(([k, c]) => {
        const [origen, campana, anuncio] = k.split('|');
        return { origen, campana, anuncio, visitas: c.visita ?? 0, registros: c.registro ?? 0 };
      })
      .sort((a, b) => b.visitas - a.visitas);
  }, [panel]);

  if (cargando && !panel && !prohibido) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (prohibido) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Esta página es solo para el administrador de BotForge.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Origen y embudo</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Contadores anónimos por día{panel ? ` desde el ${fechaCorta(panel.desde)}` : ''}. Sin pixel ni cookies.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border p-1" role="group" aria-label="Período">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDias(d)}
              aria-pressed={dias === d}
              className={cn(
                'h-9 rounded-md px-3 text-xs font-medium',
                dias === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {d} días
            </button>
          ))}
        </div>
      </div>

      {/* ── Embudo por origen ─────────────────────────────────────────────── */}
      {porOrigen.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Todavía no hay datos en este período.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {porOrigen.map(({ origen, conteo }) => (
            <Card key={origen}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{ORIGEN_LABEL[origen] ?? origen}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  De cada 100 visitas, se registran: <strong className="text-foreground">{deCada100(conteo.registro ?? 0, conteo.visita ?? 0)}</strong>
                </p>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="divide-y divide-border/60">
                  {PASOS.map((p, i) => {
                    const n = conteo[p.id] ?? 0;
                    const anterior = i > 0 ? conteo[PASOS[i - 1].id] ?? 0 : 0;
                    return (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                        <span className="text-muted-foreground">{p.largo}</span>
                        <span className="flex items-baseline gap-2">
                          <strong className="font-mono tabular-nums">{n}</strong>
                          {i > 0 && (
                            <span className="w-24 text-right text-[11px] text-muted-foreground">
                              {anterior ? `${Math.round((n / anterior) * 100)} % del paso ant.` : '—'}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Cada paso se cuenta el día en que ocurre. Alguien que visita hoy y paga la semana que viene suma la visita
        hoy y el pago ese día: en períodos cortos las tasas entre pasos son aproximadas.
      </p>

      {/* ── Por día ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por día y por origen</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Día</th>
                  <th className="py-2 pr-2 font-medium">Origen</th>
                  {PASOS.map((p) => (
                    <th key={p.id} className="py-2 pr-2 text-right font-medium">{p.corto}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {porDia.map((f) => (
                  <tr key={`${f.fecha}-${f.origen}`} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-mono">{fechaCorta(f.fecha)}</td>
                    <td className="max-w-[140px] truncate py-1.5 pr-2">{ORIGEN_LABEL[f.origen] ?? f.origen}</td>
                    {PASOS.map((p) => (
                      <td key={p.id} className="py-1.5 pr-2 text-right font-mono tabular-nums">
                        {f.conteo[p.id] ?? <span className="text-muted-foreground/50">0</span>}
                      </td>
                    ))}
                  </tr>
                ))}
                {porDia.length === 0 && (
                  <tr>
                    <td colSpan={PASOS.length + 2} className="py-4 text-center text-muted-foreground">Sin datos</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Por campaña y anuncio ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por campaña y anuncio</CardTitle>
          <p className="text-xs text-muted-foreground">
            Solo visitas y registros: los pasos siguientes no guardan el anuncio, porque sería guardar el utm en la cuenta.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          {porAnuncio.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguna visita con utm_campaign o utm_content en este período.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {porAnuncio.map((a) => (
                <li key={`${a.origen}${a.campana}${a.anuncio}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.anuncio}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {a.campana} · {ORIGEN_LABEL[a.origen] ?? a.origen}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    <strong className="font-mono">{a.visitas}</strong> visitas
                    <br />
                    <strong className="font-mono">{a.registros}</strong> registros · {deCada100(a.registros, a.visitas)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Anuncio de WhatsApp ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Anuncio de WhatsApp (bot de ventas)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Conversaciones nuevas en el número de ventas. &laquo;Desde anuncio&raquo;: Meta mandó el dato del anuncio en el
            primer mensaje.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {(() => {
            const t = (panel?.whatsapp ?? []).reduce(
              (s, d) => ({ c: s.c + d.conversaciones, a: s.a + d.desdeAnuncio, l: s.l + d.leads }),
              { c: 0, a: 0, l: 0 },
            );
            return (
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ['Conversaciones', t.c],
                  ['Desde anuncio', t.a],
                  ['Marcadas lead', t.l],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-muted/40 p-2">
                    <p className="font-mono text-lg font-bold">{v}</p>
                    <p className="text-[11px] text-muted-foreground">{k}</p>
                  </div>
                ))}
              </div>
            );
          })()}
          {(panel?.whatsapp.length ?? 0) > 0 && (
            <ul className="divide-y divide-border/60 text-xs">
              {panel!.whatsapp.map((d) => (
                <li key={d.fecha} className="flex justify-between py-1.5">
                  <span className="font-mono">{fechaCorta(d.fecha)}</span>
                  <span className="text-muted-foreground">
                    {d.conversaciones} conv. · {d.desdeAnuncio} de anuncio · {d.leads} lead
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Cuántos de ellos se registraron <strong>no se puede saber</strong> sin guardar su teléfono, y no se guarda. El
            bot les pasa &laquo;mibotforge.com&raquo; sin utm, así que quien se registra desde ahí cuenta como
            &laquo;Directo&raquo;.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
