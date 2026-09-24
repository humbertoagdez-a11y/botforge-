import type { Metadata } from 'next';
import Link from 'next/link';
import PlanesGrid from '@/components/PlanesGrid';
import { SitioFooter, SitioHeader } from '@/components/SitioChrome';

/**
 * Página de planes PÚBLICA.
 *
 * Antes la única página de precios completa vivía dentro del grupo (dashboard),
 * que redirige a login si no hay sesión: alguien que llegaba de una búsqueda o
 * de un link compartido para ver cuánto sale, se encontraba con un formulario
 * de ingreso. La versión del panel sigue existiendo en /pricing para quien ya
 * es cliente; las dos renderizan el mismo PlanesGrid.
 */

export const metadata: Metadata = {
  title: 'Planes y precios — BotForge',
  description:
    'Cuánto sale un chatbot de WhatsApp con IA para tu negocio en Paraguay. Precios en guaraníes, sin contrato, con un plan gratis para probar.',
};

/** Las objeciones reales antes de pagar, respondidas sin vueltas. */
const DUDAS: Array<{ p: string; r: string }> = [
  {
    p: '¿Qué pasa si me quedo sin mensajes a mitad de mes?',
    r: 'El bot avisa que llegó al límite y deja de responder hasta el mes siguiente. Te avisamos por email antes de que pase, y podés pasar a un plan más grande en el momento.',
  },
  {
    p: '¿Me atan a un contrato?',
    r: 'No. Cada pago cubre un mes. Si no pagás el siguiente, tu cuenta vuelve al plan Free sola. No hay débito automático ni permanencia.',
  },
  {
    p: '¿Necesito una línea nueva de teléfono?',
    r: 'Podés usar tu número actual de WhatsApp Business. Tené en cuenta que al conectarlo lo maneja el bot, así que no vas a poder usar ese mismo número en la app normal de WhatsApp al mismo tiempo. Si querés seguir usándolo a mano, conseguite una línea aparte para el bot.',
  },
  {
    p: '¿Cómo pago?',
    r: 'Con Pagopar, en guaraníes: tarjeta, transferencia, giro o efectivo en los puntos de pago. Te pedimos la cédula una sola vez porque Pagopar la necesita para el comprobante.',
  },
  {
    p: '¿Puedo probarlo antes?',
    r: 'Sí. El plan Free no pide tarjeta: creás tu bot, le cargás la información de tu negocio y lo probás en el chat del panel. WhatsApp empieza en el plan Básico.',
  },
];

export default function PlanesPublicosPage() {
  return (
    <main className="theme-dashboard min-h-screen bg-[#0A0A0F] font-sans antialiased">
      <SitioHeader />

      <section className="border-b border-white/5 px-4 py-14 sm:px-6 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-balance text-3xl font-bold leading-tight text-white sm:text-4xl">
            Lo que cuesta no contestar a tiempo
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-relaxed text-gray-300 sm:text-base">
            Un mozo, una recepcionista o un vendedor cuesta varios millones de guaraníes por mes.
            BotForge atiende los mensajes que hoy se te pasan, desde 150.000 al mes. Empezá gratis
            y pagá recién cuando conectes tu WhatsApp.
          </p>
        </div>
      </section>

      <section className="px-4 py-12 sm:px-6 md:py-16">
        <div className="mx-auto max-w-6xl">
          <PlanesGrid publica />
          <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-gray-500">
            Los precios están en guaraníes e incluyen todo. El cobro lo procesa Pagopar. Cada pago
            cubre un mes; todavía no hay débito automático, así que nada se te renueva sin que vos
            lo decidas.
          </p>
        </div>
      </section>

      <section className="border-t border-white/5 bg-[#0D0D12] px-4 py-14 sm:px-6 md:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Antes de pagar</h2>
          <dl className="mt-8 divide-y divide-white/5 border-t border-white/5">
            {DUDAS.map((d) => (
              <div key={d.p} className="py-5">
                <dt className="text-base font-semibold text-white">{d.p}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-gray-400">{d.r}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-sm text-gray-400">
            ¿Te quedó otra duda?{' '}
            <a
              href="mailto:humbertoagdez@gmail.com"
              className="font-medium text-violet-300 underline underline-offset-4 hover:text-violet-200"
            >
              Escribinos
            </a>{' '}
            o{' '}
            <Link
              href="/auth/register"
              className="font-medium text-violet-300 underline underline-offset-4 hover:text-violet-200"
            >
              creá tu cuenta gratis
            </Link>{' '}
            y probalo vos mismo.
          </p>
        </div>
      </section>

      <SitioFooter />
    </main>
  );
}
