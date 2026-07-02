import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de privacidad — BotForge',
};

export default function PrivacidadPage() {
  return (
    <article className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Política de privacidad</h1>
        <p className="mt-2 text-sm text-gray-500">Última actualización: julio de 2026</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Qué datos recopilamos</h2>
        <p className="leading-relaxed text-gray-700">
          Al usar BotForge recopilamos: los datos de tu cuenta (nombre y dirección de email); los
          documentos que subís para entrenar tus bots (menús, catálogos, instructivos y similares);
          las conversaciones que tus bots mantienen con tus clientes por chat web y WhatsApp,
          incluyendo los números de teléfono desde los que escriben; y datos técnicos de uso de la
          plataforma necesarios para operar el servicio.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. Para qué los usamos</h2>
        <p className="leading-relaxed text-gray-700">
          Usamos tus datos exclusivamente para proveer el servicio: entrenar y operar tus bots,
          mostrar el historial de conversaciones y estadísticas en tu panel, aplicar los límites
          de tu plan, enviarte comunicaciones operativas sobre tu cuenta, y mejorar la plataforma.
          No vendemos tus datos ni los de tus clientes a terceros.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. Dónde se almacenan</h2>
        <p className="leading-relaxed text-gray-700">
          La información se almacena en servidores ubicados en Estados Unidos, provistos por
          Railway como infraestructura de hosting. Aplicamos medidas de seguridad estándar de la
          industria: contraseñas almacenadas con hash criptográfico, comunicaciones cifradas por
          HTTPS y acceso restringido a los datos.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Terceros que procesan datos</h2>
        <p className="leading-relaxed text-gray-700">
          Para operar el servicio compartimos datos con proveedores específicos: Anthropic
          (procesamiento de lenguaje con IA para generar las respuestas de los bots), Twilio
          (envío y recepción de mensajes de WhatsApp) y Pinecone (almacenamiento de
          representaciones vectoriales de tus documentos para búsqueda semántica). Cada proveedor
          procesa solo los datos necesarios para su función y bajo sus propias políticas de
          privacidad y seguridad.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Tus derechos</h2>
        <p className="leading-relaxed text-gray-700">
          Podés acceder, corregir o eliminar tus datos en cualquier momento. Desde el panel podés
          eliminar bots, documentos y conversaciones; al eliminar un bot se eliminan también sus
          documentos y conversaciones asociadas. Si querés eliminar tu cuenta completa con todos
          sus datos, escribinos y lo procesamos dentro de los 30 días.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. Contacto</h2>
        <p className="leading-relaxed text-gray-700">
          Ante cualquier consulta sobre esta política o sobre tus datos, escribinos a{' '}
          <a href="mailto:hola@botforge.com.py" className="text-violet-600 hover:underline">
            hola@botforge.com.py
          </a>
          .
        </p>
      </section>
    </article>
  );
}
