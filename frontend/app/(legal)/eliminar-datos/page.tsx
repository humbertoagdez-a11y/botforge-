import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDoc, { L, Li, T, type LegalSection } from '@/components/LegalDoc';

export const metadata: Metadata = {
  title: 'Eliminación de datos',
  description:
    'Cómo pedir que borremos tu cuenta y todos tus datos de BotForge, qué se elimina exactamente y en cuánto tiempo.',
};

const ACTUALIZADO = '31 de agosto de 2026';

const SECCIONES: LegalSection[] = [
  {
    id: 'resumen',
    title: 'El resumen corto',
    content: (
      <>
        <p>
          Podés pedir que borremos tu cuenta y todo lo que guardamos de vos cuando quieras,
          escribiéndonos a{' '}
          <a
            href="mailto:humbertoagdez@gmail.com"
            className="text-cyan-400 underline-offset-2 hover:underline"
          >
            humbertoagdez@gmail.com
          </a>{' '}
          desde el email de tu cuenta.
        </p>
        <p>
          <T>Hoy no hay un botón de autoservicio en el panel:</T> la eliminación la procesamos a
          mano cuando nos escribís. Preferimos decirlo así, con todas las letras, antes que
          prometerte un botón que todavía no existe.
        </p>
        <p>
          El plazo máximo es de <T>30 días</T>, aunque en la práctica lo resolvemos mucho antes.
        </p>
      </>
    ),
  },
  {
    id: 'quien',
    title: 'De quién son los datos que podés eliminar',
    content: (
      <>
        <p>Hay dos tipos de datos en BotForge y no se piden igual:</p>
        <L>
          <Li>
            <T>Los tuyos, como titular de la cuenta.</T> Tu email, tu nombre, tus bots, los
            documentos que subiste y las conversaciones que tuvieron tus bots. Esto es lo que
            eliminamos con el pedido que se explica en esta página.
          </Li>
          <Li>
            <T>Los de tus clientes finales</T>, o sea las personas que le escriben a tu bot por
            WhatsApp. Sobre esos datos vos sos el responsable y nosotros actuamos por tu cuenta,
            como explicamos en la{' '}
            <Link
              href="/privacidad#roles"
              className="text-cyan-400 underline-offset-2 hover:underline"
            >
              sección 3 de la política de privacidad
            </Link>
            . Si uno de tus clientes te pide que borres sus datos, el pedido te lo tiene que hacer a
            vos. Escribinos igual y te ayudamos a localizar y borrar esa información.
          </Li>
        </L>
      </>
    ),
  },
  {
    id: 'como',
    title: 'Cómo pedir la eliminación',
    content: (
      <>
        <p>
          Mandanos un email a{' '}
          <a
            href="mailto:humbertoagdez@gmail.com"
            className="text-cyan-400 underline-offset-2 hover:underline"
          >
            humbertoagdez@gmail.com
          </a>{' '}
          con el asunto <T>Eliminación de datos</T> y esta información:
        </p>
        <L>
          <Li>
            <T>El email de tu cuenta de BotForge.</T> Es lo único imprescindible: es lo que nos
            permite encontrar tus datos.
          </Li>
          <Li>
            <T>Escribinos desde ese mismo email</T>, así verificamos que el pedido es tuyo. Si nos
            escribís desde otra dirección vamos a pedirte que lo confirmes desde la de la cuenta,
            porque no podemos borrar los datos de alguien a pedido de un tercero.
          </Li>
          <Li>
            Opcional: si solo querés borrar <T>un bot</T> y no toda la cuenta, decinos cuál. Eso lo
            podés hacer vos mismo desde el panel, en la página del bot.
          </Li>
        </L>
        <p className="pt-2">
          Te confirmamos por email cuando esté hecho. No hace falta que des motivos ni que pases por
          ningún intento de retenerte.
        </p>
      </>
    ),
  },
  {
    id: 'que-se-borra',
    title: 'Qué se elimina exactamente',
    content: (
      <>
        <p>
          Al eliminar tu cuenta se borra en cascada todo lo que cuelga de ella. Esta lista sale de
          cómo está construida la base de datos, no es una enumeración genérica:
        </p>
        <L>
          <Li>
            <T>Tu usuario:</T> email, nombre, contraseña (que guardamos siempre cifrada, nunca en
            texto plano) y el documento de identidad o RUC si lo cargaste para pagar.
          </Li>
          <Li>
            <T>Todos tus bots</T>, con su nombre, personalidad e idioma.
          </Li>
          <Li>
            <T>Los documentos que subiste</T> y el texto que extrajimos de ellos, incluidos los
            fragmentos indexados que usa el bot para responder.
          </Li>
          <Li>
            <T>Las imágenes</T> que hayas cargado para que el bot le mande a tus clientes.
          </Li>
          <Li>
            <T>Las conversaciones y todos sus mensajes</T>, tanto las de WhatsApp como las del chat
            de prueba y las del widget web.
          </Li>
          <Li>
            <T>Las calificaciones y encuestas</T> que hayan dejado tus clientes.
          </Li>
          <Li>
            <T>Los informes semanales y consolidados</T> que hayamos generado.
          </Li>
          <Li>
            <T>Tus conversaciones con el asistente</T> del panel.
          </Li>
          <Li>
            <T>Tus tickets de soporte</T> y los mensajes de cada uno.
          </Li>
          <Li>
            <T>Las conexiones de WhatsApp y de Google Drive</T>, las configuraciones de
            notificaciones y las sesiones abiertas.
          </Li>
        </L>
        <p className="pt-2">
          También borramos lo que vive fuera de nuestra base de datos: los archivos que guardamos en
          nuestro proveedor de almacenamiento y los fragmentos indexados en el motor de búsqueda que
          usa el bot.
        </p>
        <p>
          <T>La eliminación no es reversible.</T> No hay papelera ni período de gracia: una vez
          hecha, no podemos recuperar nada.
        </p>
      </>
    ),
  },
  {
    id: 'plazo',
    title: 'En cuánto tiempo',
    content: (
      <>
        <p>
          Procesamos el pedido en un plazo máximo de <T>30 días</T> desde que lo recibimos. En la
          práctica suele ser cuestión de días: el plazo largo está para cubrir vacaciones o un
          pedido que llegue en un mal momento, no porque queramos demorarlo.
        </p>
        <p>
          Si por algún motivo no pudiéramos cumplirlo, te escribimos para explicarte por qué y
          cuándo va a estar.
        </p>
      </>
    ),
  },
  {
    id: 'que-no-se-borra',
    title: 'Qué no se borra, y por qué',
    content: (
      <>
        <L>
          <Li>
            <T>Los comprobantes de pago.</T> Los conservamos por el plazo que exige la normativa
            impositiva paraguaya, aunque hayas eliminado la cuenta. Es una obligación legal, no una
            elección nuestra. Quedan guardados solo a efectos contables y no se usan para nada más.
          </Li>
          <Li>
            <T>Los archivos de tu Google Drive.</T> Nunca fueron nuestros: siguen estando en tu
            Drive, intactos. Lo que se elimina es nuestro permiso para acceder a ellos.
          </Li>
          <Li>
            <T>Los mensajes que ya están en el WhatsApp de tus clientes.</T> Una vez entregados
            están en el teléfono de cada persona y en los servidores de WhatsApp, fuera de nuestro
            alcance.
          </Li>
          <Li>
            <T>Copias de seguridad.</T> Pueden sobrevivir en respaldos por un tiempo acotado hasta
            que el ciclo de rotación los reemplaza. No se usan para nada salvo restaurar el servicio
            ante una falla.
          </Li>
        </L>
      </>
    ),
  },
  {
    id: 'relacionados',
    title: 'Documentos relacionados',
    content: (
      <p>
        Esta página se complementa con la{' '}
        <Link href="/privacidad" className="text-cyan-400 underline-offset-2 hover:underline">
          Política de privacidad
        </Link>{' '}
        y los{' '}
        <Link href="/terminos" className="text-cyan-400 underline-offset-2 hover:underline">
          Términos de servicio
        </Link>
        .
      </p>
    ),
  },
];

export default function EliminarDatosPage() {
  return (
    <LegalDoc
      title="Eliminación de datos"
      intro="Cómo pedir que borremos tu cuenta y todo lo que guardamos de vos, qué se elimina exactamente y en cuánto tiempo."
      updated={ACTUALIZADO}
      sections={SECCIONES}
    />
  );
}
