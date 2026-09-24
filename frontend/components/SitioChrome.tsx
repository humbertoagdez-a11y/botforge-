'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Encabezado y pie del sitio público (landing y planes).
 *
 * Vivían dentro de `app/page.tsx` como funciones locales. Al sumar /planes
 * había que copiarlos o exportarlos; copiarlos garantizaba que en dos meses el
 * menú del sitio dijera cosas distintas según la página.
 *
 * `enLanding` cambia cómo se navega a las secciones, no qué dice el menú:
 * dentro de la landing son anclas que hacen scroll, fuera son links a `/#id`.
 * Sin esa distinción, en /planes los tres links del menú no hacían nada.
 */

interface Props {
  enLanding?: boolean;
}

const SECCIONES: Array<{ id: string; texto: string }> = [
  { id: 'como-funciona', texto: 'Caracteristicas' },
  { id: 'precios', texto: 'Precios' },
  { id: 'faq', texto: 'FAQ' },
];

function useIrASeccion(enLanding: boolean) {
  return useCallback(
    (id: string) => {
      if (enLanding) {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      window.location.href = `/#${id}`;
    },
    [enLanding],
  );
}

export function SitioHeader({ enLanding = false }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const irA = useIrASeccion(enLanding);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-300 ${
        scrolled ? 'border-b border-white/5 bg-black/80 backdrop-blur-lg' : 'bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="font-mono text-lg font-bold text-white">
          BotForge
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-gray-400 md:flex">
          {SECCIONES.map((s) => (
            <button key={s.id} onClick={() => irA(s.id)} className="transition-colors hover:text-white">
              {s.texto}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/auth/login"
            className="rounded-lg border border-white/20 px-3.5 py-1.5 text-sm text-white transition-colors hover:bg-white/10"
          >
            Ingresar
          </Link>
          <Link
            href="/auth/register"
            className="rounded-lg bg-violet-600 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-500"
          >
            Empezar gratis
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SitioFooter({ enLanding = false }: Props) {
  const irA = useIrASeccion(enLanding);

  return (
    <footer className="bg-[#070709] py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-center gap-6 text-center">
          <div>
            <p className="font-mono text-lg font-bold text-white">BotForge</p>
            <p className="mt-1 text-sm text-gray-500">Chatbots con IA para negocios paraguayos</p>
          </div>
          {/* py-1 en cada link: sin eso el area tactil era de 20px de alto,
              incomoda de acertar con el pulgar en un telefono */}
          <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-gray-500">
            {SECCIONES.map((s, i) => (
              <span key={s.id} className="flex items-center gap-3">
                {i > 0 && <span className="text-gray-700">|</span>}
                <button onClick={() => irA(s.id)} className="py-1 transition-colors hover:text-gray-300">
                  {s.texto}
                </button>
              </span>
            ))}
            <span className="text-gray-700">|</span>
            <Link href="/planes" className="py-1 transition-colors hover:text-gray-300">
              Planes
            </Link>
            <span className="text-gray-700">|</span>
            <a href="mailto:humbertoagdez@gmail.com" className="py-1 transition-colors hover:text-gray-300">
              Contacto
            </a>
            <span className="text-gray-700">|</span>
            <Link href="/terminos" className="py-1 transition-colors hover:text-gray-300">
              Términos
            </Link>
            <span className="text-gray-700">|</span>
            <Link href="/privacidad" className="py-1 transition-colors hover:text-gray-300">
              Privacidad
            </Link>
            <span className="text-gray-700">|</span>
            <Link href="/cookies" className="py-1 transition-colors hover:text-gray-300">
              Cookies
            </Link>
            <span className="text-gray-700">|</span>
            <Link href="/eliminar-datos" className="py-1 transition-colors hover:text-gray-300">
              Eliminar datos
            </Link>
          </nav>
        </div>
        <div className="mt-8 border-t border-white/5 pt-6 text-center">
          <p className="text-xs text-gray-600">2026 BotForge · Desarrollado en Paraguay</p>
          <a href="mailto:humbertoagdez@gmail.com" className="mt-1 inline-block text-xs text-gray-600 hover:text-gray-400">
            humbertoagdez@gmail.com
          </a>
        </div>
      </div>
    </footer>
  );
}
