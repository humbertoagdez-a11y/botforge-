'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { AUTH_CARD, AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AUTH_MUTED, AUTH_SUBMIT } from '@/lib/auth-styles';

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const user = await api.auth.login(data.email, data.password);
      if (!user.accessToken) throw new Error('No se recibió token');
      setAuth(user.accessToken, user);
      router.push('/dashboard');
    } catch (err) {
      // Contraseña correcta pero email sin verificar: va a completar el paso
      if ((err as ApiError).code === 'EMAIL_NOT_VERIFIED') {
        try {
          sessionStorage.setItem('bf_verify_email', data.email);
        } catch {
          // sin sessionStorage el email igual viaja por query
        }
        router.push(`/auth/verify-email?email=${encodeURIComponent(data.email)}`);
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Error al ingresar');
      setLoading(false);
    }
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
        <h1 className="mt-4 font-mono text-2xl font-bold text-white">Ingresar</h1>
        <p className={`mt-1.5 text-sm ${AUTH_MUTED}`}>Accedé a tu cuenta de BotForge</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email" className={AUTH_LABEL}>Email</Label>
          <Input id="email" type="email" placeholder="vos@empresa.com" className={AUTH_INPUT} {...register('email')} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className={AUTH_LABEL}>Contraseña</Label>
          <Input id="password" type="password" placeholder="••••••••" className={AUTH_INPUT} {...register('password')} />
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>
        <Button type="submit" className={AUTH_SUBMIT} disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Ingresar
        </Button>
      </form>

      <p className="mt-4 text-center text-sm">
        <Link href="/auth/forgot-password" className={AUTH_LINK}>¿Olvidaste tu contraseña?</Link>
      </p>

      <p className={`mt-3 text-center text-sm ${AUTH_MUTED}`}>
        ¿No tenés cuenta?{' '}
        <Link href="/auth/register" className={AUTH_LINK}>Registrate gratis</Link>
      </p>
    </div>
  );
}
