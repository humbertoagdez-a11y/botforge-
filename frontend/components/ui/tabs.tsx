'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

/**
 * Lista de pestañas con aviso de que hay más para el costado.
 *
 * La barra ya scrolleaba en horizontal, pero con la barra de scroll oculta
 * (.scrollbar-hide) y cortando la última pestaña a mitad de palabra. Medido en
 * un teléfono de 375px: de las siete pestañas del bot entraban dos, y las
 * cinco restantes —entre ellas WhatsApp, que es el motivo por el que alguien
 * paga— quedaban invisibles y sin ninguna señal de que existieran.
 *
 * El degradado en el borde es la señal: aparece solo del lado donde queda
 * contenido, así que en escritorio, donde entran todas, no se ve nada. Se
 * recalcula al scrollear y al cambiar el tamaño de la ventana.
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const interno = React.useRef<HTMLDivElement | null>(null);
  const [masIzquierda, setMasIzquierda] = React.useState(false);
  const [masDerecha, setMasDerecha] = React.useState(false);

  const medir = React.useCallback(() => {
    const el = interno.current;
    if (!el) return;
    // 2px de tolerancia: el scroll no siempre cae en un entero exacto
    setMasIzquierda(el.scrollLeft > 2);
    setMasDerecha(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  React.useEffect(() => {
    const el = interno.current;
    if (!el) return;
    medir();
    el.addEventListener('scroll', medir, { passive: true });
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', medir);
      ro.disconnect();
    };
  }, [medir]);

  // La pestaña activa puede quedar fuera de la parte visible: al abrir el bot
  // en una pestaña profunda, o al cambiarla desde el asistente.
  React.useEffect(() => {
    const el = interno.current;
    if (!el) return;
    const activa = el.querySelector('[data-state="active"]');
    activa?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  return (
    <div className="relative">
      <TabsPrimitive.List
        ref={(nodo) => {
          interno.current = nodo;
          if (typeof ref === 'function') ref(nodo);
          else if (ref) ref.current = nodo;
        }}
        className={cn(
          'scrollbar-hide inline-flex h-auto max-w-full items-center justify-start overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground',
          className,
        )}
        {...props}
      />
      {/* pointer-events-none: son una señal visual, no tapan el toque */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-lg bg-gradient-to-r from-background to-transparent transition-opacity ${
          masIzquierda ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-background to-transparent transition-opacity ${
          masDerecha ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // min-h-9: antes cada pestaña medía 28px de alto, incómodo de acertar
      // con el pulgar. El ancho lo sigue dando el texto.
      'inline-flex min-h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
