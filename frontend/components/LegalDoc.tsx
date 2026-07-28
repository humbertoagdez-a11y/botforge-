import Link from 'next/link';
import type { ReactNode } from 'react';

export interface LegalSection {
  /** Ancla de la sección: permite linkear a /privacidad#datos */
  id: string;
  title: string;
  content: ReactNode;
}

/**
 * Estructura común de las páginas legales: título, fecha, índice con anclas y
 * secciones numeradas. Ancho de lectura acotado y texto grande, porque son
 * páginas para leer, no para mirar.
 */
export default function LegalDoc({
  title,
  intro,
  updated,
  sections,
}: {
  title: string;
  intro: string;
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <article className="pb-10">
      <h1 className="font-mono text-3xl font-bold leading-tight text-white sm:text-4xl">{title}</h1>
      <p className="mt-3 text-base leading-relaxed text-[#B8B8CC]">{intro}</p>
      <p className="mt-3 text-sm text-[#6E6E8E]">Última actualización: {updated}</p>

      {/* Índice */}
      <nav aria-label="Contenidos" className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-cyan-400">
          Contenidos
        </p>
        <ol className="mt-3 space-y-1.5">
          {sections.map((s, i) => (
            <li key={s.id} className="text-[15px] leading-relaxed">
              <a
                href={`#${s.id}`}
                className="text-[#B8B8CC] underline-offset-4 transition-colors hover:text-cyan-400 hover:underline"
              >
                <span className="mr-1.5 font-mono text-[#6E6E8E]">{i + 1}.</span>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-10">
        {sections.map((s, i) => (
          // scroll-mt deja aire arriba al saltar por ancla
          <section key={s.id} id={s.id} className="scroll-mt-20">
            <h2 className="font-mono text-xl font-bold leading-snug text-white sm:text-2xl">
              <span className="mr-2 text-cyan-400">{i + 1}.</span>
              {s.title}
            </h2>
            <div className="mt-3 space-y-3 text-[17px] leading-[1.75] text-[#B8B8CC]">
              {s.content}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-12 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-[15px] leading-relaxed text-[#B8B8CC]">
          ¿Alguna duda sobre este documento? Escribinos a{' '}
          <a
            href="mailto:humbertoagdez@gmail.com"
            className="text-cyan-400 underline-offset-2 hover:underline"
          >
            humbertoagdez@gmail.com
          </a>
          .
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/privacidad" className="text-[#6E6E8E] hover:text-cyan-400">Privacidad</Link>
          <Link href="/terminos" className="text-[#6E6E8E] hover:text-cyan-400">Términos</Link>
          <Link href="/cookies" className="text-[#6E6E8E] hover:text-cyan-400">Cookies</Link>
        </div>
      </div>
    </article>
  );
}

/** Lista con viñetas, con el espaciado del resto del documento */
export function L({ children }: { children: ReactNode }) {
  return <ul className="ml-1 mt-2 space-y-2 border-l border-white/10 pl-4">{children}</ul>;
}

/** Ítem de lista */
export function Li({ children }: { children: ReactNode }) {
  return <li className="text-[16px] leading-[1.7]">{children}</li>;
}

/** Resalta un término dentro del texto corrido */
export function T({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-[#E8E8F0]">{children}</strong>;
}
