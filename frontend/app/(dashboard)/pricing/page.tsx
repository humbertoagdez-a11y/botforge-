'use client';

import { useState } from 'react';
import { Check, IdCard, Loader2, ShieldCheck, Sparkles, Zap } from 'lucide-react';
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

/**
 * Beneficios por plan.
 *
 * FUENTE DE VERDAD: backend/src/middleware/planLimits.ts (LIMITS). Los números
 * de acá son un espejo de ese archivo y tienen que moverse juntos — el frontend
 * no puede importar del backend, así que la sincronía es manual. Si tocás un
 * límite allá, actualizá esta lista.
 *
 * `nuevo: true` marca lo que NO trae el plan anterior. Es lo que hace visible
 * por qué conviene pagar más, en vez de dejar cuatro listas parecidas.
 */
interface Beneficio {
  texto: string;
  nuevo?: boolean;
}

const PLANS: Array<{
  id: 'FREE' | 'STARTER' | 'PRO' | 'AGENCY';
  name: string;
  priceGs: number;
  priceUsd: number;
  /** Una línea que resume para quién es el plan */
  para: string;
  features: Beneficio[];
  nota?: string;
  highlight: boolean;
  payPlan: 'STARTER' | 'PRO' | 'AGENCY' | null;
}> = [
  {
    id: 'FREE',
    name: 'Free',
    priceGs: 0,
    priceUsd: 0,
    para: 'Para probar cómo responde tu bot',
    features: [
      { texto: '1 bot' },
      { texto: '100 mensajes por mes' },
      { texto: '3 documentos de entrenamiento' },
      { texto: '25 mensajes por día en el Chat de prueba' },
      { texto: 'Asistente de configuración: 5 mensajes por día' },
    ],
    nota: 'No incluye WhatsApp: tu bot responde solo en el Chat de prueba del panel.',
    highlight: false,
    payPlan: null,
  },
  {
    id: 'STARTER',
    name: 'Básico',
    priceGs: 150000,
    priceUsd: 20,
    para: 'Para un negocio que ya quiere atender por WhatsApp',
    features: [
      { texto: 'Conexión a WhatsApp Business', nuevo: true },
      { texto: 'Hasta 8 imágenes que tu bot le manda a los clientes', nuevo: true },
      { texto: 'Encuestas de satisfacción a tus clientes', nuevo: true },
      { texto: '1.000 mensajes por mes' },
      { texto: '1 bot' },
      { texto: '10 documentos de entrenamiento' },
      { texto: 'Asistente de configuración: 15 mensajes por día' },
    ],
    highlight: false,
    payPlan: 'STARTER',
  },
  {
    id: 'PRO',
    name: 'Profesional',
    priceGs: 350000,
    priceUsd: 47,
    para: 'Para varios locales, marcas o líneas de negocio',
    features: [
      { texto: 'Informe semanal automático de cada uno de tus bots', nuevo: true },
      { texto: 'Hasta 5 bots', nuevo: true },
      { texto: '4.000 mensajes por mes' },
      { texto: 'Hasta 30 imágenes por bot' },
      { texto: '50 documentos por bot' },
      { texto: 'Conexión a WhatsApp Business' },
      { texto: 'Encuestas de satisfacción a tus clientes' },
      { texto: 'Asistente de configuración: 40 mensajes por día' },
    ],
    highlight: true,
    payPlan: 'PRO',
  },
  {
    id: 'AGENCY',
    name: 'Agencia',
    priceGs: 750000,
    priceUsd: 99,
    para: 'Para quien maneja los bots de varios clientes',
    features: [
      { texto: 'Informe consolidado que compara todos tus bots entre sí', nuevo: true },
      { texto: 'Bots ilimitados', nuevo: true },
      { texto: 'Documentos e imágenes sin límite', nuevo: true },
      { texto: '10.000 mensajes por mes' },
      { texto: 'Informe semanal de cada bot' },
      { texto: 'Conexión a WhatsApp Business' },
      { texto: 'Encuestas de satisfacción a tus clientes' },
      { texto: 'Asistente de configuración: 100 mensajes por día' },
    ],
    nota: 'El informe consolidado rankea tus bots por volumen y satisfacción, y te dice cuál necesita atención primero. Solo en Agencia.',
    highlight: false,
    payPlan: 'AGENCY',
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
          // Local para que TS lo estreche: dentro del map, plan.payPlan sigue
          // siendo la unión con null aunque el ternario lo descarte
          const payPlan = plan.payPlan;
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
                <p className="mt-2 text-xs text-muted-foreground">{plan.para}</p>
              </div>

              <ul className="mb-6 flex-1 space-y-2 text-sm">
                {plan.features.map((f) => (
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

              {plan.nota && (
                <p className="mb-4 text-xs text-muted-foreground">{plan.nota}</p>
              )}

              {payPlan ? (
                <Button
                  variant={plan.highlight ? 'default' : 'outline'}
                  className="w-full"
                  disabled={isCurrent || loading !== null}
                  onClick={() => handleUpgrade(payPlan)}
                >
                  {loading === payPlan && <Loader2 className="h-4 w-4 animate-spin" />}
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
    </div>
  );
}
