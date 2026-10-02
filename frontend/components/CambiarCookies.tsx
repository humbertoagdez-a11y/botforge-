'use client';

import { useEffect, useState } from 'react';
import { useCookieConsentStore } from '@/lib/store';

/**
 * Cambiar la eleccion del banner de cookies.
 *
 * Retirar el consentimiento tiene que ser tan facil como darlo. Hasta ahora la
 * unica forma era borrar los datos del sitio desde el navegador.
 *
 * Al volver a "sin elegir" se borran tambien _fbc y _fbp, las dos cookies de
 * Meta, y el banner aparece de nuevo. El pixel que ya estaba cargado en esta
 * pestaña sigue en memoria hasta que se recargue, asi que se recarga.
 */
export default function CambiarCookies() {
  const choice = useCookieConsentStore((s) => s.choice);
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  function cambiar() {
    for (const nombre of ['_fbc', '_fbp']) {
      document.cookie = `${nombre}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      document.cookie = `${nombre}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${location.hostname.replace(/^www\./, '')}`;
    }
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith('bf_pixel_')) localStorage.removeItem(k);
      }
    } catch {
      // sin localStorage no hay nada que borrar
    }
    useCookieConsentStore.setState({ choice: null, decidedAt: null });
    location.reload();
  }

  const actual =
    !montado ? '…' : choice === 'all' ? 'Aceptaste todas' : choice === 'necessary' ? 'Solo las necesarias' : 'Todavía no elegiste';

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-sm">
        Tu elección actual: <strong>{actual}</strong>
      </p>
      <button
        type="button"
        onClick={cambiar}
        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/5"
      >
        Cambiar mi elección
      </button>
    </div>
  );
}
