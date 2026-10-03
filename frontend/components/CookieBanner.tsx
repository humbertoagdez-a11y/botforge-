'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Cookie } from 'lucide-react';
import { useCookieConsentStore } from '@/lib/store';
import { Z } from '@/lib/z-index';
import { cn } from '@/lib/utils';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type EventoBanner = 'mostrado' | 'todas' | 'necesarias' | 'ignorado';
/** Lo que se compara en el A/B. */
type Variante = 'actual' | 'nueva';

interface Contexto {
  conAnuncio: boolean;
  dispositivo: 'movil' | 'escritorio';
  variante: Variante;
}

/**
 * Suma uno al contador anonimo del banner.
 *
 * Sin identificadores de ningun tipo: el evento y tres etiquetas gruesas
 * (llego desde un anuncio si/no, celular o escritorio, que diseño vio). El
 * fbclid no viaja. Va por sendBeacon para no frenar nada y para que llegue
 * aunque la persona cierre la pestaña.
 */
function contar(evento: EventoBanner, ctx: Contexto, rapida?: boolean): void {
  try {
    const cuerpo = JSON.stringify({ evento, ...ctx, rapida });
    if (!navigator.sendBeacon?.(`${API}/api/v1/consentimiento`, cuerpo)) {
      void fetch(`${API}/api/v1/consentimiento`, { method: 'POST', body: cuerpo, keepalive: true });
    }
  } catch {
    // Un contador no puede romper el banner
  }
}

/**
 * Que diseño mostrar, y si la vista cuenta.
 *
 * ?banner=actual|nueva fuerza un diseño para revisarlo o capturarlo, y esas
 * vistas NO se cuentan.
 *
 * Fuera de eso, A/B 50/50 desde el 2026-10-03: se sortea en cada carga
 * completa de pagina, sin guardar nada (guardar la variante antes de que la
 * persona elija ya seria almacenar sin consentimiento). Al navegar dentro del
 * sitio el banner no se desmonta, asi que la variante no cambia en la visita;
 * solo una recarga vuelve a sortear. El resultado: npm run consentimiento:ab.
 *
 * En celular se probo tambien una hoja inferior con titulo y botones apilados:
 * 180 px de alto en 375, tapaba el precio y el link a planes. Se descarto.
 */
