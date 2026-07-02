'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { useAuthStore } from '@/lib/store';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token } = useAuthStore();

  useEffect(() => {
    if (!token) router.replace('/auth/login');
  }, [token, router]);

  if (!token) return null;

  return (
    <div className="theme-dashboard flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="dot-grid-dark flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
