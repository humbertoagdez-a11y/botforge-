'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Cookie } from 'lucide-react';
import { useCookieConsentStore } from '@/lib/store';
import { Z } from '@/lib/z-index';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Suma uno al contador anonimo del banner.
 *
 * Sin identificadores de ningun tipo: solo el evento y si la persona llego
 * desde un anuncio (un si/no, el fbclid no viaja). Va por sendBeacon para no
 * frenar nada y para que llegue aunque la persona cierre la pestaña.
 */
type EventoBanner = 'mostrado' | 'todas' | 'necesarias' | 'ignorado';

function contar(evento: EventoBanner, rapida?: boolean): void {
  try {
    const conAnuncio = /[?&](fbclid|utm_source=(facebook|fb|ig|instagram|meta))\b/i.test(window.location.search);
    // Etiqueta gruesa, no identifica a nadie: el mismo corte que usa el layout
    const dispositivo = window.innerWidth < 768 ? 'movil' : 'escritorio';
    const cuerpo = JSON.stringify({ evento, conAnuncio, dispositivo, variante: 'actual', rapida });
    if (!navigator.sendBeacon?.(`${API}/api/v1/consentimiento`, cuerpo)) {
      void fetch(`${API}/api/v1/consentimiento`, { method: 'POST', body: cuerpo, keepalive: true });
    }
  } catch {
    // Un contador no puede romper el banner
  }
}

/**
 * Banner de consentimiento.
 *
 * El texto dice lo que BotForge realmente hace. Hasta el 2026-10-02 decia "No
 * usamos cookies publicitarias ni de rastreo de terceros", y era falso: si la
 * persona tocaba Aceptar se cargaba el Pixel de Meta, que instala _fbp. La
 * pagina /cookies ya lo decia bien; el banner, que es lo unico que la mayoria
 * lee, no. Cualquier cambio en lo que se carga con Aceptar tiene que cambiar
 * este texto en el mismo commit.
 *
 * La preferencia se guarda con el mismo zustand + persist que usa la sesión.
 */
export default function CookieBanner() {
  const { choice, accept } = useCookieConsentStore();
  const [montado, setMontado] = useState(false);

  // zustand rehidrata desde localStorage en el cliente: sin esta guarda el
  // banner parpadearía en cada carga para quien ya eligió
  useEffect(() => setMontado(true), []);

  const visible = montado && choice === null;
  const aparecioEn = useRef(0);
  const ignorado = useRef(false);
  const pathname = usePathname();
  const pathInicial = useRef(pathname);

  useEffect(() => {
    if (!visible) return;
    aparecioEn.current = performance.now();
    // Una vez por visita: solo si se entro desde afuera del sitio. Sin esto
    // cada recarga contaba como un banner mas, y no hay forma de deduplicar
    // sin guardar algo en el navegador de quien todavia no eligio.
    let desdeAfuera = true;
    try {
      desdeAfuera = !document.referrer || new URL(document.referrer).origin !== location.origin;
    } catch {
      // referrer ilegible: se cuenta
    }
    if (desdeAfuera) contar('mostrado');
  }, [visible]);

  // "Ignorado": siguio usando el sitio con el banner abierto. Una vez por visita.
  const marcarIgnorado = useRef(() => {
    if (ignorado.current) return;
    ignorado.current = true;
    contar('ignorado');
  });
  useEffect(() => {
    if (visible && pathname !== pathInicial.current) marcarIgnorado.current();
  }, [visible, pathname]);
  useEffect(() => {
    if (!visible) return;
    const alScrollear = () => {
      if (window.scrollY > window.innerHeight) marcarIgnorado.current();
    };
    window.addEventListener('scroll', alScrollear, { passive: true });
    return () => window.removeEventListener('scroll', alScrollear);
  }, [visible]);

  function elegir(c: 'necessary' | 'all') {
    const rapida = aparecioEn.current > 0 && performance.now() - aparecioEn.current < 1000;
    contar(c === 'all' ? 'todas' : 'necesarias', rapida);
    accept(c);
  }

  if (!visible) return null;

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
          Usamos cookies necesarias para mantener tu sesión iniciada.{' '}
          <span className="text-[#8A8AA3]">
            Si tocás «Aceptar», también cargamos el Pixel de Meta para medir cuánta gente
            llega desde nuestros anuncios.
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
            onClick={() => elegir('necessary')}
            className="flex-1 rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-[#B8B8CC] transition-colors hover:bg-white/5 sm:flex-none"
          >
            Solo las necesarias
          </button>
          <button
            type="button"
            onClick={() => elegir('all')}
            className="flex-1 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 sm:flex-none"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
