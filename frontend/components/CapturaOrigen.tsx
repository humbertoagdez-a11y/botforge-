'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { capturarOrigen } from '@/lib/origen';

/**
 * Lee el origen de la visita una vez por carga de pagina. Ver lib/origen.ts:
 * no escribe nada en el navegador y no depende del banner de cookies.
 */
export default function CapturaOrigen(): null {
  const pathname = usePathname();
  useEffect(() => {
    capturarOrigen(pathname);
    // Solo la primera ruta de la carga: la entrada al sitio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
