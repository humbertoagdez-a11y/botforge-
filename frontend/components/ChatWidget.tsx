'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Image as ImageIcon, Loader2, RotateCcw, Send, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/store';
import ThinkingBubble from './ThinkingBubble';

/** Segunda capa de defensa contra markdown en las respuestas del bot */
function sanitizeMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/_{2}([^_\n]+)_{2}/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1');
}

const TENANT_THINKING = [
  'Buscando la información...',
  'Revisando el catálogo...',
  'Analizando tu consulta...',
  'Procesando los datos...',
  'Preparando la respuesta...',
  'Buscando en la base de datos...',
  'Un momento...',
];

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Props {
  botId: string;
  botName: string;
  /** Si es true, usa endpoint público (widget embebido sin auth) */
  isPublic?: boolean;
}

interface UIMessage {
  role: 'USER' | 'ASSISTANT';
  content: string;
  streaming?: boolean;
  /** Imagen que el bot adjuntó a esta respuesta */
  attachment?: { caption: string; url: string | null };
}

/** Lo que el bot está haciendo, para mostrarlo mientras usa una herramienta */
const TOOL_LABEL: Record<string, string> = {
  buscar_en_documentos: 'Buscando en los documentos...',
  buscar_archivos_drive: 'Buscando la foto...',
  derivar_a_humano: 'Avisando a un encargado...',
};

type SseEvent =
  | { type: 'delta'; text: string }
  // El bot escribió algo y después decidió usar una herramienta: eso no es la
  // respuesta final y en WhatsApp el cliente nunca lo ve, así que se descarta
  | { type: 'discard' }
  | { type: 'tool'; name: string }
  | {
      type: 'done';
      conversationId: string;
      messageId: string;
      tokensUsed: number;
      /**
       * El bot adjuntó una imagen. Las del panel traen url y se muestran tal
       * cual las recibe el cliente; las de Drive vienen sin url (llegan como
       * binario) y solo se anuncian.
       */
      imagen?: { caption: string; url: string | null } | null;
    }
  | { type: 'error'; message: string };

export default function ChatWidget({ botId, botName, isPublic = false }: Props) {
  const { token } = useAuthStore();
  // Mensaje inicial local para orientar al usuario (no se envia al backend)
  const greeting: UIMessage = {
    role: 'ASSISTANT',
    content: `Hola! Soy ${botName}. Preguntame lo que quieras sobre el negocio y te respondo al instante.`,
  };
  const [messages, setMessages] = useState<UIMessage[]>([greeting]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  /** Herramienta que el bot está usando en este momento, si es que usa alguna */
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function resetChat() {
    abortRef.current?.abort();
    setMessages([greeting]);
    setConversationId(undefined);
    setToolLabel(null);
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);
    setToolLabel(null);
    setMessages((m) => [
      ...m,
      { role: 'USER', content: text },
      { role: 'ASSISTANT', content: '', streaming: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    const endpoint = isPublic
      ? `${API}/api/v1/public/bots/${botId}/chat/stream`
      : `${API}/api/v1/bots/${botId}/chat/stream`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(!isPublic && token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text, conversationId }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json()) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? 'Error al conectar con el bot');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event: SseEvent;
          try {
            event = JSON.parse(raw) as SseEvent;
          } catch {
            continue;
          }

          if (event.type === 'delta') {
            accText += event.text;
            // Ya está escribiendo la respuesta: se saca el cartel de la herramienta
            if (accText) setToolLabel(null);
            setMessages((m) => [
              ...m.slice(0, -1),
              { role: 'ASSISTANT', content: accText, streaming: true },
            ]);
          } else if (event.type === 'discard') {
            // Vuelve a la burbuja de "pensando": lo emitido era razonamiento
            // previo a una herramienta, no lo que va a recibir el cliente
            accText = '';
            setMessages((m) => [
              ...m.slice(0, -1),
              { role: 'ASSISTANT', content: '', streaming: true },
            ]);
          } else if (event.type === 'tool') {
            setToolLabel(TOOL_LABEL[event.name] ?? 'Trabajando en tu consulta...');
          } else if (event.type === 'done') {
            setConversationId(event.conversationId);
            setMessages((m) => [
              ...m.slice(0, -1),
              { role: 'ASSISTANT', content: accText, attachment: event.imagen ?? undefined },
            ]);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setMessages((m) => m.slice(0, -2));
      toast.error(err instanceof Error ? err.message : 'Error al enviar el mensaje');
    } finally {
      setSending(false);
      setToolLabel(null);
    }
  }

  return (
    <div className="flex h-[540px] flex-col rounded-xl border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <span className="flex-1 text-sm font-medium">{botName}</span>
        {messages.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={resetChat}
            title="Nueva conversación"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        {!isPublic && <span className="text-xs text-muted-foreground">Chat de prueba</span>}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-2', msg.role === 'USER' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'ASSISTANT' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}

            <div
              className={cn(
                'max-w-[78%] rounded-2xl px-4 py-2.5 text-sm',
                msg.role === 'USER'
                  ? 'rounded-tr-sm bg-primary text-primary-foreground'
                  : 'rounded-tl-sm bg-muted',
              )}
            >
              {msg.streaming && msg.content === '' ? (
                <div className="py-0.5">
                  {/* Con herramienta se dice qué está haciendo; si no, el
                      texto genérico de siempre */}
                  {toolLabel ? (
                    <ThinkingBubble messages={[toolLabel]} light />
                  ) : (
                    <ThinkingBubble messages={TENANT_THINKING} light />
                  )}
                </div>
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed">
                  {msg.role === 'ASSISTANT' ? sanitizeMarkdown(msg.content) : msg.content}
                  {msg.streaming && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-middle" />}
                </p>
              )}

              {/* La imagen se muestra igual que la recibiría el cliente. Las
                  de Drive no traen url (viajan como binario): de esas se avisa */}
              {msg.attachment && (
                <div className="mt-2 border-t border-current/10 pt-2">
                  {msg.attachment.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={msg.attachment.url}
                      alt={msg.attachment.caption}
                      className="max-h-56 w-full rounded-lg object-contain"
                      loading="lazy"
                    />
                  ) : null}
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs opacity-70">
                    <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                    {msg.attachment.url
                      ? `Se envía adjunta: ${msg.attachment.caption}`
                      : `En WhatsApp se envía adjunta la imagen ${msg.attachment.caption}`}
                  </p>
                </div>
              )}
            </div>

            {msg.role === 'USER' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
                <User className="h-4 w-4 text-primary-foreground" />
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Escribí tu mensaje..."
            disabled={sending}
            className="flex-1"
            autoComplete="off"
          />
          <Button type="submit" size="icon" disabled={sending || !input.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
