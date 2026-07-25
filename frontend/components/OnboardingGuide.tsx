'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Z } from '@/lib/z-index';

export const ONBOARDING_KEY = 'botforge_onboarding_done';

interface Step {
  title: string;
  desc: string;
  /** Selector data-onboarding del elemento a iluminar. Sin target: tooltip centrado. */
  target?: string;
}

const STEPS: Step[] = [
  {
    title: 'Creá tu primer bot',
    desc: 'Desde acá arrancás: nombre, idioma y personalidad en un minuto.',
    target: 'new-bot',
  },
  {
    title: 'Subí el instructivo',
    desc: 'Dentro de tu bot vas a ver el tab Instructivo para entrenarlo con IA. Aparece despues de crear el bot.',
  },
  {
    title: 'Conectá WhatsApp',
    desc: 'En el tab WhatsApp de tu bot vinculás tu número en 2 minutos. Aparece despues de crear el bot.',
  },
  {
    title: 'Probá el Asistente BotForge',
    desc: 'Tu copiloto para crear instructivos y resolver dudas, siempre en el sidebar.',
    target: 'assistant',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Props {
  open: boolean;
  onFinish: () => void;
}

/** Margen minimo que se respeta contra los bordes de la ventana */
const MARGIN = 16;
/** Separacion entre el recorte del spotlight y el tooltip */
const GAP = 18;
/** Ancho maximo en desktop; en pantallas angostas se achica solo */
const MAX_WIDTH = 320;
/** Padding del recorte del spotlight alrededor del elemento */
const PAD = 8;

export default function OnboardingGuide({ open, onFinish }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [resizeTick, setResizeTick] = useState(0);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = STEPS[stepIndex];

  // El portal necesita document; en SSR no existe
  useEffect(() => setMounted(true), []);

  const measure = useCallback(() => {
    if (!step?.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-onboarding="${step.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useEffect(() => {
    if (!open) {
      setStepIndex(0);
      return;
    }
    measure();
    // El tick fuerza recalcular la posicion aunque el rect no cambie
    // (por ejemplo en los pasos centrados, que no tienen target)
    const onResize = () => {
      measure();
      setResizeTick((t) => t + 1);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, measure]);

  // Al cambiar de paso se oculta hasta recalcular, para que no aparezca un
  // frame con el contenido nuevo en la posicion del paso anterior
  useEffect(() => {
    setPos(null);
  }, [stepIndex]);

  // Posicion definitiva: se calcula con el alto y ancho REALES ya renderizados
  // del tooltip, no con una estimacion, y se recorta contra el viewport en los
  // dos ejes. Asi nunca queda medio afuera de la ventana.
  useEffect(() => {
    if (!open || !step) return;
    const node = tooltipRef.current;
    if (!node) return;

    const { width, height } = node.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Nunca menos de MARGIN, y nunca mas alla del borde opuesto. El segundo
    // Math.max cubre el caso de un tooltip mas grande que la ventana.
    const clamp = (value: number, limit: number): number =>
      Math.min(Math.max(MARGIN, value), Math.max(MARGIN, limit));

    if (!rect) {
      setPos({
        top: clamp((vh - height) / 2, vh - height - MARGIN),
        left: clamp((vw - width) / 2, vw - width - MARGIN),
      });
      return;
    }

    // Debajo del target si entra completo; si no, arriba
    const belowTop = rect.top + rect.height + GAP;
    const fitsBelow = belowTop + height + MARGIN <= vh;
    const rawTop = fitsBelow ? belowTop : rect.top - GAP - height;

    setPos({
      top: clamp(rawTop, vh - height - MARGIN),
      left: clamp(rect.left, vw - width - MARGIN),
    });
  }, [open, step, rect, stepIndex, resizeTick]);

  function finish() {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // localStorage no disponible, se mostrara de nuevo la proxima vez
    }
    onFinish();
  }

  function next() {
    if (stepIndex + 1 >= STEPS.length) {
      finish();
    } else {
      setStepIndex(stepIndex + 1);
    }
  }

  if (!mounted || !open || !step) return null;

  const hasSpotlight = rect !== null;

  // Portal al body: dentro de <main class="relative z-10"> el z-index de este
  // overlay quedaba encerrado en ese stacking context y el sidebar (z 40 en la
  // raiz) le pasaba por encima, tapando medio tooltip.
  return createPortal(
    <div style={{ zIndex: Z.toast }} className="fixed inset-0">
      {/* Overlay + spotlight: el box-shadow gigante oscurece todo menos el recorte */}
      {hasSpotlight && rect ? (
        <div
          className="pointer-events-none fixed rounded-xl transition-all duration-300"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.72)',
            border: '2px solid rgba(34, 211, 238, 0.6)',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.72)]" />
      )}

      {/* Tooltip: posicionamiento y ancho en el div externo, animacion en el
          interno (la animacion toca transform y pisaria el posicionamiento) */}
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          // Se achica solo en pantallas angostas en vez de desbordar
          width: `min(${MAX_WIDTH}px, calc(100vw - ${MARGIN * 2}px))`,
          // Oculto hasta tener la posicion medida, para no mostrarlo saltando
          visibility: pos ? 'visible' : 'hidden',
        }}
      >
        <div
          key={stepIndex}
          className="rounded-xl border border-cyan-400/30 bg-[#111120] p-4 shadow-2xl motion-safe:animate-[fade-in-up_0.3s_ease]"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-400">
            {stepIndex + 1} de {STEPS.length}
          </p>
          <p className="mt-1 break-words text-sm font-semibold text-[#E8E8F0]">{step.title}</p>
          <p className="mt-1 break-words text-xs leading-relaxed text-[#6E6E8E]">{step.desc}</p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={finish}
              className="shrink-0 text-xs text-[#6E6E8E] transition-colors hover:text-gray-300"
            >
              Saltar guía
            </button>
            <button
              type="button"
              onClick={next}
              className="shrink-0 rounded-lg bg-[#7C3AED] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
            >
              {stepIndex + 1 === STEPS.length ? 'Entendido' : 'Siguiente'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
