'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import TechBackground from '@/components/TechBackground';
import { useAuthStore } from '@/lib/store';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token } = useAuthStore();

  useEffect(() => {
    if (!token) router.replace('/auth/login');
  }, [token, router]);

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
