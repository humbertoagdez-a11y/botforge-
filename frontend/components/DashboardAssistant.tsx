'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Paperclip,
  SendHorizonal,
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/store';

const INSTRUCTIVO_MARKER = '===INSTRUCTIVO_LISTO===';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const TOOL_LABELS: Record<string, string> = {
  get_bot_details: 'Leyendo configuración del bot...',
  update_bot_config: 'Actualizando configuración...',
  upload_instructivo_text: 'Subiendo instructivo al bot...',
  disconnect_whatsapp: 'Desconectando WhatsApp...',
  get_account_stats: 'Obteniendo estadísticas...',
  get_conversations: 'Leyendo conversaciones...',
  send_notification_email: 'Configurando notificación...',
  create_new_bot: 'Creando nuevo bot...',
  delete_document: 'Eliminando documento...',
  request_plan_upgrade: 'Preparando upgrade de plan...',
};

interface ExecStep {
  tool: string;
  status: 'running' | 'success' | 'error';
  label: string;
  detail?: string;
}

interface ConfirmData {
  toolUseId: string;
  tool: string;
  message: string;
  resolved?: 'confirmed' | 'cancelled';
}

interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Solo visual (bienvenida, avisos): NUNCA se envía al backend */
  isLocal?: boolean;
  streaming?: boolean;
  instructivo?: string;
  imageDataUrl?: string;
  execSteps?: ExecStep[];
  confirm?: ConfirmData;
  /** Content blocks crudos del turno assistant pendiente de confirmación */
  blocks?: unknown[];
  ts: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  botId?: string | null;
  botName?: string | null;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function buildWelcome(botName?: string | null): AssistantMessage {
  const content = botName
    ? `Hola. Estoy listo para gestionar '${botName}'. Puedo modificar su configuración, generar el instructivo, revisar conversaciones o lo que necesites. Por donde empezamos?`
    : 'Hola. Soy tu asistente de gestión. Puedo crear bots, modificar configuraciones, generar instructivos o resolver cualquier duda sobre la plataforma. Que necesitás?';
  return { id: 'welcome', role: 'assistant', content, isLocal: true, ts: Date.now() };
}

