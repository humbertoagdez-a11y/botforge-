'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { pixelTrack } from '@/lib/metaPixel';
import { datosMeta, nuevoEventId } from '@/lib/atribucion';
import { useAuthStore } from '@/lib/store';
import { AUTH_CARD, AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AUTH_MUTED, AUTH_SUBMIT } from '@/lib/auth-styles';

// Sin "Confirmar contraseña": era un campo mas para quien llega desde un
// anuncio en el celular. El error de tipeo que evitaba lo cubre el boton de
// ver la contraseña, y si igual se equivoca, "Olvidé mi contraseña" existe.
const schema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
});
type FormData = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [verClave, setVerClave] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      // El registro ya no devuelve sesión: primero hay que verificar el email
      // El mismo id viaja al servidor (API de Conversiones) y al pixel: Meta
      // junta los dos y cuenta un solo registro. Sin consentimiento, datosMeta
      // manda solo { consentimiento: false } y el pixel no se carga.
      const eventId = nuevoEventId('registro');
      const { email } = await api.auth.register(data.name, data.email, data.password, datosMeta(eventId));
      // Conversion: la cuenta quedo creada. Va antes del redirect porque la
      // pantalla de verificacion ya es otra ruta.
      pixelTrack('CompleteRegistration', { content_name: 'Registro' }, eventId);
      try {
        sessionStorage.setItem('bf_verify_email', email);
      } catch {
        // sin sessionStorage el email igual viaja por query
      }
      router.push(`/auth/verify-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrarse');
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
          <Input id="name" placeholder="Tu nombre" autoComplete="name" className={AUTH_INPUT} {...register('name')} />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email" className={AUTH_LABEL}>Email</Label>
          <Input id="email" type="email" inputMode="email" autoComplete="email" placeholder="vos@empresa.com" className={AUTH_INPUT} {...register('email')} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className={AUTH_LABEL}>Contraseña</Label>
          <div className="relative">
            <Input
              id="password"
              type={verClave ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
              className={`${AUTH_INPUT} pr-10`}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setVerClave((v) => !v)}
              aria-label={verClave ? 'Ocultar contraseña' : 'Ver contraseña'}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-400 hover:text-white"
            >
              {verClave ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
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
