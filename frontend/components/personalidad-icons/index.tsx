// Iconos SVG por personalidad — linea fina bicolor (violeta + cian),
// sin relleno solido, strokeWidth 1.5, rounded caps. 48x48.

interface IconProps {
  className?: string;
}

const VIOLET = '#7C3AED';
const CYAN = '#22D3EE';

const base = {
  fill: 'none',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function VendedorIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...base} aria-hidden>
      {/* Persona con auricular */}
      <circle cx="18" cy="15" r="6" stroke={VIOLET} />
      <path d="M8 38 c0-7 4.5-11 10-11 s10 4 10 11" stroke={VIOLET} />
      <path d="M12 14 a6.5 6.5 0 0 1 12 0" stroke={VIOLET} />
      <rect x="22.6" y="13.4" width="3" height="5" rx="1.5" stroke={VIOLET} />
      <path d="M24 18.5 v1.5 q0 2 -3 2" stroke={VIOLET} />
      {/* Grafico de tendencia con flecha */}
      <path d="M28 32 l5 -6 l4 3 l7 -9" stroke={CYAN} />
      <path d="M40 20 h4 v4" stroke={CYAN} />
    </svg>
  );
}

export function RestauranteIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...base} aria-hidden>
      {/* Vapor */}
      <path d="M20 6 q-1.5 2 0 4" stroke={CYAN} />
      <path d="M24 5 q-1.5 2 0 4" stroke={CYAN} />
      <path d="M28 6 q-1.5 2 0 4" stroke={CYAN} />
      {/* Cloche */}
      <path d="M10 26 a14 14 0 0 1 28 0" stroke={VIOLET} />
      <line x1="7" y1="26" x2="41" y2="26" stroke={VIOLET} />
      <circle cx="24" cy="12" r="1.4" stroke={VIOLET} />
      {/* Cubiertos cruzados a 45 grados */}
      <path d="M17 32 l10 10" stroke={VIOLET} />
      <path d="M15.5 33.5 q-2 -2 -0.5 -4 l2.5 2.5" stroke={VIOLET} />
      <path d="M31 32 l-10 10" stroke={CYAN} />
      <path d="M32.5 33.5 l1.5 -1.5 M30 31 l1.5 -1.5 M34 35 q1.5 1.5 0 3 l-2.5 -2" stroke={CYAN} />
    </svg>
  );
}

export function SaludIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...base} aria-hidden>
      {/* Cruz medica */}
      <path
        d="M19 8 h10 v8 h8 v10 h-8 v8 h-10 v-8 h-8 v-10 h8 Z"
        stroke={VIOLET}
      />
      {/* Pulso ECG atravesando */}
      <path d="M4 24 h8 l3 -6 l4 12 l3 -9 l2 3 h20" stroke={CYAN} />
    </svg>
  );
}

export function TiendaIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...base} aria-hidden>
      {/* Bolsa con asa */}
      <path d="M11 16 h26 l-2.5 24 h-21 Z" stroke={VIOLET} />
      <path d="M18 16 v-3 a6 6 0 0 1 12 0 v3" stroke={VIOLET} />
      {/* Etiqueta de precio con check */}
      <path d="M19 25 h7 l4 4 l-7 7 l-4 -4 Z" stroke={CYAN} transform="rotate(-8 24 30)" />
      <path d="M21.5 29 l2 2 l3.5 -3.5" stroke={CYAN} />
      {/* Brillos */}
      <path d="M33 21 l1.5 -1.5 M34 26 h2" stroke={CYAN} />
    </svg>
  );
}

export function TurnosIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...base} aria-hidden>
      {/* Calendario */}
      <rect x="7" y="11" width="28" height="28" rx="3" stroke={VIOLET} />
      <line x1="7" y1="19" x2="35" y2="19" stroke={VIOLET} />
      <line x1="14" y1="8" x2="14" y2="14" stroke={VIOLET} />
      <line x1="28" y1="8" x2="28" y2="14" stroke={VIOLET} />
      {/* Grilla de dias */}
      <path d="M13 25 h3 M20 25 h3 M27 25 h3 M13 32 h3 M27 32 h3" stroke={VIOLET} opacity="0.55" />
      {/* Check en un dia */}
      <path d="M19.5 31.5 l2 2 l3.5 -3.5" stroke={CYAN} />
      {/* Reloj en la esquina */}
      <circle cx="38" cy="12" r="6" stroke={CYAN} />
      <path d="M38 9.5 v2.8 l2 1.5" stroke={CYAN} />
    </svg>
  );
}

export function InmobiliariaIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...base} aria-hidden>
      {/* Casa */}
      <path d="M10 26 L24 15 L38 26" stroke={VIOLET} />
      <path d="M13 24.5 V40 h22 V24.5" stroke={VIOLET} />
      <rect x="21" y="31" width="6" height="9" stroke={VIOLET} />
      <rect x="29.5" y="28" width="4.5" height="4.5" stroke={VIOLET} />
      {/* Pin GPS arriba */}
      <path d="M24 3 a4.5 4.5 0 0 1 4.5 4.5 c0 3 -4.5 7 -4.5 7 s-4.5 -4 -4.5 -7 A4.5 4.5 0 0 1 24 3 Z" stroke={CYAN} />
      <circle cx="24" cy="7.5" r="1.4" stroke={CYAN} />
    </svg>
  );
}

export function SoporteIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...base} aria-hidden>
      {/* Headset */}
      <path d="M10 24 a14 14 0 0 1 28 0" stroke={VIOLET} />
      <rect x="8" y="22" width="5" height="9" rx="2.5" stroke={VIOLET} />
      <rect x="35" y="22" width="5" height="9" rx="2.5" stroke={VIOLET} />
      <path d="M37.5 31 v2 q0 4 -6 4 h-3" stroke={VIOLET} />
      <rect x="25" y="35.5" width="4" height="3" rx="1.5" stroke={VIOLET} />
      {/* Onda de sonido */}
      <path d="M44 20 q2 4 0 8" stroke={CYAN} />
      {/* Barras de señal */}
      <path d="M10 42 v-2 M15 42 v-4 M20 42 v-6" stroke={CYAN} />
    </svg>
  );
}

export function EducativoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...base} aria-hidden>
      {/* Libro abierto */}
      <path d="M24 20 c-3 -3 -8 -4 -14 -3.5 V38 c6 -0.5 11 0.5 14 3 c3 -2.5 8 -3.5 14 -3 V16.5 C32 16 27 17 24 20 Z" stroke={VIOLET} />
      <line x1="24" y1="20" x2="24" y2="41" stroke={VIOLET} />
      {/* Lineas de texto */}
      <path d="M14 23 c2.5 -0.3 4.5 -0.2 6.5 0.4 M14 28 c2.5 -0.3 4.5 -0.2 6.5 0.4 M14 33 c2.5 -0.3 4.5 -0.2 6.5 0.4" stroke={VIOLET} opacity="0.55" />
      <path d="M34 23 c-2.5 -0.3 -4.5 -0.2 -6.5 0.4 M34 28 c-2.5 -0.3 -4.5 -0.2 -6.5 0.4" stroke={VIOLET} opacity="0.55" />
      {/* Bombilla arriba */}
      <path d="M24 4 a4.5 4.5 0 0 1 2.5 8.2 v1.3 h-5 v-1.3 A4.5 4.5 0 0 1 24 4 Z" stroke={CYAN} />
      <path d="M22.5 15.5 h3" stroke={CYAN} />
    </svg>
  );
}
