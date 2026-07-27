'use client';

import { Settings, Power, FileText, HardDrive, Bell, LifeBuoy } from 'lucide-react';

export interface UIComponent {
  kind: 'config_change' | 'instructivo_preview' | 'bot_status' | 'drive_status' | 'notification_config' | 'support_ticket';
  title: string;
  description: string;
  data: Record<string, unknown>;
  isActive: boolean;
  actionLabel: string;
  undoLabel: string;
  undoPayload?: Record<string, unknown>;
  applyPayload?: Record<string, unknown>;
  /** true cuando la accion ya no puede re-aplicarse (ej: documento borrado) */
  disabled?: boolean;
}

interface Props {
  component: UIComponent;
  onToggle: () => void;
}

// Ícono según el tipo de acción ejecutada
function DynamicIcon({ kind }: { kind: UIComponent['kind'] }) {
  const Icon = {
    config_change: Settings,
    bot_status: Power,
    instructivo_preview: FileText,
    drive_status: HardDrive,
    notification_config: Bell,
    support_ticket: LifeBuoy,
  }[kind] ?? Settings;
  return <Icon className="h-4 w-4 text-cyan-400" />;
}

export default function GenerativeUICard({ component, onToggle }: Props) {
  return (
    <div className="w-full max-w-[340px] overflow-hidden rounded-2xl border border-cyan-500/30 bg-[#0A0A1A]">
      {/* Header estilo terminal */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#111128] px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-red-500/80" />
        <span className="h-2 w-2 rounded-full bg-yellow-500/80" />
        <span className="h-2 w-2 rounded-full bg-green-500/80" />
        <span className="ml-1 font-mono text-[10px] text-cyan-400/60">botforge.execute()</span>
        <span className="ml-auto flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          <span className="font-mono text-[9px] font-semibold tracking-wider text-emerald-400">LIVE</span>
        </span>
      </div>

      {/* Cuerpo */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
            <DynamicIcon kind={component.kind} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">{component.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-white/50">{component.description}</p>
          </div>
        </div>

        {/* El ref del ticket es el dato que el usuario tiene que retener:
            va destacado en vez de perdido entre las demás claves */}
        {component.kind === 'support_ticket' && typeof component.data.ref === 'string' && (
          <div className="mt-3 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-3 py-2.5 text-center">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-cyan-400/70">
              Número de tu consulta
            </p>
            <p className="font-mono text-xl font-bold tracking-widest text-cyan-300">
              {component.data.ref}
            </p>
          </div>
        )}

        {/* Preview de datos en formato codigo */}
        <div className="mt-3 rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed">
          {Object.entries(component.data).map(([key, value]) => (
            <div key={key} className="break-all">
              <span className="text-violet-400">{key}</span>
              <span className="text-white/30">: </span>
              <span className="text-emerald-300">{String(value)}</span>
            </div>
          ))}
        </div>

        {/* Toggle */}
        <div className="mt-3 flex items-center justify-between">
          <span className={`text-xs ${component.isActive ? 'text-white/70' : 'text-white/35'}`}>
            {component.isActive ? component.actionLabel : component.undoLabel}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={component.isActive}
            aria-label={component.isActive ? component.undoLabel : component.actionLabel}
            disabled={component.disabled}
            onClick={onToggle}
            className={`relative h-5 w-10 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
              component.isActive ? 'bg-cyan-500' : 'bg-white/20'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200 ${
                component.isActive ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
              style={{ willChange: 'transform' }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
