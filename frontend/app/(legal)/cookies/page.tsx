import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDoc, { L, Li, T, type LegalSection } from '@/components/LegalDoc';
import CambiarCookies from '@/components/CambiarCookies';

export const metadata: Metadata = {
  title: 'Política de cookies',
  description:
    'Qué cookies y almacenamiento local usa BotForge, para qué sirve cada uno y cómo borrarlos.',
};

const ACTUALIZADO = '2 de octubre de 2026';

const SECCIONES: LegalSection[] = [
  {
    id: 'resumen',
    title: 'El resumen corto',
    content: (
      <>
        <p>
          <T>Solo usamos cookies publicitarias si vos las aceptás.</T> Si elegís
          &laquo;Solo necesarias&raquo; en el aviso de cookies, no se carga ningún script de
          publicidad: ni el Pixel de Meta ni ningún otro. No hay Google Analytics, y no vendemos ni
          compartimos tu navegación con nadie.
        </p>
        <p>
          Si aceptás todas, cargamos el Pixel de Meta y además le avisamos a Meta desde nuestro
          servidor cuando te registrás, empezás un pago o pagás un plan. Sirve para medir qué
          anuncios traen gente que se registra o contrata. Dentro del panel se usa solo en dos
          momentos: cuando empezás un pago y cuando se confirma. Tu uso diario de BotForge no se
          trackea. Abajo está el detalle de cada cosa.
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
          <Li>
            <T>bf_pixel_…</T> — solo si aceptaste todas: una marca de que ya le avisamos a Meta de
            tu pago, para no contarlo dos veces si recargás la pantalla.
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
        <p>En el banner tenés dos opciones, y no hacen lo mismo:</p>
        <L>
          <Li>
            <T>Solo las necesarias</T> — se usan únicamente las cookies de sesión y el
            almacenamiento descrito arriba. <T>A Meta no le llega nada</T>: ni desde tu navegador
            ni desde nuestro servidor.
          </Li>
          <Li>
            <T>Aceptar</T> — además se carga el Pixel de Meta en las páginas públicas, y cuando te
            registrás, empezás un pago o pagás, le avisamos a Meta desde nuestro servidor. El
            detalle de qué datos viajan está en la{' '}
            <Link href="/privacidad#medicion" className="text-cyan-400 underline-offset-2 hover:underline">
              Política de privacidad
            </Link>
            .
          </Li>
        </L>
        <p className="pt-2">
          Si llegás desde un anuncio de Meta, la dirección trae un código del click (
          <T>fbclid</T>). Lo leemos para saber de qué anuncio viniste, pero mientras no elijas{' '}
          <T>no lo guardamos en ningún lado</T>: queda solo en la memoria de la pestaña y se pierde
          al cerrarla. Recién si tocás &laquo;Aceptar&raquo; se guarda.
        </p>
        <p className="pt-2">
          Contamos cuántas personas eligen cada opción, de forma anónima: sumamos uno a un total
          del día, sin guardar tu dirección IP, tu navegador ni ningún dato que te identifique.
          Junto con ese total anotamos solo cuatro etiquetas generales, que no distinguen a una persona de otra: si
          llegaste desde un anuncio, si usás celular o computadora, cuál de las dos versiones de
          este aviso te tocó (estamos probando cuál se entiende mejor; la versión se sortea en cada
          visita y no se guarda) y si elegiste en menos de un segundo.
        </p>
        <div className="pt-3">
          <CambiarCookies />
        </div>
      </>
    ),
  },
  {
    id: 'origen',
    title: 'Lo que contamos sin cookies',
    content: (
      <p>
        Para saber de dónde llega la gente (un anuncio, un link directo, otro sitio) leemos la dirección
        con la que entraste y sumamos uno a un total del día. Esto <T>no usa cookies ni ningún
        almacenamiento</T> en tu navegador, no guarda nada que te identifique y no se manda a Meta,
        así que funciona igual elijas lo que elijas en el aviso. Del código del click de un anuncio
        (fbclid) solo miramos si está o no; su valor no se lee. El detalle está en la{' '}
        <Link href="/privacidad#origen" className="text-cyan-400 underline-offset-2 hover:underline">
          Política de privacidad
        </Link>
        .
      </p>
    ),
  },
  {
    id: 'terceros',
    title: 'Cookies de terceros',
    content: (
      <>
        <p>
          El único script de terceros que puede instalar cookies es el Pixel de Meta, y solo si
          aceptaste todas las cookies:
        </p>
        <L>
          <Li>
            <T>Meta (Facebook / Instagram)</T> — instala la cookie <T>_fbp</T>, que identifica a
            tu navegador para Meta, y <T>_fbc</T>, que guarda de qué anuncio viniste. Duran 90 días.
            Se cargan únicamente en las páginas públicas y en el momento en que completás un
            registro o un pago; nunca mientras usás el panel. Podés evitarlas eligiendo &laquo;Solo
            necesarias&raquo;, y borrarlas con el botón &laquo;Cambiar mi elección&raquo; de arriba.
          </Li>
        </L>
        <p>
          Además hay dos momentos en que salís de nuestro sitio y ahí aplican las políticas de esos
          servicios:
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
      intro="Qué guardamos en tu navegador y para qué. Si elegís «Solo las necesarias», es solo lo que hace falta para que puedas iniciar sesión."
      updated={ACTUALIZADO}
      sections={SECCIONES}
    />
  );
}
