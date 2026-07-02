'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Bot, Check, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { PERSONALIDADES, type Personalidad } from '@/lib/personalidades';

// ─── Pasos ───────────────────────────────────────────────────────────────────
const STEPS = ['Información básica', 'Elegí una personalidad', 'Personalidad', 'Confirmar'];

// ─── Schemas ─────────────────────────────────────────────────────────────────
const step1Schema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(100),
  language: z.enum(['es', 'en', 'pt']),
});
const step3Schema = z.object({
  personality: z.string().min(10, 'Mínimo 10 caracteres').max(5000),
});

type Step1Data = z.infer<typeof step1Schema>;
type Step3Data = z.infer<typeof step3Schema>;

const DEFAULT_PERSONALITY =
  'Sos un asistente virtual amable y profesional. Respondés preguntas de forma clara y concisa basándote en la información disponible. Si no sabés algo, lo indicás honestamente y ofrecés alternativas.';

const LANG_LABEL: Record<string, string> = { es: 'Español', en: 'English', pt: 'Português' };

// ─── Indicador de pasos ───────────────────────────────────────────────────────
function StepIndicator({ current }: { current: number }) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-2">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors',
              i < current && 'bg-primary text-primary-foreground',
              i === current && 'border-2 border-primary text-primary',
              i > current && 'border border-muted-foreground/30 text-muted-foreground',
            )}
          >
            {i < current ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </div>
          <span className={cn('text-sm', i === current ? 'font-medium' : 'text-muted-foreground')}>
            {label}
          </span>
          {i < STEPS.length - 1 && <div className="h-px w-6 bg-border" />}
        </div>
      ))}
    </div>
  );
}

