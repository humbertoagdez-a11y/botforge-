'use client';

import { useState } from 'react';
import { Check, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, type ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type PlanPago = 'STARTER' | 'PRO' | 'AGENCY';

const PLANS = [
  {
    id: 'FREE' as const,
    name: 'Free',
    priceGs: 0,
    priceUsd: 0,
    bots: '1 bot',
    docs: '3 documentos',
    msgs: '100 mensajes/mes',
    wa: false,
    highlight: false,
    payPlan: null,
  },
  {
    id: 'STARTER' as const,
    name: 'Básico',
    priceGs: 150000,
    priceUsd: 20,
    bots: '1 bot',
    docs: '10 documentos',
    msgs: '1.000 mensajes/mes',
    wa: true,
    highlight: false,
    payPlan: 'STARTER' as const,
  },
  {
    id: 'PRO' as const,
    name: 'Profesional',
    priceGs: 350000,
    priceUsd: 47,
    bots: '5 bots',
    docs: '50 documentos',
    msgs: '4.000 mensajes/mes',
    wa: true,
    highlight: true,
    payPlan: 'PRO' as const,
  },
  {
    id: 'AGENCY' as const,
    name: 'Agencia',
    priceGs: 750000,
    priceUsd: 99,
    bots: 'Bots ilimitados',
    docs: 'Docs ilimitados',
    msgs: '10.000 mensajes/mes',
    wa: true,
    highlight: false,
    payPlan: 'AGENCY' as const,
  },
];

export default function PricingPage() {
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
    if (!token) { toast.error('Tenés que iniciar sesión'); return; }
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
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Planes y precios</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pagás en guaraníes con Pagopar: tarjeta, transferencia, giro o pago en efectivo.
          Cada pago cubre un mes; todavía no hay débito automático.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => {
          const isCurrent = user?.plan === plan.id;
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-xl border p-6 ${plan.highlight ? 'border-primary shadow-lg bg-primary/5' : 'bg-card'}`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="gap-1 text-xs"><Zap className="h-3 w-3" /> Popular</Badge>
                </div>
              )}
              {isCurrent && (
                <div className="absolute -top-3 right-4">
                  <Badge variant="success" className="text-xs">Plan actual</Badge>
                </div>
              )}

              <div className="mb-4">
                <p className="font-semibold">{plan.name}</p>
                <div className="mt-1">
                  {plan.priceGs === 0 ? (
                    <p className="text-3xl font-bold">Gratis</p>
                  ) : (
                    <>
                      <p className="text-3xl font-bold">Gs. {plan.priceGs.toLocaleString('es-PY')}</p>
                      <p className="text-xs text-muted-foreground">≈ USD {plan.priceUsd}/mes</p>
                    </>
                  )}
                </div>
              </div>

              <ul className="mb-6 flex-1 space-y-2 text-sm text-muted-foreground">
                {[plan.bots, plan.docs, plan.msgs, ...(plan.wa ? ['WhatsApp incluido'] : [])].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                    {f}
                  </li>
                ))}
              </ul>

              {plan.id === 'FREE' && (
                <p className="mb-4 text-xs text-muted-foreground">
                  Probá tu bot en el Chat de prueba antes de conectar WhatsApp.
                </p>
              )}

              {plan.payPlan ? (
                <Button
                  variant={plan.highlight ? 'default' : 'outline'}
                  className="w-full"
                  disabled={isCurrent || loading !== null}
                  onClick={() => handleUpgrade(plan.payPlan)}
                >
                  {loading === plan.payPlan && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isCurrent ? 'Plan actual' : 'Contratar'}
                </Button>
              ) : (
                <Button variant="outline" className="w-full" disabled>
                  {isCurrent ? 'Plan actual' : 'Gratis'}
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
            <DialogTitle>Necesitamos tu número de cédula</DialogTitle>
            <DialogDescription>
              Pagopar lo pide para emitir el comprobante del pago. Lo guardamos una sola vez.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-1.5">
            <Label htmlFor="documento">Cédula de identidad</Label>
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
              className="font-mono"
              disabled={guardandoDoc}
            />
            {docError && <p className="text-xs text-destructive">{docError}</p>}
            <p className="text-xs text-muted-foreground">Sin puntos ni guiones.</p>
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
    </div>
  );
}
