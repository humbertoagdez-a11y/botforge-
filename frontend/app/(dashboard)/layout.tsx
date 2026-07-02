'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import TechBackground from '@/components/TechBackground';
import { useAuthStore } from '@/lib/store';
import { refreshSession } from '@/lib/api';

const REFRESH_MARGIN_MS = 2 * 60 * 1000;

// Lee el campo exp del JWT sin librerias (payload base64url → atob)
function tokenExpiresSoon(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(base64)) as { exp?: number };
    if (typeof decoded.exp !== 'number') return false;
    return decoded.exp * 1000 - Date.now() < REFRESH_MARGIN_MS;
  } catch {
    return false;
  }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token } = useAuthStore();

  useEffect(() => {
    if (!token) router.replace('/auth/login');
  }, [token, router]);

  // Refresh proactivo: al montar y cada 60s, si el token vence en <2 min
  // lo renueva antes de que cualquier request falle
  useEffect(() => {
    if (!token) return;
    const check = () => {
      if (tokenExpiresSoon(token)) void refreshSession();
    };
    check();
    const interval = setInterval(check, 60 * 1000);
    return () => clearInterval(interval);
  }, [token]);

  if (!token) return null;

  return (
    <div className="theme-dashboard relative flex h-screen overflow-hidden bg-background text-foreground">
      {/* Particulas detras del area de contenido (el sidebar mide w-60) */}
      <div className="pointer-events-none absolute inset-y-0 left-60 right-0 z-0">
        <TechBackground />
      </div>
      <Sidebar />
      <main className="dot-grid-dark relative z-10 flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
