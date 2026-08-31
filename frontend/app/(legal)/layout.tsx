import Link from 'next/link';
import Image from 'next/image';

/**
 * Layout de las páginas legales. Públicas a propósito: Google revisa la
 * política de privacidad sin tener cuenta para verificar el acceso a Drive.
 *
 * Mismo fondo oscuro del sitio, pero con ancho de lectura acotado y texto
 * grande: acá lo que importa es que se entienda.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#0A0A0F]">
      <header className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#0A0A0F]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[720px] items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo-botforge.svg" alt="" width={28} height={28} unoptimized className="h-7 w-7" />
            <span className="font-mono font-bold text-white">BotForge</span>
          </Link>
          <Link href="/" className="text-sm text-cyan-400 transition-colors hover:text-cyan-300">
            Volver al sitio
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-5 py-10 sm:py-14">{children}</main>

      <footer className="border-t border-white/[0.08] py-6">
        <div className="mx-auto flex max-w-[720px] flex-col gap-2 px-5 text-xs text-[#6E6E8E] sm:flex-row sm:items-center sm:justify-between">
          <span>BotForge · Hecho en Paraguay</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/terminos" className="hover:text-gray-300">Términos</Link>
            <Link href="/privacidad" className="hover:text-gray-300">Privacidad</Link>
            <Link href="/cookies" className="hover:text-gray-300">Cookies</Link>
            <Link href="/eliminar-datos" className="hover:text-gray-300">Eliminar datos</Link>
            <a href="mailto:humbertoagdez@gmail.com" className="hover:text-gray-300">Contacto</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
