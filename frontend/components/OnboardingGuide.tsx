'use client';

import { useCallback, useEffect, useState } from 'react';
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

export default function OnboardingGuide({ open, onFinish }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = STEPS[stepIndex];

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
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, measure]);

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

  if (!open || !step) return null;

  const PAD = 8;
  const hasSpotlight = rect !== null;

  // Posicion del tooltip: debajo del target si hay lugar, arriba si no; centrado sin target
  let tooltipStyle: React.CSSProperties;
  if (hasSpotlight && rect) {
    const below = rect.top + rect.height + PAD + 170 < window.innerHeight;
    tooltipStyle = {
      position: 'fixed',
      top: below ? rect.top + rect.height + PAD + 10 : undefined,
      bottom: below ? undefined : window.innerHeight - rect.top + PAD + 10,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - 336)),
    };
  } else {
    tooltipStyle = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  return (
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

      {/* Tooltip: posicionamiento en el div externo, animacion en el interno
          (la animacion toca transform y pisaria el translate de centrado) */}
      <div style={tooltipStyle} className="w-80">
      <div
        key={stepIndex}
        className="rounded-xl border border-cyan-400/30 bg-[#111120] p-4 shadow-2xl motion-safe:animate-[fade-in-up_0.3s_ease]"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-400">
          {stepIndex + 1} de {STEPS.length}
        </p>
        <p className="mt-1 text-sm font-semibold text-[#E8E8F0]">{step.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-[#6E6E8E]">{step.desc}</p>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="text-xs text-[#6E6E8E] transition-colors hover:text-gray-300"
          >
            Saltar guía
          </button>
          <button
            type="button"
            onClick={next}
            className="rounded-lg bg-[#7C3AED] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
          >
            {stepIndex + 1 === STEPS.length ? 'Entendido' : 'Siguiente'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
