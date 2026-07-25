import Link from 'next/link';
import Image from 'next/image';
import TechBackground from '@/components/TechBackground';

/**
 * Ambientación compartida de login y registro.
 *
 * Reutiliza las piezas que ya existen en el proyecto en vez de inventar un
 * fondo nuevo: las partículas del dashboard (TechBackground), la grilla de
 * puntos de globals.css (dot-grid-dark) y el glow violeta del hero de la
 * landing. `theme-dashboard` trae los tokens oscuros y, de paso, la regla
 * que fuerza inputs de 16px en móvil para que iOS no haga zoom al enfocar.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-dashboard dot-grid-dark relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0A0A0F] px-4 py-10">
      {/* Partículas: 35 puntos en canvas, ya corta solo con prefers-reduced-motion */}
      <div className="pointer-events-none absolute inset-0">
        <TechBackground />
      </div>

      {/* Glow violeta detrás de la card, mismo recurso que el hero de la landing */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[720px] max-w-[150vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-700/20 blur-3xl motion-safe:animate-pulse [animation-duration:4s]" />

      {/* Mascota: solo en pantallas anchas, donde no compite con el formulario */}
      <Image
        src="/mascota.svg"
        alt=""
        aria-hidden
        width={400}
        height={400}
        unoptimized
        className="pointer-events-none absolute -right-24 top-1/2 hidden w-80 -translate-y-1/2 opacity-20 lg:block xl:right-4 xl:opacity-30"
      />

      <Link href="/" className="relative z-10 mb-8 flex items-center gap-2">
        <Image src="/logo-botforge.svg" alt="" width={32} height={32} unoptimized className="h-8 w-8" />
        <span className="font-mono text-xl font-bold text-white">BotForge</span>
      </Link>

      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}
