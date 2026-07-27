'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bot,
  FileText,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Smartphone,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import NpsSection from '@/components/NpsSection';
import { api, type AccountStats } from '@/lib/api';

const PLAN_LABEL: Record<AccountStats['plan'], string> = {
  FREE: 'Free',
  STARTER: 'Básico',
  PRO: 'Profesional',
  AGENCY: 'Agencia',
};

export default function StatsPage() {
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.stats
      .get()
      .then(setStats)
      .catch(() => toast.error('Error al cargar estadísticas'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const noActivity = !stats || stats.totalMessages === 0;
  const usagePct = stats
    ? Math.min(100, Math.round((stats.monthlyMessages / stats.planLimits.monthlyMessages) * 100))
    : 0;

  const cards = stats
    ? [
        { label: 'Mensajes hoy', value: stats.messagesToday, icon: MessageSquare, color: 'text-violet-600' },
        { label: 'Mensajes este mes', value: stats.monthlyMessages, icon: TrendingUp, color: 'text-orange-600' },
        { label: 'Mensajes históricos', value: stats.totalMessages, icon: MessagesSquare, color: 'text-blue-600' },
        { label: 'Conversaciones', value: stats.totalConversations, icon: MessageSquare, color: 'text-green-600' },
        { label: 'Bots activos', value: stats.activeBots, icon: Bot, color: 'text-violet-600' },
        { label: 'Con WhatsApp', value: stats.botsWithWhatsApp, icon: Smartphone, color: 'text-green-600' },
        { label: 'Docs procesados', value: stats.readyDocs, icon: FileText, color: 'text-blue-600' },
        { label: 'Docs totales', value: stats.totalDocs, icon: FileText, color: 'text-muted-foreground' },
      ]
    : [];

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Estadísticas</h1>
        <p className="mt-1 text-sm text-muted-foreground">Resumen del uso de tu cuenta</p>
      </div>

      {noActivity && (
        <div className="mb-6 rounded-xl border border-dashed bg-muted/30 px-5 py-4">
          <p className="text-sm font-medium">Todavía no hay actividad</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Las métricas aparecerán aquí cuando tu bot empiece a recibir mensajes. Probá el chat de
            prueba de tu bot o conectá WhatsApp para arrancar.
          </p>
        </div>
      )}

      {stats && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Uso del plan {PLAN_LABEL[stats.plan]}
              </CardTitle>
              {stats.plan === 'FREE' && (
                <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                  <Link href="/pricing">Mejorar plan</Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-2xl font-bold">
                {stats.monthlyMessages.toLocaleString('es-PY')}
                <span className="text-sm font-normal text-muted-foreground">
                  {' '}/ {stats.planLimits.monthlyMessages.toLocaleString('es-PY')} mensajes este mes
                </span>
              </p>
              <span className={`font-mono text-sm font-medium ${usagePct >= 80 ? 'text-orange-600' : 'text-muted-foreground'}`}>
                {usagePct}%
              </span>
            </div>
            <Progress value={usagePct} className="mt-2" />
            {usagePct >= 80 && (
              <p className="mt-2 text-xs text-orange-600">
                Estás cerca del límite mensual.{' '}
                <Link href="/pricing" className="underline">Actualizá tu plan</Link> para no cortar
                el servicio.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-3xl font-bold">{value.toLocaleString('es-PY')}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Opinión de tus clientes</h2>
        <NpsSection />
      </div>
    </div>
  );
}
