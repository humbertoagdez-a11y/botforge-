import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDoc, { L, Li, T, type LegalSection } from '@/components/LegalDoc';

export const metadata: Metadata = {
  title: 'Política de cookies',
  description:
    'Qué cookies y almacenamiento local usa BotForge, para qué sirve cada uno y cómo borrarlos.',
};

const ACTUALIZADO = '26 de julio de 2026';

const SECCIONES: LegalSection[] = [
  {
    id: 'resumen',
    title: 'El resumen corto',
    content: (
      <>
        <p>
          <T>BotForge no usa cookies publicitarias ni de rastreo de terceros.</T> No hay píxeles de
          redes sociales, no hay Google Analytics, y no vendemos ni compartimos tu navegación con
          nadie.
        </p>
        <p>
          Lo único que guardamos en tu navegador es lo necesario para que puedas iniciar sesión y
          que la aplicación funcione. Abajo está el detalle de cada cosa.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies que usamos',
    content: (
      <>
        <p>Son dos, y las dos son estrictamente necesarias para la sesión:</p>
        <L>
          <Li>
            <T>accessToken</T> — mantiene tu sesión iniciada mientras navegás el panel. Dura 15
            minutos y se renueva sola mientras estés usando la aplicación.
          </Li>
          <Li>
            <T>refreshToken</T> — permite renovar la sesión sin que tengas que volver a escribir tu
            contraseña. Dura 7 días.
          </Li>
        </L>
        <p className="pt-2">
          Las dos son <T>httpOnly</T>: el código JavaScript de la página no puede leerlas, lo que
          reduce el riesgo si alguien lograra inyectar código en el sitio. Viajan siempre cifradas.
        </p>
      </>
    ),
  },
  {
    id: 'almacenamiento',
    title: 'Almacenamiento local',
    content: (
      <>
        <p>
          Además de las cookies, guardamos algunas cosas en el almacenamiento local de tu
          navegador. No se envían a ningún servidor de terceros:
        </p>
        <L>
          <Li>
            <T>botforge-auth</T> — tu sesión y los datos básicos de tu cuenta, para que el panel
            cargue sin parpadear al abrirlo.
          </Li>
          <Li>
            <T>bf_token</T> — el mismo token de sesión, que la aplicación usa para autenticar sus
            pedidos.
          </Li>
          <Li>
            <T>botforge-cookies</T> — tu respuesta a este banner, para no volver a preguntarte.
          </Li>
          <Li>
            <T>botforge_onboarding_done</T> — si ya viste la guía inicial del panel.
          </Li>
          <Li>
            <T>bf_pagopar_hash</T> — un identificador temporal del pago en curso, para poder
            mostrarte el resultado cuando volvés de Pagopar. Se borra al terminar.
          </Li>
        </L>
      </>
    ),
  },
  {
    id: 'opciones',
    title: 'Qué cambia según lo que elijas',
    content: (
      <>
        <p>
          En el banner tenés dos opciones. Siendo honestos,{' '}
          <T>hoy las dos hacen prácticamente lo mismo</T>, porque no tenemos cookies opcionales:
        </p>
        <L>
          <Li>
            <T>Solo las necesarias</T> — se usan únicamente las cookies de sesión y el
            almacenamiento descrito arriba.
          </Li>
          <Li>
            <T>Aceptar</T> — lo mismo. Guardamos tu consentimiento por si en el futuro sumamos
            alguna medición, en cuyo caso actualizaríamos esta página y te lo volveríamos a
            preguntar.
          </Li>
        </L>
        <p className="pt-2">
          Preferimos decirlo así en vez de simular una elección que hoy no cambia nada.
        </p>
      </>
    ),
  },
  {
    id: 'terceros',
    title: 'Cookies de terceros',
    content: (
      <>
        <p>
          El sitio de BotForge no carga scripts de terceros que instalen cookies. Ahora bien, hay
          dos momentos en que salís de nuestro sitio y ahí aplican las políticas de esos servicios:
        </p>
        <L>
          <Li>
            <T>Pagopar</T> — cuando pagás, el checkout ocurre en su sitio y ellos usan sus propias
            cookies.
          </Li>
          <Li>
            <T>Google</T> — si conectás Google Drive, la pantalla de permisos es de Google y se rige
            por sus políticas.
          </Li>
        </L>
      </>
    ),
  },
  {
    id: 'borrar',
    title: 'Cómo borrarlas',
    content: (
      <>
        <p>
          Podés borrar las cookies y el almacenamiento local desde la configuración de tu navegador,
          en la sección de datos de sitios. Buscá <T>mibotforge.com</T>.
        </p>
        <p>
          Si las borrás vas a tener que iniciar sesión de nuevo, y el banner de cookies va a volver
          a aparecer. Nada más se pierde: tus bots, documentos y conversaciones viven en el servidor,
          no en tu navegador.
        </p>
      </>
    ),
  },
  {
    id: 'relacionados',
    title: 'Documentos relacionados',
    content: (
      <p>
        Esta política se complementa con la{' '}
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

export default function CookiesPage() {
  return (
    <LegalDoc
      title="Política de cookies"
      intro="Qué guardamos en tu navegador y para qué. Spoiler: solo lo necesario para que puedas iniciar sesión."
      updated={ACTUALIZADO}
      sections={SECCIONES}
    />
  );
}
