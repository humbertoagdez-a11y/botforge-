'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bot, ChevronLeft, ChevronRight, Globe, Loader2, Megaphone, MessageSquare, Mic, ShoppingBag, Smartphone } from 'lucide-react';
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
          {/* flex-wrap + pr-8: en pantallas angostas el nombre del bot puede
              ocupar dos líneas y empujar la insignia de canal justo debajo
              del botón de cerrar (que es absolute, top-3 right-3, h-9 w-9) —
              sin espacio reservado se superponen. */}
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            {detail?.bot.name ?? 'Conversación'}
            {detail && <ChannelBadge channel={detail.channel} />}
            {detail && <EtiquetaPedido pedidos={detail.pedidos} />}
            {detail && (
              <EtiquetaAnuncio headline={detail.adHeadline} sourceId={detail.adSourceId} />
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : detail ? (
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {/* Lo que pidió, arriba del hilo: es el dato accionable, y buscarlo
                leyendo veinte mensajes es justo lo que hace que se pierda. */}
            {detail.pedidos?.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3"
              >
                <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-300">
                  <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
                  {TIPO_PEDIDO[p.tipo] ?? 'Pedido'}
                  <span className="font-normal text-emerald-400/70">{formatTime(p.createdAt)}</span>
                  {!p.avisado && (
                    <span className="font-normal text-amber-400">· el email no salió</span>
                  )}
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {p.resumen}
                </p>
                {(p.nombreCliente || p.contacto) && (
                  // text-muted-foreground sobre el verde de la tarjeta da 4.47 de
                  // contraste, apenas abajo del minimo legible, y justo en el
                  // renglon del nombre y el telefono, que es el dato accionable.
                  <p className="mt-1.5 text-xs text-emerald-100/80">
                    {[p.nombreCliente, p.contacto].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            ))}
            {detail.messages.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Esta conversación no tiene mensajes
              </p>
            ) : (
              detail.messages.map((msg) => {
                const isClient = msg.role === 'USER';
                // El backend lo marca cuando el envio a WhatsApp fallo aun
                // despues de reintentar: sin esto el panel mostraba como
                // enviada una respuesta que el cliente nunca recibio
                const noEntregado = !isClient && msg.entregado === false;
                return (
                  <div key={msg.id} className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                        isClient
                          ? 'rounded-br-md bg-primary text-primary-foreground'
                          : noEntregado
                            ? 'rounded-bl-md border border-amber-500/40 bg-amber-500/10'
                            : 'rounded-bl-md bg-muted'
                      }`}
                    >
                      {/* El dueño tiene que saber que esto no lo escribio el
                          cliente: lo dicto, y la transcripcion puede traer una
                          palabra cambiada. Sin la marca, una transcripcion rara
                          se lee como un cliente que escribe raro. */}
                      {msg.esNotaDeVoz && (
                        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-primary-foreground/70">
                          <Mic className="h-3 w-3 shrink-0" />
                          <span>Nota de voz{msg.audioSegundos ? ` · ${duracionTexto(msg.audioSegundos)}` : ''}</span>
                          <span className="text-primary-foreground/50">· transcripción</span>
                        </p>
                      )}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                      {noEntregado && (
                        <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-amber-400">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          No se pudo entregar — el cliente no recibió esta respuesta
                        </p>
                      )}
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

const TIPO_PEDIDO: Record<string, string> = {
  pedido: 'Pedido',
  turno: 'Turno',
  contacto: 'Dejó sus datos',
};

/**
 * Marca que en esta conversación el cliente concretó algo.
 *
 * Va en verde y no en violeta como el resto: en una lista larga, lo que el
 * dueño tiene que atender sí o sí son los pedidos, y tiene que saltarle a la
 * vista sin leer.
 */
function EtiquetaPedido({
  pedidos,
  compacta = false,
}: {
  pedidos: ConversationSummary['pedidos'];
  compacta?: boolean;
}) {
  if (!pedidos || pedidos.length === 0) return null;
  const texto =
    pedidos.length === 1
      ? TIPO_PEDIDO[pedidos[0].tipo] ?? 'Pedido'
      : `${pedidos.length} pedidos`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300 ${
        compacta ? 'text-[10px]' : 'text-xs'
      }`}
    >
      <ShoppingBag className={compacta ? 'h-2.5 w-2.5 shrink-0' : 'h-3 w-3 shrink-0'} />
      {texto}
    </span>
  );
}

/**
 * De que anuncio vino la conversacion.
 *
 * Se muestra porque es la unica forma de saber que trae cada anuncio: sin
 * esto, pautar es mirar un numero de conversaciones sin saber cual campaña
 * las genero.
 */
function EtiquetaAnuncio({
  headline,
  sourceId,
  compacta = false,
}: {
  headline: string | null;
  sourceId: string | null;
  compacta?: boolean;
}) {
  if (!sourceId && !headline) return null;
  const texto = headline?.trim() || 'Anuncio ' + sourceId;
  return (
    <span
      className={'inline-flex max-w-full items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-medium text-cyan-300 ' + (compacta ? 'text-[10px]' : 'text-xs')}
      title={sourceId ? 'Anuncio ' + sourceId : undefined}
    >
      <Megaphone className={compacta ? 'h-2.5 w-2.5 shrink-0' : 'h-3 w-3 shrink-0'} />
      <span className="truncate">{texto}</span>
    </span>
  );
}

/**
 * Duracion de una nota de voz como la muestra WhatsApp: 0:45, 1:20.
 *
 * Importa mostrarla porque es lo que explica una transcripcion pobre — ocho
 * segundos entrecortados no se leen igual que noventa bien grabados.
 */
function duracionTexto(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = Math.round(segundos % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [soloPedidos, setSoloPedidos] = useState(false);

  async function load(p: number, filtrar = soloPedidos) {
    setLoading(true);
    try {
      const { data, meta } = await api.stats.conversations(p, filtrar);
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Conversaciones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Historial de todos los chats de tus bots. Hacé clic en una para ver el hilo completo.
          </p>
        </div>
        {/* El filtro que importa: en una lista larga, los pedidos son lo único
            que hay que atender sí o sí. */}
        <Button
          type="button"
          variant={soloPedidos ? 'default' : 'outline'}
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => {
            const nuevo = !soloPedidos;
            setSoloPedidos(nuevo);
            void load(1, nuevo);
          }}
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          {soloPedidos ? 'Viendo solo pedidos' : 'Ver solo pedidos'}
        </Button>
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
                        <EtiquetaPedido pedidos={conv.pedidos} compacta />
                        <EtiquetaAnuncio headline={conv.adHeadline} sourceId={conv.adSourceId} compacta />
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
