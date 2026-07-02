'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bot, ChevronLeft, ChevronRight, Globe, Loader2, MessageSquare, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, type ConversationSummary, type ConversationDetail } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const CHANNEL_LABEL: Record<string, string> = {
  web: 'Web',
  whatsapp: 'WhatsApp',
  widget: 'Widget',
};

function ChannelBadge({ channel }: { channel: string }) {
  const isWhatsApp = channel === 'whatsapp';
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] ${isWhatsApp ? 'border-green-300 text-green-700' : ''}`}>
      {isWhatsApp ? <Smartphone className="h-2.5 w-2.5" /> : <Globe className="h-2.5 w-2.5" />}
      {CHANNEL_LABEL[channel] ?? channel}
    </Badge>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
}

function ConversationThread({ conversationId, onClose }: { conversationId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!conversationId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    api.stats
      .conversation(conversationId)
      .then(setDetail)
      .catch(() => {
        toast.error('Error al cargar la conversación');
        onClose();
      })
      .finally(() => setLoading(false));
  }, [conversationId]);

  return (
    <Dialog open={!!conversationId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="theme-dashboard flex flex-col max-md:inset-0 max-md:left-0 max-md:top-0 max-md:h-full max-md:max-h-full max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:max-h-[85vh] md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            {detail?.bot.name ?? 'Conversación'}
            {detail && <ChannelBadge channel={detail.channel} />}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : detail ? (
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {detail.messages.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Esta conversación no tiene mensajes
              </p>
            ) : (
              detail.messages.map((msg) => {
                const isClient = msg.role === 'USER';
                return (
                  <div key={msg.id} className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                        isClient
                          ? 'rounded-br-md bg-primary text-primary-foreground'
                          : 'rounded-bl-md bg-muted'
                      }`}
                    >
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                      <p
                        className={`mt-1 text-right text-[10px] ${
                          isClient ? 'text-primary-foreground/60' : 'text-muted-foreground'
                        }`}
                      >
                        {formatTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load(p: number) {
    setLoading(true);
    try {
      const { data, meta } = await api.stats.conversations(p);
      setConversations(data);
      setTotalPages(Math.max(1, meta.pages));
      setPage(p);
    } catch {
      toast.error('Error al cargar conversaciones');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1);
  }, []);

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Conversaciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Historial de todos los chats de tus bots. Hacé clic en una para ver el hilo completo.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">Sin conversaciones aún</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Aparecerán aquí cuando tus bots reciban mensajes. Podés generar la primera vos mismo
            desde el chat de prueba de tu bot.
          </p>
          <Button variant="outline" size="sm" className="mt-4" asChild>
            <Link href="/dashboard">Ir a mis bots</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {conversations.map((conv) => {
              const lastMsg = conv.messages[0];
              return (
                <Card
                  key={conv.id}
                  className="cursor-pointer transition-colors hover:border-primary/40"
                  onClick={() => setSelectedId(conv.id)}
                >
                  <CardContent className="flex items-start gap-4 p-3 md:p-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-sm">{conv.bot.name}</span>
                        <div className="flex w-full items-center gap-2 md:contents">
                          <ChannelBadge channel={conv.channel} />
                          <span className="text-xs text-muted-foreground md:ml-auto">
                            {formatDate(conv.updatedAt)}
                          </span>
                        </div>
                      </div>
                      {lastMsg && (
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          <span className="font-medium text-foreground/60">
                            {lastMsg.role === 'USER' ? 'Cliente:' : 'Bot:'}
                          </span>{' '}
                          {lastMsg.content}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {conv._count.messages} mensajes
                      </p>
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
              <span className="text-sm text-muted-foreground">
                Página {page} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => load(page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      <ConversationThread conversationId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
