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
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { AUTH_CARD, AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AUTH_MUTED, AUTH_SUBMIT } from '@/lib/auth-styles';

const schema = z
  .object({
    name: z.string().min(2, 'Mínimo 2 caracteres'),
    email: z.string().email('Email inválido'),
    password: z.string().min(8, 'Mínimo 8 caracteres'),
    confirmPassword: z.string().min(1, 'Confirmá tu contraseña'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  });
type FormData = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const user = await api.auth.register(data.name, data.email, data.password);
      if (!user.accessToken) throw new Error('No se recibió token');
      setAuth(user.accessToken, user);
      toast.success('¡Bienvenido a BotForge!');
      router.push('/dashboard');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrarse');
    } finally {
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
        <h1 className="mt-4 font-mono text-2xl font-bold text-white">Crear cuenta</h1>
        <p className={`mt-1.5 text-sm ${AUTH_MUTED}`}>Empezá gratis, sin tarjeta de crédito</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name" className={AUTH_LABEL}>Nombre</Label>
          <Input id="name" placeholder="Tu nombre" className={AUTH_INPUT} {...register('name')} />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email" className={AUTH_LABEL}>Email</Label>
          <Input id="email" type="email" placeholder="vos@empresa.com" className={AUTH_INPUT} {...register('email')} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className={AUTH_LABEL}>Contraseña</Label>
          <Input id="password" type="password" placeholder="Mínimo 8 caracteres" className={AUTH_INPUT} {...register('password')} />
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword" className={AUTH_LABEL}>Confirmar contraseña</Label>
          <Input id="confirmPassword" type="password" placeholder="Repetí tu contraseña" className={AUTH_INPUT} {...register('confirmPassword')} />
          {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
        </div>
        <Button type="submit" className={AUTH_SUBMIT} disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Crear cuenta
        </Button>
      </form>

      <p className={`mt-5 text-center text-[11px] leading-relaxed ${AUTH_MUTED}`}>
        Al registrarte aceptás los{' '}
        <Link href="/terminos" className="underline transition-colors hover:text-cyan-400">Términos de servicio</Link>
        {' '}y la{' '}
        <Link href="/privacidad" className="underline transition-colors hover:text-cyan-400">Política de privacidad</Link>
      </p>
      <p className={`mt-4 text-center text-sm ${AUTH_MUTED}`}>
        ¿Ya tenés cuenta?{' '}
        <Link href="/auth/login" className={AUTH_LINK}>Ingresá</Link>
      </p>
    </div>
  );
}
