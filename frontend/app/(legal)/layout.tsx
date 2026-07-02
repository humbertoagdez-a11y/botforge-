import Link from 'next/link';
import Image from 'next/image';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo-botforge.svg" alt="" width={28} height={28} unoptimized className="h-7 w-7" />
            <span className="font-bold">BotForge</span>
          </Link>
          <Link href="/" className="text-sm text-violet-600 hover:underline">
            Volver
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>

      <footer className="border-t py-6">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 text-xs text-gray-500">
          <span>2026 BotForge · Desarrollado en Paraguay</span>
          <div className="flex gap-4">
            <Link href="/terminos" className="hover:text-gray-700">Términos</Link>
            <Link href="/privacidad" className="hover:text-gray-700">Privacidad</Link>
            <a href="mailto:hola@botforge.com.py" className="hover:text-gray-700">Contacto</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
