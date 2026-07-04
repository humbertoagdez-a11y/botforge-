'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, RotateCcw, Send, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/store';
import { ThinkingIndicator } from './DashboardAssistant';

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
}

type SseEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; conversationId: string; messageId: string; tokensUsed: number }
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function resetChat() {
    abortRef.current?.abort();
    setMessages([greeting]);
    setConversationId(undefined);
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);
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
            setMessages((m) => [
              ...m.slice(0, -1),
              { role: 'ASSISTANT', content: accText, streaming: true },
            ]);
          } else if (event.type === 'done') {
            setConversationId(event.conversationId);
            setMessages((m) => [
              ...m.slice(0, -1),
              { role: 'ASSISTANT', content: accText },
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
                  <ThinkingIndicator light />
                </div>
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                  {msg.streaming && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-middle" />}
                </p>
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
