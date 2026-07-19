'use client';

import { useState } from 'react';
import { Check, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api, type ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

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
    stripeId: null,
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
    stripeId: 'STARTER',
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
    stripeId: 'PRO',
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
    stripeId: 'AGENCY',
  },
];

export default function PricingPage() {
  const { token, user } = useAuthStore();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleUpgrade(planId: 'STARTER' | 'PRO' | 'AGENCY') {
    if (!token) { toast.error('Tenés que iniciar sesión'); return; }
    setLoading(planId);
    try {
      const { url } = await api.stripe.checkout(planId);
      if (!url) throw new Error('Error al crear sesión de pago');
      window.location.href = url;
    } catch (err) {
      if ((err as ApiError).code === 'STRIPE_NOT_CONFIGURED') {
        toast.info('Los pagos estarán disponibles pronto');
      } else {
        toast.error(err instanceof Error ? err.message : 'Error al procesar el pago');
      }
      setLoading(null);
    }
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Planes y precios</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Los precios se cobran en USD. El equivalente en guaraníes es referencial.
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

              {plan.stripeId ? (
                <Button
                  variant={plan.highlight ? 'default' : 'outline'}
                  className="w-full"
                  disabled={isCurrent || loading !== null}
                  onClick={() => handleUpgrade(plan.stripeId as 'STARTER' | 'PRO' | 'AGENCY')}
                >
                  {loading === plan.stripeId && <Loader2 className="h-4 w-4 animate-spin" />}
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
    </div>
  );
}
