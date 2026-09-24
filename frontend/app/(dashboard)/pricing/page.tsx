'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import PlanesGrid from '@/components/PlanesGrid';
import { PLANES_PAGOS, type PlanPago } from '@/lib/planes';

/**
 * Planes dentro del panel, para quien ya tiene cuenta.
 *
 * Las tarjetas y el circuito de pago viven en PlanesGrid, compartido con la
 * página pública /planes: son la misma decisión de compra y tenían dos
 * implementaciones con los precios escritos a mano en cada una.
 *
 * `?renovar=PRO` llega desde el email de vencimiento y arranca el pago de ese
 * plan sin que el usuario tenga que encontrarlo en la tabla. Se lee acá y no
 * adentro de PlanesGrid para no obligar a la página pública a cargar los
 * parámetros de la URL.
 */

function PricingContenido() {
  const params = useSearchParams();
  const pedido = params.get('renovar');
  // Solo un plan que exista y se pueda pagar: cualquier otra cosa se ignora
  const renovar = PLANES_PAGOS.some((p) => p.id === pedido) ? (pedido as PlanPago) : null;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Planes y precios</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pagás en guaraníes con Pagopar: tarjeta, transferencia, giro o pago en efectivo.
          Cada pago cubre un mes; todavía no hay débito automático.
        </p>
      </div>

      <PlanesGrid renovar={renovar} />

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

export default function PricingPage() {
  // useSearchParams necesita un límite de Suspense para que la página siga
  // generándose estática
  return (
    <Suspense fallback={<div className="p-6 md:p-8" />}>
      <PricingContenido />
    </Suspense>
  );
}
