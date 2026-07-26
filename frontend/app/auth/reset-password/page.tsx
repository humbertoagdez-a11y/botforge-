'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Loader2, Lock, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { AUTH_CARD, AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AUTH_MUTED, AUTH_SUBMIT } from '@/lib/auth-styles';

/** Espera antes de mandar al login tras el cambio */
const REDIRECT_MS = 2500;

const schema = z
  .object({
    newPassword: z.string().min(8, 'Mínimo 8 caracteres').max(100),
    confirmPassword: z.string().min(1, 'Confirmá tu contraseña'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  });
type FormData = z.infer<typeof schema>;

type Estado = 'verificando' | 'invalido' | 'formulario' | 'listo';

function ResetPassword() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [estado, setEstado] = useState<Estado>('verificando');
  const [errorMsg, setErrorMsg] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  // Se verifica antes de mostrar el formulario para no hacer escribir una
  // contraseña que después va a ser rechazada por un link vencido
  useEffect(() => {
    let cancelado = false;
    void (async () => {
      if (!token) {
        setEstado('invalido');
        return;
      }
      try {
        const { valid } = await api.auth.verifyResetToken(token);
        if (cancelado) return;
        setEstado(valid ? 'formulario' : 'invalido');
      } catch {
        if (!cancelado) setEstado('invalido');
      }
    })();
    return () => { cancelado = true; };
  }, [token]);

  useEffect(() => {
    if (estado !== 'listo') return;
    const t = setTimeout(() => router.push('/auth/login'), REDIRECT_MS);
    return () => clearTimeout(t);
  }, [estado, router]);

  async function onSubmit(data: FormData) {
    setErrorMsg('');
    try {
      await api.auth.resetPassword(token, data.newPassword);
      setEstado('listo');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña');
    }
  }

  // ── Verificando el link ────────────────────────────────────────────────────
  if (estado === 'verificando') {
    return (
      <div className={AUTH_CARD}>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
          <p className={`text-sm ${AUTH_MUTED}`}>Verificando el enlace...</p>
        </div>
      </div>
    );
  }

  // ── Link vencido o inválido ────────────────────────────────────────────────
  if (estado === 'invalido') {
    return (
      <div className={AUTH_CARD}>
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 ring-1 ring-red-500/20">
            <XCircle className="h-7 w-7 text-red-400" />
          </div>
          <h1 className="mt-4 font-mono text-2xl font-bold text-white">Este link expiró</h1>
          <p className={`mt-2 text-sm ${AUTH_MUTED}`}>
            El enlace venció, ya se usó o no es válido. Los enlaces duran 1 hora y sirven
            una sola vez.
          </p>
        </div>

        <Button asChild className={`${AUTH_SUBMIT} mt-6`}>
          <Link href="/auth/forgot-password">Pedir un enlace nuevo</Link>
        </Button>

        <p className={`mt-4 text-center text-sm ${AUTH_MUTED}`}>
          <Link href="/auth/login" className={AUTH_LINK}>Volver a ingresar</Link>
        </p>
      </div>
    );
  }

  // ── Contraseña cambiada ────────────────────────────────────────────────────
  if (estado === 'listo') {
    return (
      <div className={AUTH_CARD}>
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 ring-1 ring-green-500/20">
            <CheckCircle2 className="h-7 w-7 text-green-400" />
          </div>
          <h1 className="mt-4 font-mono text-2xl font-bold text-white">¡Listo!</h1>
          <p className={`mt-2 text-sm ${AUTH_MUTED}`}>
            Tu contraseña se cambió. Te llevamos al login para que entres con la nueva.
          </p>
        </div>

        <Button asChild className={`${AUTH_SUBMIT} mt-6`}>
          <Link href="/auth/login">Ingresar ahora</Link>
        </Button>
      </div>
    );
  }

  // ── Formulario ─────────────────────────────────────────────────────────────
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
        <h1 className="mt-4 font-mono text-2xl font-bold text-white">Elegí una contraseña nueva</h1>
        <p className={`mt-1.5 text-sm ${AUTH_MUTED}`}>
          Al cambiarla se cierran las sesiones abiertas en otros dispositivos.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="newPassword" className={AUTH_LABEL}>Nueva contraseña</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
              className={`${AUTH_INPUT} pl-9`}
              {...register('newPassword')}
            />
          </div>
          {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword" className={AUTH_LABEL}>Confirmar contraseña</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Repetí la contraseña"
              className={`${AUTH_INPUT} pl-9`}
              {...register('confirmPassword')}
            />
          </div>
          {errors.confirmPassword && (
            <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
          )}
        </div>

        {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}

        <Button type="submit" className={AUTH_SUBMIT} disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Cambiar contraseña
        </Button>
      </form>

      <p className={`mt-6 text-center text-sm ${AUTH_MUTED}`}>
        <Link href="/auth/login" className={AUTH_LINK}>Volver a ingresar</Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
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
      <ResetPassword />
    </Suspense>
  );
}
