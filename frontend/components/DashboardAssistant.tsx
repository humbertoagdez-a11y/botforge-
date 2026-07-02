'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Download, Send, X } from 'lucide-react';
import { useAuthStore } from '@/lib/store';

const INSTRUCTIVO_MARKER = '===INSTRUCTIVO_LISTO===';

interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  instructivo?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  botId?: string | null;
  botName?: string | null;
}

function buildWelcome(botName?: string | null): string {
  if (botName) {
    return `Hola! Estoy listo para ayudarte con '${botName}'. Puedo generarte el instructivo de entrenamiento completo o resolver cualquier duda. Por donde empezamos?`;
  }
  return 'Hola! Soy el Asistente BotForge. Puedo ayudarte a crear el instructivo perfecto para tu bot o resolver cualquier duda sobre la plataforma. Seleccioná un bot desde el panel para empezar, o preguntame lo que necesites.';
}

export default function DashboardAssistant({ open, onClose, botId, botName }: Props) {
  const { token } = useAuthStore();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Bienvenida al abrir; limpiar historial al cerrar
  useEffect(() => {
    if (open) {
      setMessages([{ role: 'assistant', content: buildWelcome(botName) }]);
    } else {
      abortRef.current?.abort();
      setMessages([]);
      setInput('');
      setTyping(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function downloadInstructivo(text: string) {
    const slug = botName ? botName.toLowerCase().replace(/\s+/g, '-') : 'botforge';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `instructivo-${slug}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || typing) return;

    setInput('');
    // Excluir la bienvenida local (primer mensaje assistant) del historial enviado
    const history = messages
      .slice(1)
      .map((m) => ({
        role: m.role,
        content: m.instructivo ? `${m.content}\n${INSTRUCTIVO_MARKER}\n${m.instructivo}` : m.content,
      }));

    const outgoing = [...history, { role: 'user' as const, content: text }];
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setTyping(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/assistant/dashboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ messages: outgoing, ...(botId ? { botId } : {}) }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error('respuesta no disponible');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let started = false;

      const render = () => {
        const markerIdx = accumulated.indexOf(INSTRUCTIVO_MARKER);
        const pre = markerIdx >= 0 ? accumulated.slice(0, markerIdx).trim() : accumulated;
        const instructivo =
          markerIdx >= 0
            ? accumulated.slice(markerIdx + INSTRUCTIVO_MARKER.length).replace(/^\s+/, '')
            : undefined;

        const next: AssistantMessage = {
          role: 'assistant',
          content: pre || (instructivo ? 'Tu instructivo está listo. Revisalo y descargalo:' : ''),
          ...(instructivo !== undefined ? { instructivo } : {}),
        };

        setMessages((prev) => (started ? [...prev.slice(0, -1), next] : [...prev, next]));
        if (!started) {
          started = true;
          setTyping(false);
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
            if (parsed.text) {
              accumulated += parsed.text;
              render();
            }
            if (parsed.error) {
              accumulated += parsed.error;
              render();
            }
          } catch {
            // fragmento invalido, se ignora
          }
        }
      }

      if (!started) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'No pude generar una respuesta. Probá de nuevo en un momento.' },
        ]);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Tuve un problema de conexión. Probá de nuevo en unos segundos.' },
        ]);
      }
    } finally {
      setTyping(false);
      abortRef.current = null;
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col bg-[#0A0A14] shadow-2xl shadow-cyan-950/40">
        {/* Header */}
        <div className="border-b border-cyan-400/20 bg-[#111120] px-4 py-3">
          <div className="flex items-center gap-3">
            <Image src="/asistente-logo.svg" alt="" width={32} height={32} unoptimized className="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#E8E8F0]">Asistente BotForge</p>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                <span className="text-[11px] text-[#6E6E8E]">En linea</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar asistente"
              className="rounded-lg p-1.5 text-[#6E6E8E] transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {botName && (
            <p className="mt-1.5 truncate text-xs text-[#6E6E8E]">
              Trabajando en: <span className="text-cyan-400">{botName}</span>
            </p>
          )}
        </div>

        {/* Mensajes */}
        <div ref={scrollRef} className="assistant-scroll flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`${m.instructivo !== undefined ? 'w-full' : 'max-w-[85%]'}`}>
                {m.content && (
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'rounded-br-md bg-[#7C3AED] text-white'
                        : 'rounded-bl-md border border-cyan-400/20 bg-[#111120] text-gray-300'
                    }`}
                  >
                    {m.content}
                  </div>
                )}

                {m.instructivo !== undefined && (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={m.instructivo}
                      onChange={(e) => {
                        const value = e.target.value;
                        setMessages((prev) =>
                          prev.map((msg, idx) => (idx === i ? { ...msg, instructivo: value } : msg)),
                        );
                      }}
                      rows={14}
                      spellCheck={false}
                      className="assistant-scroll w-full resize-y rounded-xl border border-cyan-400/30 bg-[#0D0D1A] p-3 font-mono text-xs leading-relaxed text-gray-200 focus:border-cyan-400/60 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => downloadInstructivo(m.instructivo ?? '')}
                      className="flex items-center gap-2 rounded-lg bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-black transition-colors hover:bg-cyan-300"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Descargar instructivo .txt
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {typing && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border border-cyan-400/20 bg-[#111120] px-3.5 py-2.5 text-xs text-[#6E6E8E]">
                Pensando...
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
          className="flex items-center gap-2 border-t border-cyan-400/10 bg-[#111120] p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribí tu mensaje..."
            maxLength={6000}
            className="min-w-0 flex-1 rounded-xl border border-cyan-400/30 bg-[#0D0D1A] px-3.5 py-2.5 text-sm text-white placeholder:text-[#6E6E8E] focus:border-cyan-400/70 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || typing}
            aria-label="Enviar mensaje"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-400 text-black transition-colors hover:bg-cyan-300 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
