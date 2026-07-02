'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { KeyRound, Loader2, UserCircle, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type User } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { formatDate } from '@/lib/utils';

const PLAN_LABEL: Record<User['plan'], { label: string; className: string }> = {
  FREE: { label: 'Free', className: 'bg-muted text-muted-foreground' },
  STARTER: { label: 'Básico', className: 'bg-blue-500/15 text-blue-400' },
  PRO: { label: 'Profesional', className: 'bg-primary/15 text-violet-400' },
  AGENCY: { label: 'Agencia', className: 'bg-cyan-400/15 text-cyan-400' },
};

const profileSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(100),
});
type ProfileData = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Ingresá tu contraseña actual'),
    newPassword: z.string().min(8, 'Mínimo 8 caracteres'),
    confirmPassword: z.string().min(1, 'Confirmá la nueva contraseña'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'La nueva contraseña no puede ser igual a la actual',
    path: ['newPassword'],
  });
type PasswordData = z.infer<typeof passwordSchema>;

export default function PerfilPage() {
  const { user: storedUser, token, setAuth } = useAuthStore();
  const [user, setUser] = useState<User | null>(storedUser);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const profileForm = useForm<ProfileData>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: storedUser?.name ?? '' },
  });

  const passwordForm = useForm<PasswordData>({ resolver: zodResolver(passwordSchema) });

  useEffect(() => {
    api.auth
      .me()
      .then((u) => {
        setUser(u);
        profileForm.reset({ name: u.name });
      })
      .catch(() => toast.error('Error al cargar tu perfil'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSaveProfile(data: ProfileData) {
    setSavingProfile(true);
    try {
      const updated = await api.auth.updateProfile(data.name);
      setUser(updated);
      if (token) setAuth(token, { ...updated, accessToken: token });
      toast.success('Perfil actualizado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSavingProfile(false);
    }
  }

  async function onChangePassword(data: PasswordData) {
    setSavingPassword(true);
    try {
      await api.auth.updatePassword(data.currentPassword, data.newPassword);
      passwordForm.reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('Contraseña actualizada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cambiar la contraseña');
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading && !user) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const plan = user ? PLAN_LABEL[user.plan] : PLAN_LABEL.FREE;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Mi perfil</h1>
        <p className="mt-1 text-sm text-muted-foreground">Gestioná tu cuenta y seguridad</p>
      </div>

      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        {/* Informacion personal */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCircle className="h-4 w-4 text-primary" />
              Información personal
            </CardTitle>
            <CardDescription>Tu nombre y datos de contacto</CardDescription>
          </CardHeader>
          <form onSubmit={profileForm.handleSubmit(onSaveProfile)}>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Nombre</Label>
                <Input id="profile-name" {...profileForm.register('name')} />
                {profileForm.formState.errors.name && (
                  <p className="text-xs text-destructive">
                    {profileForm.formState.errors.name.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-email">Email</Label>
                <Input id="profile-email" value={user?.email ?? ''} readOnly disabled />
                <p className="text-xs text-muted-foreground">
                  Para cambiar el email contactá a soporte
                </p>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={savingProfile}>
                  {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
                  Guardar cambios
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>

        {/* Cambio de contraseña */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" />
              Cambio de contraseña
            </CardTitle>
            <CardDescription>Elegí una contraseña segura de al menos 8 caracteres</CardDescription>
          </CardHeader>
          <form onSubmit={passwordForm.handleSubmit(onChangePassword)}>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pw-current">Contraseña actual</Label>
                <Input id="pw-current" type="password" {...passwordForm.register('currentPassword')} />
                {passwordForm.formState.errors.currentPassword && (
                  <p className="text-xs text-destructive">
                    {passwordForm.formState.errors.currentPassword.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-new">Nueva contraseña</Label>
                <Input id="pw-new" type="password" {...passwordForm.register('newPassword')} />
                {passwordForm.formState.errors.newPassword && (
                  <p className="text-xs text-destructive">
                    {passwordForm.formState.errors.newPassword.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-confirm">Confirmar nueva contraseña</Label>
                <Input id="pw-confirm" type="password" {...passwordForm.register('confirmPassword')} />
                {passwordForm.formState.errors.confirmPassword && (
                  <p className="text-xs text-destructive">
                    {passwordForm.formState.errors.confirmPassword.message}
                  </p>
                )}
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={savingPassword}>
                  {savingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
                  Cambiar contraseña
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>

        {/* Informacion de la cuenta */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-primary" />
              Información de la cuenta
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Plan actual</p>
              <Badge className={`mt-1 ${plan.className}`}>{plan.label}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Registrado</p>
              <p className="mt-1 text-sm font-medium">
                {user?.createdAt ? formatDate(user.createdAt) : '—'}
              </p>
            </div>
            <Link
              href="/pricing"
              className="ml-auto text-sm font-medium text-primary hover:underline"
            >
              Ver planes disponibles
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
