'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useCookieConsentStore } from '@/lib/store';
import { pixelPageView } from '@/lib/metaPixel';

/**
 * Prefijos donde el pixel NO sigue la navegacion.
 *
 * - /dashboard y /pricing son privados: ahi solo interesan los eventos de
 *   conversion, que disparan las propias pantallas. Navegar el panel no es
 *   dato de marketing.
 * - /widget se embebe en el sitio de cada cliente: trackear ahi seria
 *   trackear a los visitantes de ELLOS, no a los nuestros.
 */
const SIN_SEGUIMIENTO = ['/dashboard', '/pricing', '/widget'];

/**
 * PageView en paginas publicas. Vive en el layout raiz porque es el unico que
 * envuelve landing, /auth y las legales, pero se apaga solo en las rutas de
 * arriba en vez de cargarse en todos lados.
 */
export default function MetaPixel(): null {
  const pathname = usePathname();
  const choice = useCookieConsentStore((s) => s.choice);

  useEffect(() => {
    if (choice !== 'all') return;
    if (SIN_SEGUIMIENTO.some((prefijo) => pathname.startsWith(prefijo))) return;
    pixelPageView();
  }, [pathname, choice]);

  return null;
}
