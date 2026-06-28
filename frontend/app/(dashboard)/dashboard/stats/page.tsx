'use client';

import { useEffect, useState } from 'react';
import { Bot, FileText, Loader2, MessageSquare, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/lib/store';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Stats {
  totalBots: number;
  activeBots: number;
  totalDocs: number;
  totalConversations: number;
  monthlyMessages: number;
}

const STAT_CARDS = [
  { key: 'activeBots' as const, label: 'Bots activos', icon: Bot, color: 'text-violet-600' },
  { key: 'totalDocs' as const, label: 'Documentos', icon: FileText, color: 'text-blue-600' },
  { key: 'totalConversations' as const, label: 'Conversaciones', icon: MessageSquare, color: 'text-green-600' },
  { key: 'monthlyMessages' as const, label: 'Mensajes este mes', icon: TrendingUp, color: 'text-orange-600' },
];

export default function StatsPage() {
  const { token } = useAuthStore();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/v1/stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j) => setStats((j as { data: Stats }).data))
      .catch(() => toast.error('Error al cargar estadísticas'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Estadísticas</h1>
        <p className="mt-1 text-sm text-muted-foreground">Resumen del uso de tu cuenta</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_CARDS.map(({ key, label, icon: Icon, color }) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{stats?.[key] ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
