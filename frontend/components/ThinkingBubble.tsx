'use client';

import { useEffect, useState } from 'react';

/**
 * Indicador de pensamiento reutilizable: tres puntos bounce + mensaje
 * rotativo con fade. Cada agente pasa su propio array de mensajes
 * (PLATFORM_THINKING en DashboardAssistant, TENANT_THINKING en ChatWidget).
 */
interface Props {
  messages: string[];
  /** true en superficies claras (widget con tema del bot) */
  light?: boolean;
}

const ROTATE_MS = 1800;
const FADE_MS = 250;

export default function ThinkingBubble({ messages, light = false }: Props) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      const swap = setTimeout(() => {
        setIdx((i) => (i + 1) % messages.length);
        setVisible(true);
      }, FADE_MS);
      return () => clearTimeout(swap);
    }, ROTATE_MS);
    return () => clearInterval(interval);
  }, [messages.length]);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className={`h-2 w-2 animate-bounce rounded-full ${light ? 'bg-primary/50' : 'bg-cyan-400/50'}`}
            style={{ animationDelay: `${d * 160}ms` }}
          />
        ))}
      </div>
      <span
        className={`text-xs transition-opacity duration-[400ms] ${visible ? 'opacity-100' : 'opacity-0'} ${
          light ? 'text-muted-foreground' : 'text-white/50'
        }`}
      >
        {messages[idx]}
      </span>
    </div>
  );
}
