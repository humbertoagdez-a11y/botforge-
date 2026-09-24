'use client';

import Link from 'next/link';
import PlanesGrid from '@/components/PlanesGrid';

/**
 * Planes dentro del panel, para quien ya tiene cuenta.
 *
 * Las tarjetas y el circuito de pago viven en PlanesGrid, compartido con la
 * página pública /planes: son la misma decisión de compra y tenían dos
 * implementaciones con los precios escritos a mano en cada una.
 */
export default function PricingPage() {
  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Planes y precios</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pagás en guaraníes con Pagopar: tarjeta, transferencia, giro o pago en efectivo.
          Cada pago cubre un mes; todavía no hay débito automático.
        </p>
      </div>

      <PlanesGrid />

      <p className="mt-8 text-xs text-muted-foreground">
        ¿Querés la versión con las dudas frecuentes respondidas?{' '}
        <Link href="/planes" className="underline underline-offset-4 hover:text-foreground">
          Mirá la página pública de planes
        </Link>
        .
      </p>
    </div>
  );
}
