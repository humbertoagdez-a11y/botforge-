'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Bot, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/store';
import { formatDate } from '@/lib/utils';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface ConvMessage { content: string; role: string; createdAt: string }
interface Conversation {
  id: string;
  channel: string;
  channelId: string;
  createdAt: string;
  updatedAt: string;
  bot: { name: string };
  messages: ConvMessage[];
  _count: { messages: number };
}

const CHANNEL_LABEL: Record<string, string> = {
  web: 'Web',
  whatsapp: 'WhatsApp',
  widget: 'Widget',
};

export default function ConversationsPage() {
  const { token } = useAuthStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  async function load(p: number) {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/stats/conversations?page=${p}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as { data: Conversation[]; meta: { pages: number } };
      setConversations(json.data);
      setTotalPages(json.meta.pages);
      setPage(p);
    } catch {
      toast.error('Error al cargar conversaciones');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(1); }, []);

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Conversaciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">Historial de todos los chats de tus bots</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">Sin conversaciones aún</p>
          <p className="mt-1 text-sm text-muted-foreground">Las conversaciones aparecerán aquí cuando tus bots reciban mensajes</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {conversations.map((conv) => {
              const lastMsg = conv.messages[0];
              return (
                <Card key={conv.id}>
                  <CardContent className="flex items-start gap-4 p-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{conv.bot.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {CHANNEL_LABEL[conv.channel] ?? conv.channel}
                        </Badge>
                        <span className="ml-auto text-xs text-muted-foreground">{formatDate(conv.updatedAt)}</span>
                      </div>
                      {lastMsg && (
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          <span className="font-medium text-foreground/60">{lastMsg.role === 'USER' ? 'Cliente:' : 'Bot:'}</span>{' '}
                          {lastMsg.content}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">{conv._count.messages} mensajes</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => load(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">Página {page} de {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => load(page + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
