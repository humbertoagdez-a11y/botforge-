'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardCopy, Loader2, MessageCircle, RefreshCw, Smartphone, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { useAuthStore } from '@/lib/store';
import type { Bot } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const POLL_INTERVAL = 3000;

type Step = 'idle' | 'requesting' | 'pending' | 'polling' | 'active' | 'expired';

interface ConnectionInfo {
  code: string;
  sandboxNumber: string;
  expiresAt: string;
}

interface Props {
  bot: Bot;
  onUpdate: (b: Bot) => void;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function WhatsAppOnboarding({ bot, onUpdate }: Props) {
  const { token } = useAuthStore();
  const [step, setStep] = useState<Step>(bot.whatsappNumber ? 'active' : 'idle');
  const [phoneInput, setPhoneInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [msLeft, setMsLeft] = useState(0);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync if bot prop changes (e.g., parent refreshes)
  useEffect(() => {
    if (bot.whatsappNumber && step !== 'active') setStep('active');
  }, [bot.whatsappNumber]);

  // Countdown timer
  useEffect(() => {
    if (step !== 'pending' && step !== 'polling') {
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }
    countdownRef.current = setInterval(() => {
      setMsLeft((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          clearInterval(countdownRef.current!);
          stopPolling();
          setStep('expired');
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [step]);

  // Polling for verification
  function startPolling() {
    setStep('polling');
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/v1/whatsapp/bots/${bot.id}/connection-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as {
          data: { status: string; phoneNumber?: string };
        };
        const { status, phoneNumber } = json.data;

        if (status === 'ACTIVE') {
          stopPolling();
          onUpdate({ ...bot, whatsappNumber: phoneNumber ?? null });
          setStep('active');
          toast.success('¡WhatsApp conectado exitosamente!');
        } else if (status === 'EXPIRED') {
          stopPolling();
          setStep('expired');
        }
      } catch {
        // network blip — keep polling
      }
    }, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => () => { stopPolling(); }, []);

  async function handleRequestConnection() {
    const num = phoneInput.trim();
    if (!/^\+\d{7,15}$/.test(num)) {
      setInputError('Formato inválido. Ejemplo: +595981234567');
      return;
    }
    setInputError('');
    setStep('requesting');
    try {
      const res = await fetch(`${API}/api/v1/whatsapp/bots/${bot.id}/request-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phoneNumber: num }),
      });
      const json = (await res.json()) as {
        data?: ConnectionInfo;
        error?: { message: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? 'Error al solicitar conexión');
      setConn(json.data!);
      setMsLeft(new Date(json.data!.expiresAt).getTime() - Date.now());
      setStep('pending');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
      setStep('idle');
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch(`${API}/api/v1/whatsapp/bots/${bot.id}/connect`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as { data?: Bot; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message);
      onUpdate(json.data!);
      setStep('idle');
      setPhoneInput('');
      toast.success('Número desconectado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al desconectar');
    } finally {
      setDisconnecting(false);
    }
  }

  function copyCode() {
    if (!conn) return;
    void navigator.clipboard.writeText(conn.code);
    toast.success('Código copiado');
  }

  // ── ACTIVE ─────────────────────────────────────────────────────────────────
  if (step === 'active') {
    return (
      <div className="max-w-xl space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 rounded-xl bg-green-50 p-4 border border-green-200">
              <CheckCircle2 className="h-8 w-8 shrink-0 text-green-600" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-green-800">WhatsApp conectado</p>
                <p className="font-mono text-sm text-green-700">{bot.whatsappNumber}</p>
                <p className="mt-0.5 text-xs text-green-600">Los mensajes que lleguen a este número serán respondidos por el bot</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="shrink-0 border-green-300 text-green-700 hover:bg-green-100"
              >
                {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                Desconectar
              </Button>
            </div>
          </CardContent>
        </Card>
        <TwilioInstructions />
      </div>
    );
  }

  // ── PENDING / POLLING ──────────────────────────────────────────────────────
  if ((step === 'pending' || step === 'polling') && conn) {
    return (
      <div className="max-w-xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-5 w-5 text-[#25D366]" />
              Enviá el código de verificación
            </CardTitle>
            <CardDescription>
              Seguí estos pasos desde tu WhatsApp para confirmar la conexión
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Step 1 */}
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</div>
              <div>
                <p className="text-sm font-medium">Abrí WhatsApp desde tu teléfono</p>
                <p className="text-xs text-muted-foreground">Usá el número <span className="font-mono font-semibold">{conn.sandboxNumber.replace('whatsapp:', '')}</span></p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</div>
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Mandá un mensaje a <span className="font-mono font-semibold">{conn.sandboxNumber}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">El mensaje tiene que ser exactamente este código:</p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 rounded-lg bg-muted px-4 py-3">
                    <span className="font-mono text-2xl font-bold tracking-widest">{conn.code}</span>
                  </div>
                  <Button variant="outline" size="icon" onClick={copyCode} title="Copiar código">
                    <ClipboardCopy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</div>
              <div>
                <p className="text-sm font-medium">Esperá la confirmación automática</p>
                <p className="text-xs text-muted-foreground">En cuanto mandés el código, BotForge lo detecta solo</p>
              </div>
            </div>

            {/* Countdown + action */}
            <div className="rounded-lg border bg-muted/30 px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Tiempo restante: <span className={`font-mono font-semibold ${msLeft < 60000 ? 'text-red-600' : 'text-foreground'}`}>{formatCountdown(msLeft)}</span>
                </p>
                {step === 'polling' ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Verificando...
                  </div>
                ) : (
                  <Button size="sm" onClick={startPolling}>
                    Ya lo mandé →
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => { stopPolling(); setStep('idle'); }}
        >
          ← Cambiar número
        </Button>
      </div>
    );
  }

  // ── EXPIRED ────────────────────────────────────────────────────────────────
  if (step === 'expired') {
    return (
      <div className="max-w-xl">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
              <RefreshCw className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <p className="font-semibold">El código expiró</p>
              <p className="mt-1 text-sm text-muted-foreground">Los códigos son válidos por 10 minutos. Generá uno nuevo e intentá de nuevo.</p>
            </div>
            <Button onClick={() => setStep('idle')}>Intentar de nuevo</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── IDLE / REQUESTING ──────────────────────────────────────────────────────
  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-5 w-5 text-primary" />
            Conectar número de WhatsApp
          </CardTitle>
          <CardDescription>
            Ingresá tu número y te guiamos paso a paso. El proceso toma menos de 2 minutos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wa-number">Tu número de WhatsApp</Label>
            <Input
              id="wa-number"
              placeholder="+595981234567"
              value={phoneInput}
              onChange={(e) => { setPhoneInput(e.target.value); setInputError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleRequestConnection(); }}
              className="font-mono"
              disabled={step === 'requesting'}
            />
            {inputError && <p className="text-xs text-destructive">{inputError}</p>}
            <p className="text-xs text-muted-foreground">
              Incluí el código de país. Ejemplo: +595 para Paraguay, +54 para Argentina.
            </p>
          </div>
          <Button
            className="w-full"
            onClick={handleRequestConnection}
            disabled={step === 'requesting' || !phoneInput}
          >
            {step === 'requesting' ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Generando código...</>
            ) : (
              <>Conectar WhatsApp →</>
            )}
          </Button>
        </CardContent>
      </Card>

      <TwilioInstructions />
    </div>
  );
}

function TwilioInstructions() {
  const webhookUrl = `${API}/api/v1/whatsapp/webhook`;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground">Configuración de Twilio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <p>Para que el bot responda por WhatsApp, configurá este webhook en tu número de Twilio:</p>
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-xs">
          <span className="flex-1 break-all">{webhookUrl}</span>
          <button
            className="shrink-0 rounded px-1.5 py-0.5 text-primary hover:bg-primary/10"
            onClick={() => {
              void navigator.clipboard.writeText(webhookUrl);
              toast.success('URL copiada');
            }}
          >
            Copiar
          </button>
        </div>
        <p>En el panel de Twilio → Messaging → tu número → "When a message comes in" → pegá la URL arriba (método: HTTP POST).</p>
      </CardContent>
    </Card>
  );
}
