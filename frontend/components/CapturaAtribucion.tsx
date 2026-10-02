'use client';

import { useEffect } from 'react';
import { useCookieConsentStore } from '@/lib/store';
import { capturarFbclid, persistirFbc } from '@/lib/atribucion';

/**
 * Lee el fbclid de la URL de llegada (solo en memoria) y, si la persona toca
 * "Aceptar", recien ahi escribe la cookie _fbc. Ver lib/atribucion.ts.
 */
export default function CapturaAtribucion(): null {
  const choice = useCookieConsentStore((s) => s.choice);

  useEffect(() => {
    capturarFbclid();
  }, []);

  useEffect(() => {
    if (choice === 'all') persistirFbc();
  }, [choice]);

  return null;
}
