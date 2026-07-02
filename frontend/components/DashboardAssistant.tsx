'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Download, Paperclip, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/store';

const INSTRUCTIVO_MARKER = '===INSTRUCTIVO_LISTO===';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  instructivo?: string;
  /** Mensaje solo visual (bienvenida): se excluye del historial enviado al backend */
  isLocal?: boolean;
  /** Placeholder mientras el stream esta en curso */
  streaming?: boolean;
  /** Data URL de la imagen adjunta, solo para renderizar la burbuja */
  imageDataUrl?: string;
}

interface AttachedImage {
  dataUrl: string;
  base64: string;
  mediaType: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  botId?: string | null;
  botName?: string | null;
}

function buildWelcome(botName?: string | null): AssistantMessage {
  const content = botName
    ? `Hola! Estoy listo para ayudarte con '${botName}'. Puedo generarte el instructivo de entrenamiento completo o resolver cualquier duda. Por donde empezamos?`
    : 'Hola! Soy el Asistente BotForge. Puedo ayudarte a crear el instructivo perfecto para tu bot o resolver cualquier duda sobre la plataforma. Seleccioná un bot desde el panel para empezar, o preguntame lo que necesites.';
  return { role: 'assistant', content, isLocal: true };
}

/** Divide el texto acumulado del stream en burbuja + instructivo editable */
function splitAccumulated(accumulated: string): { content: string; instructivo?: string } {
  const markerIdx = accumulated.indexOf(INSTRUCTIVO_MARKER);
  if (markerIdx < 0) return { content: accumulated };
  const pre = accumulated.slice(0, markerIdx).trim();
  const instructivo = accumulated.slice(markerIdx + INSTRUCTIVO_MARKER.length).replace(/^\s+/, '');
  return {
    content: pre || 'Tu instructivo está listo. Revisalo y descargalo:',
    instructivo,
  };
}

