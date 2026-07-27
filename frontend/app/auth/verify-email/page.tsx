'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api, type ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { AUTH_CARD, AUTH_LINK, AUTH_MUTED, AUTH_SUBMIT } from '@/lib/auth-styles';

const CODE_LENGTH = 6;
/** Espera antes de poder pedir otro código */
const RESEND_COOLDOWN_S = 60;
/** Clave donde register/login dejan el email antes de redirigir acá */
const EMAIL_KEY = 'bf_verify_email';

function VerifyEmail() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuthStore();

  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // El email llega por query (?email=) o por sessionStorage, según de dónde
  // venga el usuario (registro o login con EMAIL_NOT_VERIFIED)
  useEffect(() => {
    const fromQuery = searchParams.get('email');
    if (fromQuery) {
      setEmail(fromQuery);
      return;
    }
    try {
      setEmail(sessionStorage.getItem(EMAIL_KEY) ?? '');
    } catch {
      setEmail('');
    }
  }, [searchParams]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  const verificar = useCallback(
    async (code: string) => {
      if (!email) {
        setError('No sabemos qué cuenta verificar. Volvé a ingresar para pedir un código nuevo.');
        return;
      }
      setVerificando(true);
      setError('');
      try {
        const user = await api.auth.verifyEmail(email, code);

        if (user.alreadyVerified) {
          toast.success('Tu email ya estaba verificado. Ingresá con tu contraseña.');
          router.push('/auth/login');
          return;
        }
        if (!user.accessToken) throw new Error('No se recibió token');

        try {
          sessionStorage.removeItem(EMAIL_KEY);
        } catch {
          // sin sessionStorage no hay nada que limpiar
        }
        setAuth(user.accessToken, user);
        toast.success('¡Email verificado! Bienvenido a BotForge.');
        router.push('/dashboard');
      } catch (err) {
        const apiErr = err as ApiError;
        setDigits(Array(CODE_LENGTH).fill(''));
        inputsRef.current[0]?.focus();

        if (apiErr.code === 'VERIFICATION_LOCKED') {
          setError('Demasiados intentos con ese código. Pedí uno nuevo con el enlace de abajo.');
          setCooldown(0);
        } else if (apiErr.code === 'VERIFICATION_INVALID') {
          setError('El código no es correcto o ya venció. Revisá el último email que te llegó.');
        } else {
          setError(apiErr.message || 'No pudimos verificar el código. Intentá de nuevo.');
        }
      } finally {
        setVerificando(false);
      }
    },
    [email, router, setAuth],
  );

  /** Escribe los dígitos a partir de una posición y devuelve el código resultante */
  function aplicarDigitos(desde: number, texto: string) {
    const limpio = texto.replace(/\D/g, '');
    if (!limpio) return;

    setDigits((prev) => {
      const next = [...prev];
      for (let i = 0; i < limpio.length && desde + i < CODE_LENGTH; i++) {
        next[desde + i] = limpio[i];
      }
      const ultimo = Math.min(desde + limpio.length, CODE_LENGTH - 1);
      inputsRef.current[ultimo]?.focus();

      // Código completo: se envía solo, sin obligar a apretar el botón
      const completo = next.join('');
      if (completo.length === CODE_LENGTH && !completo.includes('')) {
        void verificar(completo);
      }
      return next;
    });
    setError('');
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      setDigits((prev) => {
        const next = [...prev];
        // Si la casilla ya está vacía, borra la anterior y retrocede
        if (!next[index] && index > 0) {
          next[index - 1] = '';
          inputsRef.current[index - 1]?.focus();
        } else {
          next[index] = '';
        }
        return next;
      });
      setError('');
      return;
    }
    if (e.key === 'ArrowLeft' && index > 0) inputsRef.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) inputsRef.current[index + 1]?.focus();
  }

  async function reenviar() {
    if (cooldown > 0 || !email) return;
    setCooldown(RESEND_COOLDOWN_S);
    setError('');
    setDigits(Array(CODE_LENGTH).fill(''));
    try {
      await api.auth.resendVerification(email);
      toast.success('Si esa cuenta existe, te mandamos un código nuevo.');
      inputsRef.current[0]?.focus();
    } catch (err) {
      const apiErr = err as ApiError;
      // El 429 del rate limit sí conviene mostrarlo: no revela si el email existe
      setError(apiErr.message || 'No pudimos reenviar el código.');
    }
  }

  const codigo = digits.join('');

  return (
    <div className={AUTH_CARD}>
      <div className="flex flex-col items-center text-center">
        <Image
          src="/asistente-logo.svg"
          alt=""
          aria-hidden
          width={80}
          height={80}
          unoptimized
          className="h-14 w-14 sm:h-20 sm:w-20"
        />
        <h1 className="mt-4 font-mono text-2xl font-bold text-white">Verificá tu email</h1>
        <p className={`mt-1.5 text-sm ${AUTH_MUTED}`}>
          {email ? (
            <>
              Te mandamos un código de 6 dígitos a{' '}
              <span className="font-medium text-[#E8E8F0]">{email}</span>
            </>
          ) : (
            'Ingresá el código de 6 dígitos que te enviamos por email.'
          )}
        </p>
      </div>

      <div className="mt-7">
        <div className="flex justify-center gap-2" onPaste={(e) => {
          // Pegar el código completo lo distribuye entre las casillas
          e.preventDefault();
          aplicarDigitos(0, e.clipboardData.getData('text'));
        }}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputsRef.current[i] = el; }}
              type="text"
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={CODE_LENGTH}
              value={d}
              disabled={verificando}
              onChange={(e) => aplicarDigitos(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onFocus={(e) => e.target.select()}
              aria-label={`Dígito ${i + 1}`}
              className="h-14 w-11 rounded-xl border border-white/10 bg-white/5 text-center font-mono text-2xl font-bold text-[#E8E8F0] transition-colors focus:border-cyan-500/40 focus:outline-none disabled:opacity-50 sm:w-12"
            />
          ))}
        </div>

        {error && <p className="mt-3 text-center text-xs text-destructive">{error}</p>}

        <Button
          className={`${AUTH_SUBMIT} mt-6`}
          onClick={() => void verificar(codigo)}
          disabled={verificando || codigo.length !== CODE_LENGTH || codigo.includes('')}
        >
          {verificando && <Loader2 className="h-4 w-4 animate-spin" />}
          Verificar
        </Button>

        <div className="mt-5 flex flex-col items-center gap-1">
          {cooldown > 0 ? (
            <p className={`text-xs ${AUTH_MUTED}`}>
              Podés pedir otro código en {cooldown}s
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void reenviar()}
              className={`inline-flex items-center gap-1.5 text-sm ${AUTH_LINK}`}
            >
              <MailCheck className="h-3.5 w-3.5" />
              Reenviar código
            </button>
          )}
          <p className={`text-[11px] ${AUTH_MUTED}`}>El código vence a los 15 minutos.</p>
        </div>
      </div>

      <p className={`mt-6 text-center text-sm ${AUTH_MUTED}`}>
        <Link href="/auth/login" className={AUTH_LINK}>Volver a ingresar</Link>
      </p>
    </div>
  );
}

export default function VerifyEmailPage() {
  // useSearchParams necesita un límite de Suspense para el prerender
  return (
    <Suspense
      fallback={
        <div className={AUTH_CARD}>
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
          </div>
        </div>
      }
    >
      <VerifyEmail />
    </Suspense>
  );
}