// ─── Tarjeta de personalidad ──────────────────────────────────────────────────
function PersonalidadCard({
  p,
  selected,
  onClick,
}: {
  p: Personalidad;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all hover:border-primary/50 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        selected
          ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary'
          : 'border-border bg-card',
      )}
    >
      {selected && (
        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
          <Check className="h-3 w-3 text-primary-foreground" />
        </span>
      )}
      <p.icon className="h-12 w-12" />
      <span className="text-sm font-semibold leading-tight">{p.nombre}</span>
      <span className="text-xs leading-snug text-muted-foreground">{p.descripcion}</span>
      <span className="mt-auto rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-violet-400">
        {p.badge}
      </span>
    </button>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function NewBotPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const [step1Data, setStep1Data] = useState<Step1Data>({ name: '', language: 'es' });
  const [selectedPersonalidad, setSelectedPersonalidad] = useState<Personalidad | null>(null);
  const [step3Data, setStep3Data] = useState<Step3Data>({ personality: DEFAULT_PERSONALITY });

  const form1 = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
    defaultValues: step1Data,
  });
  const form3 = useForm<Step3Data>({
    resolver: zodResolver(step3Schema),
    defaultValues: step3Data,
  });

  // Paso 0 → 1
  function goToStep1(data: Step1Data) {
    setStep1Data(data);
    setStep(1);
  }

  // Paso 1 → 2: con personalidad seleccionada
  function goToStep2WithTemplate() {
    if (!selectedPersonalidad) return;
    form3.setValue('personality', selectedPersonalidad.prompt);
    setStep(2);
  }

  // Paso 1 → 2: saltear, escribir desde cero
  function skipToStep2() {
    setSelectedPersonalidad(null);
    form3.setValue('personality', DEFAULT_PERSONALITY);
    setStep(2);
  }

  // Paso 2 → 3
  function goToStep3(data: Step3Data) {
    setStep3Data(data);
    setStep(3);
  }

  // Crear bot
  async function handleCreate() {
    setLoading(true);
    try {
      const bot = await api.bots.create({
        name: step1Data.name,
        language: step1Data.language,
        personality: step3Data.personality,
      });
      toast.success('Bot creado exitosamente');
      router.push(`/dashboard/bots/${bot.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear el bot');
      setLoading(false);
    }
  }

  return (
    <div className={cn('mx-auto p-6 md:p-8', step === 1 ? 'max-w-3xl' : 'max-w-xl')}>
      <Button
        variant="ghost"
        size="sm"
        className="mb-6 gap-1 text-muted-foreground"
        onClick={() => (step === 0 ? router.back() : setStep(step - 1))}
      >
        <ArrowLeft className="h-4 w-4" />
        {step === 0 ? 'Volver' : 'Atrás'}
      </Button>

      <StepIndicator current={step} />

      {/* ── Paso 0: Información básica ─────────────────────────────────── */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Información básica</CardTitle>
            <CardDescription>Dale un nombre y elegí el idioma principal del bot</CardDescription>
          </CardHeader>
          <form onSubmit={form1.handleSubmit(goToStep1)}>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Nombre del bot</Label>
                <Input id="name" placeholder="Ej: Asistente de Ventas" {...form1.register('name')} />
                {form1.formState.errors.name && (
                  <p className="text-xs text-destructive">{form1.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Idioma principal</Label>
                <Select
                  defaultValue={step1Data.language}
                  onValueChange={(v) => form1.setValue('language', v as 'es' | 'en' | 'pt')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="theme-dashboard">
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="pt">Português</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
            <div className="flex justify-end p-6 pt-0">
              <Button type="submit">
                Siguiente <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* ── Paso 1: Elegí una personalidad ────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Elegí una personalidad</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Seleccioná la que mejor se adapta a tu negocio. Vas a poder editarla después.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PERSONALIDADES.map((p) => (
              <PersonalidadCard
                key={p.id}
                p={p}
                selected={selectedPersonalidad?.id === p.id}
                onClick={() =>
                  setSelectedPersonalidad((prev) => (prev?.id === p.id ? null : p))
                }
              />
            ))}
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              onClick={skipToStep2}
            >
              <Pencil className="h-4 w-4" />
              Escribir desde cero
            </Button>
            <Button
              type="button"
              disabled={!selectedPersonalidad}
              onClick={goToStep2WithTemplate}
            >
              Usar esta personalidad <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Paso 2: Editar personalidad ────────────────────────────────── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedPersonalidad ? (
                <span className="flex items-center gap-2">
                  <selectedPersonalidad.icon className="h-7 w-7" />
                  {selectedPersonalidad.nombre}
                </span>
              ) : (
                'Personalidad del bot'
              )}
            </CardTitle>
            <CardDescription>
              {selectedPersonalidad
                ? 'El prompt está pre-cargado. Podés editarlo como quieras.'
                : 'Describí cómo se va a comportar e identificar el bot.'}
            </CardDescription>
          </CardHeader>
          <form onSubmit={form3.handleSubmit(goToStep3)}>
            <CardContent className="space-y-3">
              <Textarea
                id="personality"
                rows={10}
                placeholder="Sos un asistente..."
                className="font-mono text-xs leading-relaxed"
                {...form3.register('personality')}
              />
              {form3.formState.errors.personality && (
                <p className="text-xs text-destructive">
                  {form3.formState.errors.personality.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                El contexto de tus documentos se agrega automáticamente a cada respuesta.
              </p>
            </CardContent>
            <div className="flex justify-between p-6 pt-0">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4" /> Cambiar plantilla
              </Button>
              <Button type="submit">
                Siguiente <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* ── Paso 3: Confirmar ──────────────────────────────────────────── */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Confirmar creación</CardTitle>
            <CardDescription>Revisá los datos antes de crear el bot</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                {selectedPersonalidad ? (
                  <selectedPersonalidad.icon className="h-7 w-7" />
                ) : (
                  <Bot className="h-5 w-5 text-primary" />
                )}
              </div>
              <div>
                <p className="font-semibold">{step1Data.name}</p>
                <p className="text-sm text-muted-foreground">
                  {LANG_LABEL[step1Data.language]}
                  {selectedPersonalidad && (
                    <span className="ml-2 text-muted-foreground/70">· {selectedPersonalidad.nombre}</span>
                  )}
                </p>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/30 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Instrucciones del sistema</p>
              <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/80">
                {step3Data.personality}
              </p>
            </div>
          </CardContent>
          <div className="flex justify-between p-6 pt-0">
            <Button type="button" variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4" /> Atrás
            </Button>
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Crear bot
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
