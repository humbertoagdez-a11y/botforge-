'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, KeyRound, Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { AUTH_CARD, AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AUTH_MUTED, AUTH_SUBMIT } from '@/lib/auth-styles';

const schema = z.object({
  email: z.string().email('Email inválido'),
});
type FormData = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [enviado, setEnviado] = useState(false);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      await api.auth.forgotPassword(data.email);
    } catch {
      // Se ignora a propósito: mostrar un error revelaría si el email existe
    } finally {
      setLoading(false);
      setEnviado(true);
    }
  }

  // ── Confirmación: el mismo mensaje exista o no la cuenta ───────────────────
  if (enviado) {
    return (
      <div className={AUTH_CARD}>
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 ring-1 ring-green-500/20">
            <MailCheck className="h-7 w-7 text-green-400" />
          </div>
          <h1 className="mt-4 font-mono text-2xl font-bold text-white">Revisá tu correo</h1>
          <p className={`mt-2 text-sm ${AUTH_MUTED}`}>
            Si ese email tiene una cuenta en BotForge, te mandamos las instrucciones para
            recuperar tu contraseña. El enlace vence en 1 hora.
          </p>
          <p className={`mt-4 text-xs ${AUTH_MUTED}`}>
            ¿No te llegó? Revisá la carpeta de spam antes de volver a intentar.
          </p>
        </div>

        <Button asChild variant="outline" className="mt-6 w-full">
          <Link href="/auth/login">
            <ArrowLeft className="h-4 w-4" /> Volver a ingresar
          </Link>
        </Button>
      </div>
    );
  }

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
        <h1 className="mt-4 font-mono text-2xl font-bold text-white">Recuperar contraseña</h1>
        <p className={`mt-1.5 text-sm ${AUTH_MUTED}`}>
          Poné tu email y te mandamos un enlace para elegir una nueva.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email" className={AUTH_LABEL}>Email</Label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="vos@empresa.com"
              className={`${AUTH_INPUT} pl-9`}
              {...register('email')}
            />
          </div>
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <Button type="submit" className={AUTH_SUBMIT} disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Enviar instrucciones
        </Button>
      </form>

      <p className={`mt-6 text-center text-sm ${AUTH_MUTED}`}>
        ¿Te acordaste?{' '}
        <Link href="/auth/login" className={AUTH_LINK}>Volver a ingresar</Link>
      </p>
    </div>
  );
}
