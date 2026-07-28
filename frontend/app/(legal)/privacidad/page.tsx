import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDoc, { L, Li, T, type LegalSection } from '@/components/LegalDoc';

export const metadata: Metadata = {
  title: 'Política de privacidad',
  description:
    'Qué datos recolecta BotForge, para qué los usa, con quién los comparte y cómo ejercer tus derechos.',
};

const ACTUALIZADO = '26 de julio de 2026';

const SECCIONES: LegalSection[] = [
  {
    id: 'responsable',
    title: 'Quién es responsable de tus datos',
    content: (
      <>
        <p>
          BotForge es operado por <T>Humberto Fabrizio Arguello García de Zúñiga</T>, desde
          Paraguay. El sitio es <T>mibotforge.com</T>.
        </p>
        <p>
          Para cualquier consulta sobre tus datos, escribinos a{' '}
          <a href="mailto:humbertoagdez@gmail.com" className="text-cyan-400 underline-offset-2 hover:underline">
            humbertoagdez@gmail.com
          </a>
          . Respondemos por esa dirección todos los pedidos relacionados con esta política.
        </p>
      </>
    ),
  },
  {
    id: 'datos',
    title: 'Qué datos recolectamos',
    content: (
      <>
        <p>
          Hay tres grupos de datos bien distintos, y conviene entenderlos por separado porque
          nuestro rol frente a cada uno es diferente.
        </p>

        <p className="pt-2"><T>a) Datos tuyos, como titular de la cuenta</T></p>
        <L>
          <Li>Tu nombre y tu email.</Li>
          <Li>Tu contraseña, guardada siempre cifrada. Nunca la vemos en texto plano.</Li>
          <Li>
            Tu número de cédula o RUC, únicamente si hacés un pago: lo exige Pagopar para emitir el
            comprobante. Si nunca pagás, nunca te lo pedimos.
          </Li>
          <Li>El plan que tenés contratado y su fecha de vencimiento.</Li>
        </L>

        <p className="pt-2"><T>b) Datos de tu negocio</T></p>
        <L>
          <Li>Los documentos e instructivos que subís para entrenar a tus bots.</Li>
          <Li>El nombre, idioma, personalidad y configuración de cada bot.</Li>
          <Li>Si conectás Google Drive, los archivos de la carpeta que vos indiques. Más detalle en la sección 6.</Li>
        </L>

        <p className="pt-2"><T>c) Datos de los clientes finales que le escriben a tu bot</T></p>
        <L>
          <Li>Su número de WhatsApp, o un identificador de sesión si escriben por el widget web.</Li>
          <Li>El contenido de los mensajes que envían y de las respuestas del bot.</Li>
          <Li>
            Los audios e imágenes que manden. Los audios se transcriben a texto y las imágenes se
            describen, para que el bot pueda responder.
          </Li>
          <Li>
            Si activás la encuesta de satisfacción, la puntuación del 1 al 5 y el comentario que
            dejen.
          </Li>
        </L>
      </>
    ),
  },
  {
    id: 'roles',
    title: 'Quién responde por los datos de tus clientes',
    content: (
      <>
        <p>Esta distinción es importante y queremos que quede explícita.</p>
        <p>
          Respecto de los datos del grupo (c) —los de las personas que le escriben a tu bot—{' '}
          <T>BotForge actúa como procesador</T>: los tratamos por cuenta tuya y siguiendo tus
          instrucciones, para poder prestarte el servicio.
        </p>
        <p>
          <T>El responsable frente a esas personas sos vos</T>, como titular de la cuenta. Eso
          implica, entre otras cosas, que sos quien debe informarles que están hablando con un
          asistente automatizado, y quien debe atender los pedidos que te hagan sobre sus propios
          datos. Nosotros te damos las herramientas para poder responderlos.
        </p>
        <p>
          Respecto de los datos de los grupos (a) y (b) —los tuyos y los de tu negocio— BotForge sí
          es el responsable.
        </p>
      </>
    ),
  },
  {
    id: 'usos',
    title: 'Para qué usamos los datos',
    content: (
      <>
        <L>
          <Li>
            <T>Prestar el servicio:</T> que tus bots respondan, que encuentren la información de tus
            documentos, y que puedas ver y administrar todo desde el panel.
          </Li>
          <Li>
            <T>Procesar pagos:</T> los datos mínimos que Pagopar necesita para cobrar y emitir el
            comprobante.
          </Li>
          <Li>
            <T>Enviarte avisos operativos:</T> verificación de tu email, recuperación de contraseña,
            resumen diario de actividad, vencimiento de tu plan, y avisos cuando un cliente pide
            hablar con una persona o deja una calificación baja.
          </Li>
          <Li>
            <T>Mejorar el funcionamiento de la plataforma:</T> detectar errores y entender qué
            partes fallan.
          </Li>
        </L>
        <p className="pt-2">
          <T>No vendemos tus datos ni los de tus clientes</T>, y no los usamos para publicidad.
        </p>
      </>
    ),
  },
  {
    id: 'terceros',
    title: 'Con quién compartimos datos',
    content: (
      <>
        <p>
          Para funcionar, BotForge se apoya en estos proveedores. Cada uno recibe únicamente los
          datos que necesita para su función.
        </p>
        <L>
          <Li><T>Anthropic</T> — procesa los mensajes para generar las respuestas del bot.</Li>
          <Li><T>Meta (WhatsApp Business Platform)</T> — es el canal por el que viajan los mensajes de WhatsApp.</Li>
          <Li><T>Railway</T> — hosting de la aplicación, base de datos y cola de procesamiento.</Li>
          <Li><T>Pinecone</T> — búsqueda dentro del contenido de tus documentos.</Li>
          <Li><T>Cloudinary</T> — almacenamiento de los archivos e imágenes que se suben o se envían.</Li>
          <Li><T>Resend</T> — envío de los emails de la plataforma.</Li>
          <Li><T>Pagopar</T> — procesamiento de los pagos.</Li>
          <Li><T>Google Drive API</T> — solo si vos lo conectás. Ver la sección 6.</Li>
          <Li><T>Deepgram</T> — transcripción de los audios que mandan tus clientes.</Li>
          <Li><T>Google Cloud Vision</T> — descripción de las imágenes que mandan tus clientes.</Li>
          <Li><T>Tavily y Firecrawl</T> — búsqueda web y lectura de sitios, cuando el asistente del panel lo necesita.</Li>
        </L>
        <p className="pt-2">
          Estos proveedores procesan datos fuera de Paraguay. Al usar BotForge aceptás esa
          transferencia, que es necesaria para prestar el servicio.
        </p>
      </>
    ),
  },
  {
    id: 'google-drive',
    title: 'Uso de Google Drive',
    content: (
      <>
        <p>Conectar Google Drive es opcional. Si decidís hacerlo, esto es exactamente lo que pasa:</p>
        <L>
          <Li>
            Accedemos <T>solamente a los archivos de la carpeta que vos indiques</T>. No leemos,
            listamos ni accedemos al resto de tu Drive.
          </Li>
          <Li>
            Usamos esos archivos con un único fin: <T>que tu bot pueda enviárselos a tus clientes
            finales</T> cuando pidan ver una foto de un producto, un catálogo o un menú.
          </Li>
          <Li>
            <T>No usamos esos archivos para entrenar modelos de inteligencia artificial</T>, ni
            propios ni de terceros.
          </Li>
          <Li>
            No los compartimos con nadie más allá de lo estrictamente necesario para prestar el
            servicio: la imagen se hospeda de forma temporal para poder enviarla por WhatsApp.
          </Li>
          <Li>
            <T>Podés revocar el acceso cuando quieras</T>, desde la configuración de tu bot en el
            panel, o desde{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 underline-offset-2 hover:underline"
            >
              los permisos de tu cuenta de Google
            </a>
            . Al revocarlo dejamos de tener acceso de inmediato.
          </Li>
        </L>
        <p className="pt-2">
          El uso que BotForge hace de la información recibida de las APIs de Google se ajusta a la{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 underline-offset-2 hover:underline"
          >
            Política de Datos de Usuario de los Servicios de API de Google
          </a>
          , incluidos sus requisitos de uso limitado.
        </p>
      </>
    ),
  },
  {
    id: 'conservacion',
    title: 'Cuánto tiempo conservamos los datos',
    content: (
      <>
        <L>
          <Li>
            Mientras tu cuenta esté activa, conservamos tus datos, tus documentos y las
            conversaciones de tus bots para que puedas consultarlos.
          </Li>
          <Li>
            <T>Si eliminás tu cuenta, se borran tus bots, documentos, conversaciones y
            calificaciones.</T> La eliminación es en cascada y no es reversible.
          </Li>
          <Li>
            Los comprobantes de pago se conservan por el plazo que exige la normativa impositiva,
            aunque hayas eliminado la cuenta.
          </Li>
          <Li>
            Los archivos que hayas conectado desde tu Google Drive siguen siendo tuyos y quedan en
            tu Drive: nosotros solo dejamos de acceder a ellos.
          </Li>
        </L>
        <p className="pt-2">
          Para pedir la eliminación de tu cuenta, escribinos a{' '}
          <a href="mailto:humbertoagdez@gmail.com" className="text-cyan-400 underline-offset-2 hover:underline">
            humbertoagdez@gmail.com
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: 'derechos',
    title: 'Tus derechos',
    content: (
      <>
        <p>Sobre los datos que tenemos tuyos, podés:</p>
        <L>
          <Li><T>Acceder</T> a ellos y pedirnos una copia.</Li>
          <Li><T>Corregir</T> los que estén mal o desactualizados.</Li>
          <Li><T>Eliminarlos</T>, junto con tu cuenta.</Li>
          <Li><T>Exportarlos</T> en un formato que puedas leer y llevarte.</Li>
          <Li>
            <T>Oponerte</T> a determinados tratamientos o retirar un consentimiento que hayas dado,
            como el de Google Drive.
          </Li>
        </L>
        <p className="pt-2">
          Para ejercerlos, escribinos a{' '}
          <a href="mailto:humbertoagdez@gmail.com" className="text-cyan-400 underline-offset-2 hover:underline">
            humbertoagdez@gmail.com
          </a>{' '}
          desde el email de tu cuenta. Te respondemos en un plazo razonable.
        </p>
        <p>
          Si el pedido es de un cliente final tuyo sobre sus propios datos, quien debe atenderlo sos
          vos, por lo que explicamos en la sección 3. Escribinos igual si necesitás que te ayudemos
          a localizar o borrar esa información.
        </p>
      </>
    ),
  },
  {
    id: 'seguridad',
    title: 'Cómo protegemos los datos',
    content: (
      <>
        <L>
          <Li>Las contraseñas se guardan cifradas con bcrypt. No se pueden revertir ni las vemos nunca.</Li>
          <Li>Todo el tráfico entre tu navegador y nuestros servidores viaja cifrado con HTTPS.</Li>
          <Li>Las sesiones usan tokens con vencimiento, y se cierran todas cuando cambiás tu contraseña.</Li>
          <Li>El acceso está limitado por cuenta: verificamos en cada pedido que el recurso te pertenezca.</Li>
          <Li>Las claves de los proveedores viven solo en el servidor y nunca llegan al navegador.</Li>
        </L>
        <p className="pt-2">
          Ningún sistema es infalible. Si detectamos un incidente que afecte tus datos, te avisamos
          por email a la brevedad.
        </p>
      </>
    ),
  },
  {
    id: 'menores',
    title: 'Menores de edad',
    content: (
      <p>
        BotForge es una herramienta para negocios y no está dirigida a menores de edad. No
        recolectamos de forma consciente datos de personas menores de 18 años como titulares de
        cuenta. Si detectamos una cuenta en esa situación, la damos de baja.
      </p>
    ),
  },
  {
    id: 'cambios',
    title: 'Cambios en esta política',
    content: (
      <p>
        Si cambiamos algo relevante de esta política, actualizamos la fecha de arriba y te avisamos
        por email a la dirección de tu cuenta antes de que el cambio entre en vigencia. Los cambios
        menores de redacción se publican sin aviso.
      </p>
    ),
  },
  {
    id: 'relacionados',
    title: 'Documentos relacionados',
    content: (
      <p>
        Esta política se complementa con los{' '}
        <Link href="/terminos" className="text-cyan-400 underline-offset-2 hover:underline">
          Términos de servicio
        </Link>{' '}
        y con la{' '}
        <Link href="/cookies" className="text-cyan-400 underline-offset-2 hover:underline">
          Política de cookies
        </Link>
        .
      </p>
    ),
  },
];

export default function PrivacidadPage() {
  return (
    <LegalDoc
      title="Política de privacidad"
      intro="Qué datos recolectamos, para qué los usamos y qué podés hacer al respecto. Escrito para que se entienda sin ser abogado."
      updated={ACTUALIZADO}
      sections={SECCIONES}
    />
  );
}
