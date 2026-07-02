import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Términos de servicio — BotForge',
};

export default function TerminosPage() {
  return (
    <article className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Términos de servicio</h1>
        <p className="mt-2 text-sm text-gray-500">Última actualización: julio de 2026</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Quiénes somos</h2>
        <p className="leading-relaxed text-gray-700">
          BotForge es una plataforma de software como servicio operada desde la República del
          Paraguay. Al crear una cuenta o utilizar cualquiera de nuestros servicios, aceptás estos
          términos en su totalidad. Si no estás de acuerdo con alguna parte, no utilices el
          servicio.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. Qué ofrece el servicio</h2>
        <p className="leading-relaxed text-gray-700">
          BotForge permite crear asistentes conversacionales (chatbots) impulsados por
          inteligencia artificial, entrenarlos con documentos e información del negocio del
          usuario, y conectarlos a canales de mensajería como WhatsApp y chat web. El servicio
          incluye un panel de administración, procesamiento de documentos, historial de
          conversaciones y estadísticas de uso.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. Obligaciones del usuario</h2>
        <p className="leading-relaxed text-gray-700">
          Te comprometés a usar el servicio únicamente para fines lícitos. Está expresamente
          prohibido: enviar spam o mensajes masivos no solicitados; usar los bots para difundir
          contenido ilegal, fraudulento, difamatorio o que infrinja derechos de terceros; hacerse
          pasar por otra persona o entidad; e intentar vulnerar la seguridad de la plataforma.
          Sos responsable de contar con los derechos sobre los documentos e información que subís
          y de cumplir las políticas de los canales que conectás, incluyendo las políticas de
          WhatsApp Business.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Limitación de responsabilidad</h2>
        <p className="leading-relaxed text-gray-700">
          Los bots generan respuestas mediante inteligencia artificial y pueden cometer errores,
          imprecisiones u omisiones. El negocio que configura el bot es el único responsable de
          verificar la exactitud de las respuestas que su bot entrega a sus clientes, así como de
          las consecuencias comerciales de dichas respuestas. BotForge no garantiza disponibilidad
          ininterrumpida del servicio y no se hace responsable por lucro cesante, pérdida de datos
          ocasionada por terceros ni daños indirectos derivados del uso de la plataforma.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Planes y pagos</h2>
        <p className="leading-relaxed text-gray-700">
          Los precios se publican en guaraníes (Gs.) y pueden cobrarse en dólares
          estadounidenses según el medio de pago. Los planes pagos se renuevan mensualmente.
          Podés cancelar tu suscripción en cualquier momento y sin penalidad; la cancelación
          hace efecto al final del período ya abonado. Los límites de cada plan (cantidad de
          bots, documentos y mensajes mensuales) se detallan en la página de planes y pueden
          actualizarse con previo aviso.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. Datos y privacidad</h2>
        <p className="leading-relaxed text-gray-700">
          El tratamiento de tus datos personales y de la información que subís a la plataforma se
          rige por nuestra{' '}
          <a href="/privacidad" className="text-violet-600 hover:underline">
            Política de privacidad
          </a>
          , que forma parte integrante de estos términos.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">7. Ley aplicable</h2>
        <p className="leading-relaxed text-gray-700">
          Estos términos se rigen por las leyes de la República del Paraguay. Cualquier
          controversia derivada del uso del servicio se someterá a los tribunales ordinarios de
          la ciudad de Asunción.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">8. Contacto</h2>
        <p className="leading-relaxed text-gray-700">
          Ante cualquier consulta sobre estos términos, escribinos a{' '}
          <a href="mailto:hola@botforge.com.py" className="text-violet-600 hover:underline">
            hola@botforge.com.py
          </a>
          .
        </p>
      </section>
    </article>
  );
}
