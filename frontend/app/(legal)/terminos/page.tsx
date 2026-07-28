import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDoc, { L, Li, T, type LegalSection } from '@/components/LegalDoc';

export const metadata: Metadata = {
  title: 'Términos de servicio',
  description:
    'Condiciones de uso de BotForge: planes, cobros, uso aceptable, responsabilidades y límites del servicio.',
};

const ACTUALIZADO = '26 de julio de 2026';

const SECCIONES: LegalSection[] = [
  {
    id: 'que-es',
    title: 'Qué es BotForge',
    content: (
      <>
        <p>
          BotForge es una plataforma que te permite crear asistentes con inteligencia artificial
          para tu negocio y conectarlos a WhatsApp o a tu sitio web. Vos cargás la información de
          tu negocio y el asistente responde a tus clientes con esa información.
        </p>
        <p>
          El servicio lo presta <T>Humberto Fabrizio Arguello García de Zúñiga</T>, desde Paraguay.
          Contacto:{' '}
          <a href="mailto:humbertoagdez@gmail.com" className="text-cyan-400 underline-offset-2 hover:underline">
            humbertoagdez@gmail.com
          </a>
          .
        </p>
        <p>
          Al crear una cuenta aceptás estos términos. Si no estás de acuerdo con alguno, no uses el
          servicio.
        </p>
      </>
    ),
  },
  {
    id: 'requisitos',
    title: 'Requisitos para usarlo',
    content: (
      <L>
        <Li>Ser mayor de edad y tener capacidad para contratar.</Li>
        <Li>Dar datos veraces al registrarte, incluido un email válido que puedas verificar.</Li>
        <Li>
          Verificar tu email. Hasta que lo hagas no podés usar la plataforma: te mandamos un código
          de 6 dígitos al registrarte.
        </Li>
        <Li>Mantener tu contraseña en secreto. Sos responsable de lo que se haga desde tu cuenta.</Li>
      </L>
    ),
  },
  {
    id: 'planes',
    title: 'Planes y límites',
    content: (
      <>
        <p>
          Los precios están expresados <T>en guaraníes</T> y son mensuales. Cada plan tiene estos
          límites:
        </p>
        <L>
          <Li><T>Free</T> — sin costo. 1 bot, 3 documentos, 100 mensajes por mes, sin WhatsApp.</Li>
          <Li><T>Básico</T> — Gs. 150.000. 1 bot, 10 documentos por bot, 1.000 mensajes por mes, con WhatsApp.</Li>
          <Li><T>Profesional</T> — Gs. 350.000. 5 bots, 50 documentos por bot, 4.000 mensajes por mes.</Li>
          <Li><T>Agencia</T> — Gs. 750.000. Bots y documentos ilimitados, 10.000 mensajes por mes.</Li>
        </L>
        <p className="pt-2">
          El asistente del panel también tiene un cupo diario y mensual según el plan, que podés ver
          en el propio panel. Si alcanzás un límite, el servicio no se corta: simplemente no podés
          superar ese tope hasta que se renueve o mejores el plan.
        </p>
        <p>
          Podemos ajustar precios y límites. Si eso pasa, te avisamos por email con antelación y el
          cambio no afecta un período que ya hayas pagado.
        </p>
      </>
    ),
  },
  {
    id: 'cobros',
    title: 'Cómo funciona el cobro',
    content: (
      <>
        <p>
          Los pagos se procesan a través de <T>Pagopar</T>, que acepta tarjeta, transferencia, giro
          y pago en efectivo.
        </p>
        <p>
          <T>No hay renovación automática.</T> Cada pago habilita el plan por 30 días corridos. No
          guardamos tu tarjeta ni te debitamos nada sin que lo inicies vos.
        </p>
        <p>
          Te avisamos por email 3 días antes del vencimiento. Si no renovás,{' '}
          <T>la cuenta vuelve a las limitaciones del plan Free</T>: tus bots, documentos y
          conversaciones no se borran, pero se desactiva WhatsApp y el cupo de mensajes pasa a ser
          el del plan gratuito. Renovando, todo vuelve a funcionar.
        </p>
      </>
    ),
  },
  {
    id: 'reembolsos',
    title: 'Reembolsos',
    content: (
      <>
        <p>
          Somos un negocio chico y preferimos ser claros antes que prometer de más:
        </p>
        <L>
          <Li>
            <T>Dentro de los primeros 7 días de un pago</T>, si el servicio no te sirvió, te
            devolvemos el importe completo. No hace falta que expliques por qué. Escribinos y lo
            gestionamos.
          </Li>
          <Li>
            <T>Si el servicio tuvo una falla nuestra</T> que te impidió usarlo durante una parte
            significativa del mes, te compensamos con días adicionales o con la devolución
            proporcional, lo que prefieras.
          </Li>
          <Li>
            <T>Pasados los 7 días</T>, y salvo el caso anterior, no hacemos devoluciones del período
            en curso. Como no hay renovación automática, alcanza con no volver a pagar para dejar de
            usar el servicio.
          </Li>
        </L>
        <p className="pt-2">
          Los reembolsos se hacen por la misma vía del pago. El plazo depende de Pagopar y del medio
          que hayas usado.
        </p>
      </>
    ),
  },
  {
    id: 'uso-aceptable',
    title: 'Uso aceptable',
    content: (
      <>
        <p>Usando BotForge te comprometés a no:</p>
        <L>
          <Li>
            Enviar spam ni mensajes no solicitados. Los bots son para responder a quien te escribe,
            no para hacer envíos masivos a listas que no te dieron su consentimiento.
          </Li>
          <Li>Suplantar la identidad de una persona u organización, ni hacer pasar al bot por un humano si te preguntan directamente.</Li>
          <Li>Cargar o difundir contenido ilegal, fraudulento, engañoso, o que viole derechos de terceros, incluida la propiedad intelectual.</Li>
          <Li>Intentar vulnerar la seguridad de la plataforma, acceder a datos de otras cuentas, ni saltear los límites de tu plan por medios técnicos.</Li>
          <Li>Revender o sublicenciar el acceso a BotForge sin autorización escrita nuestra.</Li>
          <Li>Usar el servicio para actividades que requieran una habilitación que no tenés, como asesoramiento médico, legal o financiero regulado.</Li>
        </L>
        <p className="pt-2">
          También tenés que cumplir las políticas de WhatsApp y de Meta cuando conectás ese canal.
          Un incumplimiento tuyo puede hacer que Meta bloquee tu número, y eso escapa a nuestro
          control.
        </p>
      </>
    ),
  },
  {
    id: 'responsabilidad-contenido',
    title: 'Tu responsabilidad sobre el contenido y el bot',
    content: (
      <>
        <p>
          <T>Sos responsable del contenido que cargás</T> y de cómo tu bot interactúa con tus
          clientes. Eso incluye la exactitud de los precios, horarios, políticas y cualquier otro
          dato de los documentos que subas.
        </p>
        <p>
          El bot responde en base a lo que vos cargaste. Si la información está desactualizada o
          mal escrita, el bot va a responder mal, y esa responsabilidad es tuya.
        </p>
        <p>
          También sos vos quien debe informarle a tus clientes que están hablando con un asistente
          automatizado, y quien atiende los pedidos que ellos hagan sobre sus propios datos.
        </p>
      </>
    ),
  },
  {
    id: 'limitacion',
    title: 'Límites de nuestra responsabilidad',
    content: (
      <>
        <p>
          El servicio se presta <T>tal cual está</T>, sin garantías de que vaya a estar siempre
          disponible ni de que sea apto para un fin específico.
        </p>
        <p>
          <T>La inteligencia artificial puede cometer errores.</T> Puede entender mal una pregunta,
          dar una respuesta imprecisa o no encontrar información que sí cargaste. Por eso te pedimos
          que supervises lo que responde tu bot, sobre todo en temas sensibles: precios, plazos,
          compromisos comerciales, salud o cualquier cosa donde un error tenga consecuencias.
        </p>
        <p>
          En la medida en que la ley lo permita, nuestra responsabilidad total frente a vos está
          limitada al importe que hayas pagado por el servicio en los 3 meses anteriores al hecho
          que la origine. No respondemos por lucro cesante ni por daños indirectos.
        </p>
      </>
    ),
  },
  {
    id: 'suspension',
    title: 'Suspensión de cuentas',
    content: (
      <>
        <p>
          Podemos suspender o cerrar una cuenta que incumpla estos términos, en especial la sección
          de uso aceptable. Cuando sea posible te avisamos antes y te damos la oportunidad de
          corregirlo; si el incumplimiento es grave o pone en riesgo a terceros, la suspensión puede
          ser inmediata.
        </p>
        <p>
          También podés cerrar tu cuenta cuando quieras escribiéndonos. En ese caso se aplica lo que
          dice la{' '}
          <Link href="/privacidad" className="text-cyan-400 underline-offset-2 hover:underline">
            política de privacidad
          </Link>{' '}
          sobre la eliminación de datos.
        </p>
      </>
    ),
  },
  {
    id: 'terceros',
    title: 'Dependencia de servicios de terceros',
    content: (
      <>
        <p>
          BotForge funciona sobre servicios de terceros: Anthropic para la inteligencia artificial,
          Meta para el canal de WhatsApp, Railway para la infraestructura, y varios más que están
          detallados en la{' '}
          <Link href="/privacidad#terceros" className="text-cyan-400 underline-offset-2 hover:underline">
            política de privacidad
          </Link>
          .
        </p>
        <p>
          <T>Si alguno de esos servicios se cae o cambia sus condiciones, BotForge puede verse
          afectado</T> y no siempre está en nuestras manos resolverlo. Hacemos lo posible por
          minimizar el impacto y por avisarte cuando pase algo relevante.
        </p>
      </>
    ),
  },
  {
    id: 'cambios',
    title: 'Cambios en estos términos',
    content: (
      <p>
        Podemos actualizar estos términos. Si el cambio es relevante, te avisamos por email antes de
        que entre en vigencia. Si seguís usando el servicio después de esa fecha, se entiende que
        aceptaste la nueva versión.
      </p>
    ),
  },
  {
    id: 'ley',
    title: 'Ley aplicable y jurisdicción',
    content: (
      <p>
        Estos términos se rigen por las leyes de la <T>República del Paraguay</T>. Cualquier
        controversia se somete a los tribunales de la ciudad de Asunción, sin perjuicio de los
        derechos que la normativa de defensa del consumidor te reconozca.
      </p>
    ),
  },
  {
    id: 'relacionados',
    title: 'Documentos relacionados',
    content: (
      <p>
        Estos términos se complementan con la{' '}
        <Link href="/privacidad" className="text-cyan-400 underline-offset-2 hover:underline">
          Política de privacidad
        </Link>{' '}
        y la{' '}
        <Link href="/cookies" className="text-cyan-400 underline-offset-2 hover:underline">
          Política de cookies
        </Link>
        .
      </p>
    ),
  },
];

export default function TerminosPage() {
  return (
    <LegalDoc
      title="Términos de servicio"
      intro="Las condiciones bajo las que podés usar BotForge. Sin letra chica: lo que dice acá es lo que hacemos."
      updated={ACTUALIZADO}
      sections={SECCIONES}
    />
  );
}