/** Segunda capa de defensa contra markdown en las respuestas del modelo */
function sanitizeMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') // **negrita**
    .replace(/\*(.*?)\*/g, '$1') // *itálica*
    .replace(/__(.*?)__/g, '$1') // __negrita__
    .replace(/^#{1,6}\s+/gm, '') // # Títulos
    .replace(/^[-*+]\s+/gm, '• ') // - bullets → punto simple
    .replace(/`([^`]+)`/g, '$1'); // `código`
}

function splitAccumulated(accumulated: string): { content: string; instructivo?: string } {
  const markerIdx = accumulated.indexOf(INSTRUCTIVO_MARKER);
  if (markerIdx < 0) return { content: sanitizeMarkdown(accumulated) };
  const pre = accumulated.slice(0, markerIdx).trim();
  // El instructivo NO se sanitiza: es texto plano por prompt y el regex
  // de listas numeradas rompería precios o direcciones legítimas
  const instructivo = accumulated.slice(markerIdx + INSTRUCTIVO_MARKER.length).replace(/^\s+/, '');
  return {
    content: sanitizeMarkdown(pre) || 'Tu instructivo está listo. Revisalo y descargalo:',
    instructivo,
  };
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
}

// ─── Terminal de ejecución ────────────────────────────────────────────────────

function ToolExecutionLog({ steps }: { steps: ExecStep[] }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-cyan-500/30 bg-[#0A0A1A]">
      <div className="flex items-center gap-2 bg-[#111128] px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-red-500/80" />
        <span className="h-2 w-2 rounded-full bg-yellow-500/80" />
        <span className="h-2 w-2 rounded-full bg-green-500/80" />
        <span className="ml-1 font-mono text-xs text-cyan-500/70">BotForge Terminal</span>
      </div>
      <div className="space-y-2 p-4">
        {steps.map((step, i) => (
          <div
            key={`${step.tool}-${i}`}
            className="motion-safe:animate-[fade-in_0.2s_ease]"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className="flex items-center gap-2 font-mono text-xs">
              {step.status === 'running' && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-cyan-400" />}
              {step.status === 'success' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-400" />}
              {step.status === 'error' && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
              <span
                className={
                  step.status === 'running'
                    ? 'text-cyan-400/80'
                    : step.status === 'error'
                      ? 'text-red-400/80'
                      : 'text-gray-300'
                }
              >
                {step.label}
              </span>
            </div>
            {step.status === 'running' && (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-cyan-500/20">
                <div className="h-full w-full bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent bg-[length:200%_100%] motion-safe:animate-[shimmer_1.2s_linear_infinite]" />
              </div>
            )}
            {step.detail && step.status !== 'running' && (
              <p className="ml-5 mt-0.5 break-all font-mono text-[10px] leading-relaxed text-white/40">
                {step.detail}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function DashboardAssistant({ open, onClose, botId, botName }: Props) {
  const { token } = useAuthStore();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attached, setAttached] = useState<{ dataUrl: string; base64: string; mediaType: string; name: string } | null>(null);
  const [imageModal, setImageModal] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  // Escape cierra el panel
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

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
      setAttached({
        dataUrl,
        base64: dataUrl.split(',')[1] ?? '',
        mediaType: file.type,
        name: file.name,
      });
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

  /** Historial para el backend: turnos reales como texto (nunca los locales) */
  function buildHistory(msgs: AssistantMessage[]): { role: 'user' | 'assistant'; content: string }[] {
    return msgs
      .filter((m) => !m.isLocal && !m.streaming && !m.confirm && !m.blocks)
      .map((m) => ({
        role: m.role,
        content: m.instructivo
          ? `${m.content}\n${INSTRUCTIVO_MARKER}\n${m.instructivo}`
          : m.content,
      }))
      .filter((m) => m.content.trim().length > 0);
  }

  /** Nucleo: envia el request al backend y procesa el stream de eventos */
  async function runRequest(body: Record<string, unknown>) {
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const updatePlaceholder = (updater: (last: AssistantMessage) => AssistantMessage) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role !== 'assistant') return prev;
        next[next.length - 1] = updater(last);
        return next;
      });
    };

    let accumulated = '';
    let pendingBlocks: unknown[] | null = null;

    try {
      const res = await fetch('/api/assistant/dashboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error('respuesta no disponible');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const raw of events) {
          const line = raw.trim();
          if (!line.startsWith('data: ')) continue;
          let ev: {
            type: string;
            text?: string;
            tool?: string;
            input?: unknown;
            success?: boolean;
            result?: unknown;
            toolUseId?: string;
            message?: string;
            blocks?: unknown[];
          };
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          switch (ev.type) {
            case 'text':
              accumulated += ev.text ?? '';
              updatePlaceholder((last) => ({ ...last, ...splitAccumulated(accumulated) }));
              break;

            case 'tool_start':
              updatePlaceholder((last) => ({
                ...last,
                execSteps: [
                  ...(last.execSteps ?? []),
                  {
                    tool: ev.tool ?? '',
                    status: 'running',
                    label: TOOL_LABELS[ev.tool ?? ''] ?? `Ejecutando ${ev.tool}...`,
                  },
                ],
              }));
              break;

            case 'tool_end':
              updatePlaceholder((last) => {
                const steps = [...(last.execSteps ?? [])];
                for (let i = steps.length - 1; i >= 0; i--) {
                  if (steps[i].tool === ev.tool && steps[i].status === 'running') {
                    steps[i] = {
                      ...steps[i],
                      status: ev.success ? 'success' : 'error',
                      label: ev.success
                        ? steps[i].label.replace('...', ' — listo')
                        : steps[i].label.replace('...', ' — falló'),
                      detail:
                        typeof ev.result === 'string'
                          ? ev.result.slice(0, 200)
                          : JSON.stringify(ev.result ?? {}).slice(0, 200),
                    };
                    break;
                  }
                }
                return { ...last, execSteps: steps };
              });
              break;

            case 'assistant_blocks':
              pendingBlocks = ev.blocks ?? null;
              break;

            case 'confirm_required':
              updatePlaceholder((last) => ({
                ...last,
                streaming: false,
                confirm: {
                  toolUseId: ev.toolUseId ?? '',
                  tool: ev.tool ?? '',
                  message: ev.message ?? 'Se va a ejecutar una acción.',
                },
                blocks: pendingBlocks ?? undefined,
              }));
              break;

            case 'done':
            default:
              break;
          }
        }
      }

      updatePlaceholder((last) => {
        if (last.confirm && !last.confirm.resolved) return last;
        if (!accumulated && !(last.execSteps?.length)) {
          return { ...last, streaming: false, content: last.content || 'No pude generar una respuesta. Probá de nuevo.' };
        }
        return { ...last, streaming: false };
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        updatePlaceholder((last) => ({
          ...last,
          streaming: false,
          content: last.content || 'Tuve un problema de conexión. Probá de nuevo en unos segundos.',
        }));
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if ((!text && !attached) || sending) return;

    const userText = text || 'Mirá esta imagen';
    const image = attached;
    setInput('');
    setAttached(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const history = buildHistory(messages);
    const outgoing = [...history, { role: 'user' as const, content: userText }];

    setMessages((prev) => [
      ...prev,
      { id: newId(), role: 'user', content: userText, ts: Date.now(), ...(image ? { imageDataUrl: image.dataUrl } : {}) },
      { id: newId(), role: 'assistant', content: '', streaming: true, ts: Date.now() },
    ]);

    await runRequest({
      messages: outgoing,
      ...(botId ? { botId } : {}),
      ...(image ? { image: { data: image.base64, mediaType: image.mediaType } } : {}),
    });
  }

  /** Confirmar una accion destructiva: reanuda con los blocks + id confirmado */
  async function confirmAction(index: number) {
    const msg = messages[index];
    if (!msg?.confirm || !msg.blocks) return;

    const history = buildHistory(messages.slice(0, index));
    const outgoing = [
      ...history,
      { role: 'assistant' as const, content: msg.blocks },
    ];

    setMessages((prev) => [
      ...prev.map((m, i) =>
        i === index ? { ...m, confirm: { ...m.confirm!, resolved: 'confirmed' as const } } : m,
      ),
      { id: newId(), role: 'assistant', content: '', streaming: true, ts: Date.now() },
    ]);

    await runRequest({
      messages: outgoing,
      ...(botId ? { botId } : {}),
      confirmedToolUseIds: [msg.confirm.toolUseId],
    });
  }

  /** Cancelar: descarta el turno pendiente (nunca viajo al backend como hecho) */
  function cancelAction(index: number) {
    setMessages((prev) => [
      ...prev.filter((_, i) => i !== index),
      { id: newId(), role: 'assistant', content: 'Acción cancelada.', isLocal: true, ts: Date.now() },
    ]);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 motion-safe:animate-[overlay-fade-in_0.3s_ease]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-white/10 bg-[#080810] shadow-2xl shadow-black/50 motion-safe:animate-[assistant-slide-in_0.3s_cubic-bezier(0.4,0,0.2,1)] md:max-w-[480px]">
        {/* Header glassmorphism */}
        <div className="flex h-[72px] shrink-0 items-center gap-3 border-b border-white/10 bg-black/40 px-5 py-4 backdrop-blur-xl">
          <Image src="/asistente-logo.svg" alt="" width={36} height={36} unoptimized className="h-9 w-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">Asistente BotForge</p>
            {botName ? (
              <p className="truncate text-xs text-cyan-400/70">Gestionando: {botName}</p>
            ) : (
              <p className="truncate text-xs text-white/40">Listo para ayudarte</p>
            )}
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            En línea
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar asistente"
            className="ml-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* Mensajes */}
        <div
          ref={scrollRef}
          className={`assistant-scroll flex flex-1 flex-col gap-4 overflow-y-auto scroll-smooth px-4 py-4 ${
            messages.length === 1 && messages[0]?.isLocal ? 'justify-center' : ''
          }`}
        >
          {/* Empty state: solo la bienvenida, centrada con el robot grande */}
          {messages.length === 1 && messages[0]?.isLocal && (
            <div className="mb-2 flex justify-center">
              <Image src="/asistente-logo.svg" alt="" width={64} height={64} unoptimized className="h-16 w-16" />
            </div>
          )}
          {messages.map((m, i) => {
            const isTyping = m.streaming && !m.content && !m.execSteps?.length && m.instructivo === undefined;
            const isUser = m.role === 'user';
            return (
              <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={m.instructivo !== undefined || m.execSteps?.length ? 'w-full max-w-[95%]' : isUser ? 'max-w-[80%]' : 'max-w-[85%]'}>
                  {/* Burbuja usuario */}
                  {isUser && (
                    <div
                      className="px-4 py-3 text-sm leading-relaxed text-white"
                      style={{
                        background: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
                        borderRadius: '20px 20px 4px 20px',
                      }}
                    >
                      {m.imageDataUrl && (
                        <button
                          type="button"
                          onClick={() => setImageModal(m.imageDataUrl ?? null)}
                          className="mb-2 block w-full overflow-hidden rounded-xl"
                          aria-label="Ver imagen completa"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.imageDataUrl} alt="Imagen adjunta" className="w-full object-cover" />
                        </button>
                      )}
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    </div>
                  )}

                  {/* Burbuja asistente */}
                  {!isUser && (
                    <>
                      {isTyping ? (
                        <div
                          className="flex w-fit items-center gap-1.5 border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-sm"
                          style={{ borderRadius: '20px 20px 20px 4px' }}
                        >
                          {[0, 1, 2].map((d) => (
                            <span
                              key={d}
                              className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400/70"
                              style={{ animationDelay: `${d * 150}ms` }}
                            />
                          ))}
                        </div>
                      ) : (
                        m.content && (
                          <div
                            className="whitespace-pre-wrap border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-[#E8E8F0] backdrop-blur-sm"
                            style={{ borderRadius: '20px 20px 20px 4px' }}
                          >
                            {m.content}
                          </div>
                        )
                      )}

                      {/* Terminal de ejecucion */}
                      {m.execSteps && m.execSteps.length > 0 && <ToolExecutionLog steps={m.execSteps} />}

                      {/* Confirmacion de accion destructiva */}
                      {m.confirm && (
                        <div className="mt-2 rounded-xl border border-red-500/30 bg-[rgba(239,68,68,0.08)] p-4">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-orange-400" />
                            <p className="text-sm font-semibold text-[#E8E8F0]">Confirmar acción</p>
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-white/70">{m.confirm.message}</p>
                          {m.confirm.resolved === 'confirmed' ? (
                            <p className="mt-3 text-xs text-green-400">Confirmado — ejecutando...</p>
                          ) : (
                            <div className="mt-3 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => cancelAction(i)}
                                disabled={sending}
                                className="min-h-[44px] rounded-lg bg-white/5 px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => void confirmAction(i)}
                                disabled={sending}
                                className="min-h-[44px] rounded-lg bg-red-500/80 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-40"
                              >
                                Confirmar
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Instructivo editable */}
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
                    </>
                  )}

                  {!isTyping && (
                    <p className={`mt-1 px-1 text-[10px] text-white/25 ${isUser ? 'text-right' : ''}`}>
                      {formatTime(m.ts)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t border-white/10 bg-black/40 p-4 backdrop-blur-xl">
          {/* Preview de imagen adjunta */}
          {attached && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-white/5 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attached.dataUrl} alt="" className="h-11 w-11 rounded-lg object-cover" />
              <p className="min-w-0 flex-1 truncate text-xs text-white/50">{attached.name}</p>
              <button
                type="button"
                onClick={() => setAttached(null)}
                aria-label="Quitar imagen"
                className="p-1 text-white/40 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
            className="flex items-end gap-2"
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
              className="flex h-10 w-10 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl bg-white/5 transition-colors hover:bg-white/10"
            >
              <Paperclip className="h-[18px] w-[18px] text-white/40" />
            </button>
            <div className="relative min-w-0 flex-1">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={1}
                placeholder="Escribí tu mensaje..."
                maxLength={6000}
                style={{ fontSize: '16px' }}
                className="min-h-[42px] max-h-[120px] w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 leading-relaxed text-white transition-colors placeholder:text-white/30 focus:border-cyan-500/40 focus:outline-none"
              />
              {input.length > 500 && (
                <span className="pointer-events-none absolute bottom-1.5 right-2.5 text-[10px] text-white/30">
                  {input.length}/6000
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={(!input.trim() && !attached) || sending}
              aria-label="Enviar mensaje"
              className="flex h-10 w-10 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 transition-all hover:opacity-90 active:scale-95 disabled:opacity-30"
            >
              <SendHorizonal className="h-[18px] w-[18px] text-black" />
            </button>
          </form>
        </div>
      </div>

      {/* Modal de imagen completa */}
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