export default function DashboardAssistant({ open, onClose, botId, botName }: Props) {
  const { token } = useAuthStore();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attached, setAttached] = useState<AttachedImage | null>(null);
  const [imageModal, setImageModal] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Bienvenida al abrir; limpiar historial al cerrar
  useEffect(() => {
    if (open) {
      setMessages([buildWelcome(botName)]);
    } else {
      abortRef.current?.abort();
      setMessages([]);
      setInput('');
      setSending(false);
      setAttached(null);
      setImageModal(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function handleFile(file: File) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error('Formato no soportado. Usá JPG, PNG, WebP o GIF.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error('La imagen supera el límite de 5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] ?? '';
      setAttached({ dataUrl, base64, mediaType: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
  }

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
    if ((!text && !attached) || sending) return;

    const userText = text || 'Mirá esta imagen';
    const image = attached;
    setInput('');
    setAttached(null);
    setSending(true);

    // Historial completo para el backend: todos los turnos previos NO locales.
    // Los instructivos se re-incluyen para que el asistente pueda iterarlos.
    const history = messages
      .filter((m) => !m.isLocal && !m.streaming)
      .map((m) => ({
        role: m.role,
        content: m.instructivo
          ? `${m.content}\n${INSTRUCTIVO_MARKER}\n${m.instructivo}`
          : m.content,
      }))
      .filter((m) => m.content.trim().length > 0);

    const outgoing = [...history, { role: 'user' as const, content: userText }];

    // El mensaje del usuario se agrega ANTES del fetch, junto con un
    // placeholder del asistente que el stream va completando. El updater
    // del stream siempre reemplaza el ultimo elemento: nada se pierde.
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userText, ...(image ? { imageDataUrl: image.dataUrl } : {}) },
      { role: 'assistant', content: '', streaming: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    const updatePlaceholder = (patch: Partial<AssistantMessage>) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role !== 'assistant') return prev;
        next[next.length - 1] = { ...last, ...patch };
        return next;
      });
    };

    try {
      const res = await fetch('/api/assistant/dashboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: outgoing,
          ...(botId ? { botId } : {}),
          ...(image ? { image: { data: image.base64, mediaType: image.mediaType } } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error('respuesta no disponible');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

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
            const chunk = parsed.text ?? parsed.error ?? '';
            if (chunk) {
              accumulated += chunk;
              updatePlaceholder({ ...splitAccumulated(accumulated), streaming: true });
            }
          } catch {
            // fragmento invalido, se ignora
          }
        }
      }

      if (accumulated) {
        updatePlaceholder({ ...splitAccumulated(accumulated), streaming: false });
      } else {
        updatePlaceholder({
          content: 'No pude generar una respuesta. Probá de nuevo en un momento.',
          streaming: false,
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      updatePlaceholder({
        content: 'Tuve un problema de conexión. Probá de nuevo en unos segundos.',
        streaming: false,
      });
    } finally {
      setSending(false);
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
              className="min-h-[44px] min-w-[44px] rounded-lg p-1.5 text-[#6E6E8E] transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="mx-auto h-4 w-4" />
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
          {messages.map((m, i) => {
            const isTyping = m.streaming && !m.content && m.instructivo === undefined;
            return (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`${m.instructivo !== undefined ? 'w-full' : 'max-w-[85%]'}`}>
                  {m.imageDataUrl && (
                    <button
                      type="button"
                      onClick={() => setImageModal(m.imageDataUrl ?? null)}
                      className="mb-1.5 ml-auto block overflow-hidden rounded-xl border border-white/10"
                      aria-label="Ver imagen completa"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.imageDataUrl} alt="Imagen adjunta" className="h-24 w-24 object-cover" />
                    </button>
                  )}

                  {isTyping ? (
                    <div className="rounded-2xl rounded-bl-md border border-cyan-400/20 bg-[#111120] px-3.5 py-2.5 text-xs text-[#6E6E8E]">
                      Pensando...
                    </div>
                  ) : (
                    m.content && (
                      <div
                        className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                          m.role === 'user'
                            ? 'rounded-br-md bg-[#7C3AED] text-white'
                            : 'rounded-bl-md border border-cyan-400/20 bg-[#111120] text-gray-300'
                        }`}
                      >
                        {m.content}
                      </div>
                    )
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
                        className="flex min-h-[44px] items-center gap-2 rounded-lg bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-black transition-colors hover:bg-cyan-300"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Descargar instructivo .txt
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Preview de imagen adjunta */}
        {attached && (
          <div className="flex items-center gap-3 border-t border-cyan-400/10 bg-[#111120] px-4 py-2">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attached.dataUrl}
                alt="Imagen a enviar"
                className="h-[60px] w-[60px] rounded-lg border border-cyan-400/30 object-cover"
              />
              <button
                type="button"
                onClick={() => setAttached(null)}
                aria-label="Quitar imagen"
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#0A0A14] text-gray-300 ring-1 ring-cyan-400/40 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <p className="min-w-0 flex-1 truncate text-xs text-[#6E6E8E]">{attached.name}</p>
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
          className="flex items-center gap-2 border-t border-cyan-400/10 bg-[#111120] p-3"
        >
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Adjuntar imagen"
            className="flex h-10 w-10 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-cyan-400/30 text-[#6E6E8E] transition-colors hover:border-cyan-400/60 hover:text-cyan-400"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribí tu mensaje..."
            maxLength={6000}
            className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-cyan-400/30 bg-[#0D0D1A] px-3.5 py-2.5 text-base text-white placeholder:text-[#6E6E8E] focus:border-cyan-400/70 focus:outline-none sm:text-sm"
          />
          <button
            type="submit"
            disabled={(!input.trim() && !attached) || sending}
            aria-label="Enviar mensaje"
            className="flex h-10 w-10 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl bg-cyan-400 text-black transition-colors hover:bg-cyan-300 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>

      {/* Modal simple de imagen completa */}
      {imageModal && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/85 p-6"
          onClick={() => setImageModal(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageModal} alt="Imagen adjunta" className="max-h-full max-w-full rounded-xl" />
          <button
            type="button"
            onClick={() => setImageModal(null)}
            aria-label="Cerrar imagen"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
