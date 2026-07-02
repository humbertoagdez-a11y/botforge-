import Link from 'next/link';
import Image from 'next/image';
import { Zap } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-violet-50 to-indigo-50 p-4">
      {/* Mascota decorativa */}
      <Image
        src="/mascota.svg"
        alt=""
        aria-hidden
        width={400}
        height={400}
        unoptimized
        className="pointer-events-none absolute -right-20 top-1/2 hidden w-80 -translate-y-1/2 opacity-30 lg:block xl:right-10 xl:opacity-60"
      />
      <Link href="/" className="relative mb-8 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Zap className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-xl font-bold">BotForge</span>
      </Link>
      <div className="relative">{children}</div>
    </div>
  );
}
