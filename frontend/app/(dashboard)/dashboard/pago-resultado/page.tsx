'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api, type PagoparEstado } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

/** Clave donde pricing deja el hash antes de mandar al checkout */
const HASH_KEY = 'bf_pagopar_hash';
const POLL_MS = 3000;
/** El webhook de Pagopar puede tardar unos segundos en llegar */
const MAX_INTENTOS = 10;

type Estado = 'cargando' | 'sin-pedido' | 'pagado' | 'pendiente' | 'cancelado' | 'error';

function leerHash(fromQuery: string | null): string | null {
  if (fromQuery) return fromQuery;
  try {
    return sessionStorage.getItem(HASH_KEY);
  } catch {
    return null;
  }
}

function PagoResultado() {
  const searchParams = useSearchParams();
  const { token, user, setAuth } = useAuthStore();
  const [estado, setEstado] = useState<Estado>('cargando');
  const [detalle, setDetalle] = useState<PagoparEstado | null>(null);
  const intentosRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hash = leerHash(searchParams.get('hash'));

  /** Trae el plan nuevo para que el sidebar y los límites dejen de mostrar el viejo */
  const refrescarUsuario = useCallback(async () => {
    if (!token) return;
    try {
      const fresco = await api.auth.me();
      setAuth(token, fresco);
    } catch {
      // El plan ya está aplicado en el backend; se verá al recargar
    }
  }, [token, setAuth]);

  const consultar = useCallback(async () => {
    if (!hash) {
      setEstado('sin-pedido');
      return;
    }
    try {
      const data = await api.pagopar.consultar(hash);
      setDetalle(data);

      if (data.pagado) {
        setEstado('pagado');
        try {
          sessionStorage.removeItem(HASH_KEY);
        } catch {
          // sin sessionStorage no hay nada que limpiar
        }
        void refrescarUsuario();
        return;
      }

      if (data.cancelado) {
        setEstado('cancelado');
        return;
      }

      // Todavía sin confirmar: reintentar mientras queden intentos
      intentosRef.current += 1;
      if (intentosRef.current >= MAX_INTENTOS) {
        setEstado('pendiente');
        return;
      }
      setEstado('cargando');
      timerRef.current = setTimeout(() => void consultar(), POLL_MS);
    } catch {
      setEstado('error');
    }
  }, [hash, refrescarUsuario]);

  useEffect(() => {
    void consultar();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [consultar]);

  if (estado === 'cargando') {
    return (
      <Vista
        icono={<Loader2 className="h-7 w-7 animate-spin text-primary" />}
        fondo="bg-primary/10"
        titulo="Confirmando tu pago"
        texto="Estamos esperando la confirmación de Pagopar. Esto puede tardar unos segundos."
      />
    );
  }

  if (estado === 'pagado') {
    return (
      <Vista
        icono={<CheckCircle2 className="h-7 w-7 text-green-600" />}
        fondo="bg-green-100"
        titulo="¡Pago confirmado!"
        texto={`Tu plan ${user?.plan ?? detalle?.plan ?? ''} ya está activo. Gracias por confiar en BotForge.`}
      >
        {detalle?.formaPago && (
          <p className="text-xs text-muted-foreground">Medio de pago: {detalle.formaPago}</p>
        )}
        <Button asChild className="mt-2">
          <Link href="/dashboard">Ir al dashboard</Link>
        </Button>
      </Vista>
    );
  }

  if (estado === 'pendiente') {
    return (
      <Vista
        icono={<Clock className="h-7 w-7 text-yellow-600" />}
        fondo="bg-yellow-100"
        titulo="Tu pago está en proceso"
        texto="Pagopar todavía no confirmó la operación. Si pagaste con transferencia o en efectivo, puede demorar. Apenas se acredite, tu plan se activa solo."
      >
        <div className="mt-2 flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              intentosRef.current = 0;
              setEstado('cargando');
              void consultar();
            }}
          >
            Volver a consultar
          </Button>
          <Button asChild variant="ghost">
            <Link href="/dashboard">Ir al dashboard</Link>
          </Button>
        </div>
      </Vista>
    );
  }

  if (estado === 'cancelado') {
    return (
      <Vista
        icono={<XCircle className="h-7 w-7 text-red-600" />}
        fondo="bg-red-100"
        titulo="El pago fue cancelado"
        texto="No se realizó ningún cobro. Podés intentarlo de nuevo cuando quieras."
      >
        <Button asChild className="mt-2">
          <Link href="/pricing">Volver a los planes</Link>
        </Button>
      </Vista>
    );
  }

  if (estado === 'sin-pedido') {
    return (
      <Vista
        icono={<XCircle className="h-7 w-7 text-muted-foreground" />}
        fondo="bg-muted"
        titulo="No encontramos el pedido"
        texto="No pudimos identificar qué pago consultar. Si ya pagaste, revisá tu plan en el dashboard."
      >
        <Button asChild className="mt-2">
          <Link href="/pricing">Volver a los planes</Link>
        </Button>
      </Vista>
    );
  }

  return (
    <Vista
      icono={<XCircle className="h-7 w-7 text-red-600" />}
      fondo="bg-red-100"
      titulo="No pudimos consultar el pago"
      texto="Hubo un problema al consultar el estado. Si el cobro se hizo, tu plan se activa igual cuando Pagopar nos avise."
    >
      <Button asChild className="mt-2" variant="outline">
        <Link href="/dashboard">Ir al dashboard</Link>
      </Button>
    </Vista>
  );
}

function Vista({
  icono,
  fondo,
  titulo,
  texto,
  children,
}: {
  icono: React.ReactNode;
  fondo: string;
  titulo: string;
  texto: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="p-6 md:p-8">
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className={`flex h-14 w-14 items-center justify-center rounded-full ${fondo}`}>
            {icono}
          </div>
          <p className="text-lg font-semibold">{titulo}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{texto}</p>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PagoResultadoPage() {
  // useSearchParams necesita un limite de Suspense para el prerender
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <PagoResultado />
    </Suspense>
  );
}
