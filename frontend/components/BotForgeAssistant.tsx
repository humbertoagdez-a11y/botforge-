'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, MessageSquare, Send, X } from 'lucide-react';

interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

const WELCOME_MESSAGE =
  'Hola! Soy Aria, la asistente de BotForge. Podes preguntarme lo que quieras sobre la plataforma, los planes, como funciona o que rubro se adapta mejor a tu negocio. Estoy para ayudarte.';

export default function BotForgeAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: 'assistant', content: WELCOME_MESSAGE }]);
    }
  }, [open, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function sendMessage() {
    const text = input.trim();
    if (!text || typing) return;

    setInput('');
    // El historial que se envia excluye el mensaje de bienvenida local
    const history = messages
      .filter((_, i) => i > 0 || messages[0]?.role === 'user')
      .map((m) => ({ role: m.role, content: m.content }));

    const outgoing = [...history, { role: 'user' as const, content: text }];
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setTyping(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: outgoing }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error('respuesta no disponible');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let started = false;

      const appendText = (chunk: string) => {
        if (!started) {
          started = true;
          setTyping(false);
          setMessages((prev) => [...prev, { role: 'assistant', content: chunk }]);
        } else {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + chunk };
            return next;
          });
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload) as { text?: string; error?: string };
            if (parsed.text) appendText(parsed.text);
            if (parsed.error) appendText(parsed.error);
          } catch {
            // fragmento invalido, se ignora
          }
        }
      }

      if (!started) {
        appendText('No pude generar una respuesta. Proba de nuevo en un momento.');
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Tuve un problema de conexion. Proba de nuevo en unos segundos.' },
        ]);
      }
    } finally {
      setTyping(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open && (
        <div className="mb-3 flex h-[520px] w-[calc(100vw-2.5rem)] max-w-[380px] flex-col overflow-hidden rounded-2xl border border-violet-500/30 bg-[#0D0D12] shadow-2xl shadow-violet-900/40">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-white/10 bg-[#111118] px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">Aria — Asistente de BotForge</p>
              <p className="text-xs text-gray-400">Te respondo al instante</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar chat"
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Mensajes */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'rounded-br-md bg-violet-600 text-white'
                      : 'rounded-bl-md bg-white/10 text-gray-100'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2.5 text-xs text-gray-400">
                  Aria esta escribiendo...
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
            className="flex items-center gap-2 border-t border-white/10 bg-[#111118] p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribi tu pregunta..."
              maxLength={2000}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0A0A0F] px-3.5 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!input.trim() || typing}
              aria-label="Enviar mensaje"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      {/* Boton flotante */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Cerrar asistente' : 'Abrir asistente'}
        className="relative ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-900/50 transition-transform hover:scale-105"
      >
        <MessageSquare className="h-6 w-6" />
        {!open && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-4 w-4 rounded-full border-2 border-[#0A0A0F] bg-green-500" />
          </span>
        )}
      </button>
    </div>
  );
}
