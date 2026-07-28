'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cookie } from 'lucide-react';
import { useCookieConsentStore } from '@/lib/store';
import { Z } from '@/lib/z-index';

/**
 * Banner de consentimiento.
 *
 * El texto dice lo que BotForge realmente hace: no hay cookies publicitarias
 * ni de rastreo de terceros, solo las necesarias para mantener la sesión. Un
 * banner genérico que hablara de "personalizar anuncios" sería falso.
 *
 * La preferencia se guarda con el mismo zustand + persist que usa la sesión.
 */
export default function CookieBanner() {
  const { choice, accept } = useCookieConsentStore();
  const [montado, setMontado] = useState(false);

  // zustand rehidrata desde localStorage en el cliente: sin esta guarda el
  // banner parpadearía en cada carga para quien ya eligió
  useEffect(() => setMontado(true), []);

  if (!montado || choice !== null) return null;

  return (
    <div
      style={{ zIndex: Z.toast }}
      className="fixed inset-x-0 bottom-0 p-3 sm:p-4"
      role="region"
      aria-label="Consentimiento de cookies"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-white/10 bg-[#0F0F1A]/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl sm:flex-row sm:items-center sm:gap-4">
        <Cookie className="hidden h-5 w-5 shrink-0 text-cyan-400 sm:block" />

        <p className="min-w-0 flex-1 text-xs leading-relaxed text-[#B8B8CC]">
          Usamos solo las cookies necesarias para mantener tu sesión iniciada.{' '}
          <span className="text-[#8A8AA3]">
            No usamos cookies publicitarias ni de rastreo de terceros.
          </span>{' '}
          <Link href="/cookies" className="text-cyan-400 underline-offset-2 hover:underline">
            Más detalle
          </Link>
          {' · '}
          <Link href="/privacidad" className="text-cyan-400 underline-offset-2 hover:underline">
            Privacidad
          </Link>
        </p>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => accept('necessary')}
            className="flex-1 rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-[#B8B8CC] transition-colors hover:bg-white/5 sm:flex-none"
          >
            Solo las necesarias
          </button>
          <button
            type="button"
            onClick={() => accept('all')}
            className="flex-1 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 sm:flex-none"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