function elegirDiseno(): { diseno: Variante; cuenta: boolean } {
  const forzado = new URLSearchParams(window.location.search).get('banner');
  if (forzado === 'actual' || forzado === 'nueva') return { diseno: forzado, cuenta: false };
  return { diseno: Math.random() < 0.5 ? 'actual' : 'nueva', cuenta: true };
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
 * Reglas del diseño nuevo (2026-10-03), que el A/B no puede romper: los dos
 * botones del mismo tamaño y peso, 44 px de alto, rechazar igual de visible
 * que aceptar, sin overlay, sin bloquear el scroll, sin desaparecer solo.
 *
 * La preferencia se guarda con el mismo zustand + persist que usa la sesión.
 */
export default function CookieBanner() {
  const { choice, accept } = useCookieConsentStore();
  const [montado, setMontado] = useState(false);
  const [vista, setVista] = useState<{ diseno: Variante; cuenta: boolean }>({ diseno: 'actual', cuenta: false });
  const ctx = useRef<Contexto | null>(null);
  const caja = useRef<HTMLDivElement>(null);

  // zustand rehidrata desde localStorage en el cliente: sin esta guarda el
  // banner parpadearía en cada carga para quien ya eligió
  useEffect(() => {
    const v = elegirDiseno();
    setVista(v);
    // Se fija al aparecer: si se calculaba al elegir, quien cambiaba de pagina
    // antes ya no tenia el fbclid en la URL y contaba como visita directa
    ctx.current = {
      conAnuncio: /[?&](fbclid|utm_source=(facebook|fb|ig|instagram|meta))\b/i.test(window.location.search),
      dispositivo: window.innerWidth < 768 ? 'movil' : 'escritorio',
      variante: v.diseno,
    };
    setMontado(true);
  }, []);

  const visible = montado && choice === null;
  const aparecioEn = useRef(0);
  const ignorado = useRef(false);
  const pathname = usePathname();
  const pathInicial = useRef(pathname);

  const contarSi = (evento: EventoBanner, rapida?: boolean) => {
    if (vista.cuenta && ctx.current) contar(evento, ctx.current, rapida);
  };

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
    if (desdeAfuera) contarSi('mostrado');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // "Ignorado": siguio usando el sitio con el banner abierto. Una vez por visita.
  const marcarIgnorado = () => {
    if (ignorado.current) return;
    ignorado.current = true;
    contarSi('ignorado');
  };
  useEffect(() => {
    if (visible && pathname !== pathInicial.current) marcarIgnorado();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, pathname]);
  useEffect(() => {
    if (!visible) return;
    const alScrollear = () => {
      if (window.scrollY > window.innerHeight) marcarIgnorado();
    };
    window.addEventListener('scroll', alScrollear, { passive: true });
    return () => window.removeEventListener('scroll', alScrollear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Diseño nuevo: la pagina reserva abajo el alto del banner, asi el final de
  // cualquier pagina (footer, ultimo boton) se puede scrollear hasta quedar
  // por encima y nada queda tapado para siempre.
  useEffect(() => {
    if (!visible || vista.diseno === 'actual' || !caja.current) return;
    const el = caja.current;
    const ajustar = () => {
      document.body.style.paddingBottom = `${el.offsetHeight}px`;
    };
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.body.style.paddingBottom = '';
    };
  }, [visible, vista.diseno]);

  function elegir(c: 'necessary' | 'all') {
    const rapida = aparecioEn.current > 0 && performance.now() - aparecioEn.current < 1000;
    contarSi(c === 'all' ? 'todas' : 'necesarias', rapida);
    accept(c);
  }

  if (!visible) return null;

  if (vista.diseno === 'actual') {
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

  // ── Diseño nuevo ────────────────────────────────────────────────────────
  // Los dos botones comparten TODO salvo el relleno: tamaño, peso, alto
  // (h-11 = 44 px) y anillo de foco. "Solo las necesarias" va con borde
  // blanco y texto blanco, no gris: se lee igual que "Aceptar".
  const boton =
    'h-11 min-w-0 flex-1 rounded-lg px-3 text-sm font-semibold text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 md:w-48 md:flex-none';
  // En celular es una franja de borde a borde de 2 lineas + botones (~114 px):
  // en 375 x 667 no llega a tapar ni el boton principal ni el precio.
  return (
    <div
      ref={caja}
      style={{ zIndex: Z.toast }}
      className="fixed inset-x-0 bottom-0 md:p-4"
      role="region"
      aria-label="Consentimiento de cookies"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-2.5 border-t border-white/15 bg-[#13131F] px-4 pb-3 pt-3 shadow-2xl shadow-black/60 md:flex-row md:items-center md:gap-6 md:rounded-2xl md:border md:p-4">
        <p id="cookies-texto" className="min-w-0 flex-1 text-[13px] leading-snug text-[#E4E4EE]">
          Con «Aceptar», Meta mide si nuestros anuncios sirven. No mide tu uso del panel ni a tus clientes.{' '}
          <Link
            href="/cookies"
            className="whitespace-nowrap text-cyan-300 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            Detalle
          </Link>
        </p>

        <div className="flex shrink-0 gap-2" aria-describedby="cookies-texto">
          <button
            type="button"
            onClick={() => elegir('necessary')}
            className={cn(boton, 'border border-white/60 bg-transparent hover:bg-white/10')}
          >
            Solo las necesarias
          </button>
          <button
            type="button"
            onClick={() => elegir('all')}
            className={cn(boton, 'border border-violet-600 bg-violet-600 hover:bg-violet-500')}
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
