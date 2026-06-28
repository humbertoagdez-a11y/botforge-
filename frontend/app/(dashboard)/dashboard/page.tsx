'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bot, MessageSquare, FileText, Plus, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, type Bot as BotType } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const LANG_LABEL: Record<string, string> = { es: 'Español', en: 'English', pt: 'Português' };

export default function DashboardPage() {
  const router = useRouter();
  const [bots, setBots] = useState<BotType[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    api.bots.list()
      .then(setBots)
      .catch(() => toast.error('Error al cargar los bots'))
      .finally(() => setLoading(false));
  }, []);

  async function confirmDelete(id: string) {
    try {
      await api.bots.delete(id);
      setBots((b) => b.filter((x) => x.id !== id));
      toast.success('Bot eliminado');
    } catch {
      toast.error('No se pudo eliminar el bot');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mis Bots</h1>
          <p className="text-sm text-muted-foreground mt-1">Gestioná tus asistentes de IA</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/bots/new">
            <Plus className="h-4 w-4" />
            Nuevo bot
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : bots.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <Bot className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-semibold">Todavía no tenés bots</h3>
          <p className="mt-1 text-sm text-muted-foreground">Creá tu primer bot y conectalo a tu base de conocimiento</p>
          <Button className="mt-4" asChild>
            <Link href="/dashboard/bots/new"><Plus className="h-4 w-4" /> Crear mi primer bot</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot) => (
            <Card key={bot.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Bot className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{bot.name}</CardTitle>
                      <Badge variant="secondary" className="mt-0.5 text-[10px]">
                        {LANG_LABEL[bot.language] ?? bot.language}
                      </Badge>
                    </div>
                  </div>
                  <Badge variant={bot.isActive ? 'success' : 'outline'} className="text-[10px]">
                    {bot.isActive ? 'Activo' : 'Inactivo'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1 pb-3">
                <p className="line-clamp-2 text-xs text-muted-foreground">{bot.personality}</p>
                <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    {bot._count?.documents ?? 0} docs
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {bot._count?.conversations ?? 0} chats
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Creado {formatDate(bot.createdAt)}
                </p>
              </CardContent>
              <CardFooter className="gap-2 pt-3">
                <Button variant="outline" size="sm" className="flex-1" asChild>
                  <Link href={`/dashboard/bots/${bot.id}`}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeletingId(bot.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar bot?</DialogTitle>
            <DialogDescription>
              Se eliminará el bot con todos sus documentos y conversaciones. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeletingId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deletingId && confirmDelete(deletingId)}>
              Eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
