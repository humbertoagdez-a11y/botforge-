'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, IdCard, Loader2, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { api, type ApiError } from '@/lib/api';
import { pixelTrack } from '@/lib/metaPixel';
import { useAuthStore } from '@/lib/store';
import { PLANES, precioTexto, type PlanPago } from '@/lib/planes';

/**
 * Las tarjetas de planes, compartidas por /planes (pública) y /pricing (panel).
 *
 * Una sola implementación porque son la misma decisión de compra en dos
 * momentos distintos. Lo único que cambia es a dónde lleva el botón: sin
 * sesión, a registrarse; con sesión, directo al checkout de Pagopar.
 */

interface Props {
  /** Sin sesión el botón manda a registrarse en vez de abrir el checkout. */
  publica?: boolean;
}

export default function PlanesGrid({ publica = false }: Props) {
  const router = useRouter();
  const { token, user, setAuth } = useAuthStore();
  const [loading, setLoading] = useState<string | null>(null);
  /** Plan elegido que espera a que el usuario cargue su cédula */
  const [planPendiente, setPlanPendiente] = useState<PlanPago | null>(null);
  const [documento, setDocumento] = useState('');
  const [docError, setDocError] = useState('');
  const [guardandoDoc, setGuardandoDoc] = useState(false);

  /** Crea la orden en Pagopar y manda al checkout */
  async function irAlCheckout(planId: PlanPago) {
    setLoading(planId);
    try {
      const { checkoutUrl, hashPedido } = await api.pagopar.checkout(planId);
      if (!checkoutUrl) throw new Error('Error al crear la orden de pago');
      // Conversion: la orden existe y el usuario se va al checkout de Pagopar.
      // Se manda aca y no en el onClick porque antes del checkout puede
      // faltar la cedula, y ahi no hay intencion de pago concretada.
      const elegido = PLANES.find((p) => p.id === planId);
      pixelTrack('InitiateCheckout', {
        content_name: elegido?.nombre ?? planId,
        content_ids: [planId],
        content_type: 'product',
        value: elegido?.precioGs ?? 0,
        currency: 'PYG',
      });
      // Guardado para poder consultar el estado al volver del checkout, que es
      // de dónde vuelve el usuario sin ningún parámetro nuestro
      try {
        sessionStorage.setItem('bf_pagopar_hash', hashPedido);
      } catch {
        // sessionStorage bloqueado: se pedirá el hash por query param
      }
      window.location.href = checkoutUrl;
    } catch (err) {
      const code = (err as ApiError).code;
      if (code === 'DOCUMENTO_REQUERIDO') {
        // El user del store puede estar desactualizado: el backend manda
        setPlanPendiente(planId);
      } else if (code === 'PAGOPAR_NOT_CONFIGURED') {
        toast.info('Los pagos estarán disponibles pronto');
      } else {
        toast.error(err instanceof Error ? err.message : 'Error al procesar el pago');
      }
      setLoading(null);
    }
  }

  function handleUpgrade(planId: PlanPago) {
    // Sin sesión no hay a quién cobrarle todavía: primero la cuenta. El plan
    // viaja en la query para poder retomar la compra al terminar el registro.
    if (!token) {
      router.push(`/auth/register?plan=${planId}`);
      return;
    }
    // Pagopar exige el documento del comprador: si no lo tenemos, se pide antes
    if (!user?.documento) {
      setDocumento('');
      setDocError('');
      setPlanPendiente(planId);
      return;
    }
    void irAlCheckout(planId);
  }

  async function confirmarDocumento() {
    const valor = documento.trim();
    if (!/^\d{6,9}$/.test(valor)) {
      setDocError('Ingresá entre 6 y 9 números, sin puntos ni guiones');
      return;
    }
    if (!token || !planPendiente) return;

    setGuardandoDoc(true);
    try {
      const actualizado = await api.auth.updateDocumento(valor);
      setAuth(token, actualizado);
      const plan = planPendiente;
      setPlanPendiente(null);
      await irAlCheckout(plan);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'No se pudo guardar el documento');
    } finally {
      setGuardandoDoc(false);
    }
  }

  return (
    <>
      <div className="grid items-stretch gap-6 md:grid-cols-2 xl:grid-cols-4">
        {PLANES.map((plan) => {
          const esActual = !publica && user?.plan === plan.id;
          const pagable = plan.id !== 'FREE' ? (plan.id as PlanPago) : null;
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-xl border p-6 ${
                plan.destacado ? 'border-primary bg-primary/5 shadow-lg' : 'bg-card'
              }`}
            >
              {plan.destacado && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="gap-1 whitespace-nowrap text-xs">
                    <Zap className="h-3 w-3" /> El más elegido
                  </Badge>
                </div>
              )}
              {esActual && (
                <div className="absolute -top-3 right-4">
                  <Badge variant="success" className="text-xs">Plan actual</Badge>
                </div>
              )}

              {/* text-foreground explicito: fuera del layout del panel no hay
                  ningun ancestro que fije el color, y el nombre y el precio
                  quedaban casi invisibles sobre el fondo oscuro. */}
              <div className="mb-4 text-foreground">
                <p className="font-semibold text-foreground">{plan.nombre}</p>
                <div className="mt-1">
                  {plan.precioGs === 0 ? (
                    <p className="text-3xl font-bold text-foreground">Gratis</p>
                  ) : (
                    <>
                      <p className="text-3xl font-bold text-foreground">{precioTexto(plan)}</p>
                      <p className="text-xs text-muted-foreground">≈ USD {plan.precioUsd} por mes</p>
                    </>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{plan.para}</p>
              </div>

              {/* El número que decide la compra va solo y con peso propio: un
                  negocio compara cuántas consultas puede atender, no cuántas
                  funciones hay en la lista. */}
              <div className="mb-4 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                <p className="text-xl font-bold leading-none text-foreground">
                  {plan.mensajesPorMes.toLocaleString('es-PY')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  respuestas a tus clientes por mes
                </p>
              </div>

              <ul className="mb-6 flex-1 space-y-2 text-sm">
                {plan.beneficios.map((f) => (
                  <li key={f.texto} className="flex items-start gap-2">
                    {/* Lo que suma respecto del plan anterior se destaca: es lo
                        que responde "por qué pagar más" de un vistazo */}
                    {f.nuevo ? (
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                    )}
                    <span className={f.nuevo ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                      {f.texto}
                    </span>
                  </li>
                ))}
              </ul>

              {plan.nota && <p className="mb-4 text-xs text-muted-foreground">{plan.nota}</p>}

              {pagable ? (
                <Button
                  variant={plan.destacado ? 'default' : 'outline'}
                  className="w-full"
                  disabled={esActual || loading !== null}
                  onClick={() => handleUpgrade(pagable)}
                >
                  {loading === pagable && <Loader2 className="h-4 w-4 animate-spin" />}
                  {esActual ? 'Plan actual' : publica ? `Elegir ${plan.nombre}` : 'Contratar'}
                </Button>
              ) : publica ? (
                <Button variant="outline" className="w-full" onClick={() => router.push('/auth/register')}>
                  Empezar gratis
                </Button>
              ) : (
                <Button variant="outline" className="w-full" disabled>
                  {esActual ? 'Plan actual' : 'Gratis'}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagopar exige el documento del comprador; se pide acá y no en el
          registro para no sumarle fricción a quien nunca va a pagar */}
      <Dialog
        open={planPendiente !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setPlanPendiente(null);
            setLoading(null);
          }
        }}
      >
        <DialogContent className="theme-dashboard max-w-sm">
          <DialogHeader>
            <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10 ring-1 ring-cyan-500/20 sm:mx-0">
              <IdCard className="h-6 w-6 text-cyan-400" />
            </div>
            <DialogTitle>Necesitamos tu número de cédula</DialogTitle>
            <DialogDescription>
              Pagopar lo pide para emitir el comprobante del pago. Lo guardamos una sola vez.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-1.5">
            <Label htmlFor="documento">Cédula de identidad</Label>
            <div className="relative">
              <IdCard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="documento"
                inputMode="numeric"
                autoComplete="off"
                placeholder="1234567"
                value={documento}
                onChange={(e) => {
                  // Solo dígitos: evita puntos y guiones que Pagopar rechaza
                  setDocumento(e.target.value.replace(/\D/g, '').slice(0, 9));
                  setDocError('');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') void confirmarDocumento(); }}
                // text-base = 16px, tambien evita el zoom automatico de iOS
                className="h-11 pl-9 font-mono text-base tracking-wider text-foreground focus:border-cyan-500/40"
                disabled={guardandoDoc}
              />
            </div>
            {docError && <p className="text-xs text-destructive">{docError}</p>}
            <p className="text-xs text-muted-foreground">Sin puntos ni guiones.</p>
            <p className="flex items-start gap-1.5 pt-1 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
              Este dato solo lo usamos para procesar tu pago de forma segura con Pagopar.
            </p>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => { setPlanPendiente(null); setLoading(null); }}
              disabled={guardandoDoc}
            >
              Cancelar
            </Button>
            <Button onClick={confirmarDocumento} disabled={guardandoDoc || !documento}>
              {guardandoDoc && <Loader2 className="h-4 w-4 animate-spin" />}
              Continuar al pago
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
