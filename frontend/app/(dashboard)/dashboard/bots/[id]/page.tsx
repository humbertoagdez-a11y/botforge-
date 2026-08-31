'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Bot, FileText, IdCard, Image as ImageIcon, Loader2, MessageSquare, MessageSquareQuote, Settings, Smartphone, Sparkles } from 'lucide-react';
// Smartphone kept for the tab icon
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DocumentUploader, { DocumentRow } from '@/components/DocumentUploader';
import DocumentDropzone from '@/components/DocumentDropzone';
import InstructivoWizard from '@/components/InstructivoWizard';
import ChatWidget from '@/components/ChatWidget';
import BotImages from '@/components/BotImages';
import WhatsAppOnboarding from '@/components/WhatsAppOnboarding';
import WhatsAppProfile from '@/components/WhatsAppProfile';
import { api, type Bot as BotType, type BotDocument } from '@/lib/api';
import { useAssistantStore, useAuthStore } from '@/lib/store';
import { Z } from '@/lib/z-index';

interface WhatsAppPanelProps {
  bot: BotType;
  onUpdate: (b: BotType) => void;
  docs: BotDocument[];
  onDocUploaded: (doc: BotDocument) => void;
  onDocDeleted: (docId: string) => void;
}

function BotStatusIndicator({ bot, docs }: { bot: BotType; docs: BotDocument[] }) {
  const processing = docs.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING');

  let dotClass: string;
  let label: string;

  if (!bot.isActive) {
    dotClass = 'bg-red-500';
    label = 'Bot pausado';
  } else if (processing) {
    dotClass = 'bg-blue-500 animate-pulse';
    label = 'Procesando documentos...';
  } else if (bot.whatsappNumber) {
    dotClass = 'bg-green-500';
    label = 'Respondiendo mensajes en WhatsApp';
  } else {
    dotClass = 'bg-yellow-500';
    label = 'Activo — WhatsApp no conectado';
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        {bot.isActive && bot.whatsappNumber && !processing && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotClass}`} />
      </span>
      {label}
    </span>
  );
}

function WhatsAppPanel({ bot, onUpdate, docs, onDocUploaded, onDocDeleted }: WhatsAppPanelProps) {
  return (
    <div className="space-y-4">
      <WhatsAppOnboarding bot={bot} onUpdate={onUpdate} />
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Archivos de entrenamiento rapido</CardTitle>
          <CardDescription>
            Estos archivos le dan informacion extra a tu bot para responder mejor
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentDropzone
            botId={bot.id}
            docs={docs}
            onUploaded={onDocUploaded}
            onDeleted={onDocDeleted}
          />
        </CardContent>
      </Card>
    </div>
  );
}

const updateSchema = z.object({
  name: z.string().min(1).max(100),
  language: z.enum(['es', 'en', 'pt']),
  personality: z.string().min(10).max(1000),
});
type UpdateData = z.infer<typeof updateSchema>;

// La sección de Google Drive vivía acá. Se retiró de la vista: la integración
// exige una verificación de Google que todavía no está aprobada, así que
// ofrecer el botón solo llevaba a una pantalla de permisos que falla. El
// backend (routes/drive.ts, services/googleDrive.ts, el modelo DriveConnection
// y la tool buscar_archivos_drive) queda intacto para poder retomarlo; lo único
// que se sacó es la puerta de entrada del usuario.

/** Encuesta de satisfacción al cliente final. Disponible desde el plan Básico. */
function NpsCard({
  bot,
  plan,
  onUpdate,
}: {
  bot: BotType;
  plan: 'FREE' | 'STARTER' | 'PRO' | 'AGENCY';
  onUpdate: (b: BotType) => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const incluido = plan !== 'FREE';
  const activo = bot.npsEnabled === true;

  async function toggle() {
    if (!incluido || guardando) return;
    setGuardando(true);
    try {
      const actualizado = await api.bots.update(bot.id, { npsEnabled: !activo });
      onUpdate(actualizado);
      toast.success(!activo ? 'Encuesta activada' : 'Encuesta desactivada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareQuote className="h-4 w-4 text-primary" />
              Pedir opinión a los clientes
            </CardTitle>
            <CardDescription className="mt-1">
              Al terminar una conversación, el bot le pregunta al cliente del 1 al 5 qué tan
              bien lo atendió y le pide un comentario.
            </CardDescription>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={activo}
            aria-label="Pedir opinión a los clientes"
            disabled={!incluido || guardando}
            onClick={() => void toggle()}
            className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              activo ? 'bg-primary' : 'bg-white/15'
            }`}
          >
            {/* left-0 NO es decorativo: sin el, el span absolute se posiciona en
                su static position, y como el <button> hereda text-align:center
                del user agent, ese punto es el centro del riel. Resultado real
                medido: apagado el circulo quedaba pegado al borde derecho (a
                24px de un riel de 44px) y encendido se salia 20px enteros
                fuera del switch. Anclado a la izquierda, translate-x-0.5 y
                translate-x-[22px] dan por fin izquierda y derecha. */}
            <span
              className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                activo ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {incluido ? (
          <p className="text-xs text-muted-foreground">
            Se pregunta como máximo una vez cada 30 días por cliente, así que no molesta a
            quien escribe seguido. Las respuestas aparecen en Estadísticas.
          </p>
        ) : (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
            <p className="text-xs leading-relaxed text-amber-200/90">
              Disponible desde el plan Básico.{' '}
              <Link href="/pricing" className="font-semibold text-cyan-400 hover:text-cyan-300">
                Ver planes →
              </Link>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function BotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [bot, setBot] = useState<BotType | null>(null);
  const [docs, setDocs] = useState<BotDocument[]>([]);
  const [loadingBot, setLoadingBot] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [activeTab, setActiveTab] = useState('documents');
  const { openAssistant } = useAssistantStore();
  const { user } = useAuthStore();

  const form = useForm<UpdateData>({ resolver: zodResolver(updateSchema) });

  useEffect(() => {
    Promise.all([api.bots.get(id), api.documents.list(id)])
      .then(([b, d]) => {
        setBot(b);
        setDocs(d);
        form.reset({ name: b.name, language: b.language as 'es' | 'en' | 'pt', personality: b.personality });
      })
      .catch(() => { toast.error('Error al cargar el bot'); router.push('/dashboard'); })
      .finally(() => setLoadingBot(false));
  }, [id]);

  // Poll docs every 5s while any is PENDING or PROCESSING
  useEffect(() => {
    const needsPoll = docs.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING');
    if (!needsPoll) return;
    const t = setTimeout(async () => {
      try {
        const fresh = await api.documents.list(id);
        setDocs(fresh);
      } catch { /* ignore */ }
    }, 5000);
    return () => clearTimeout(t);
  }, [docs, id]);

  async function onSaveConfig(data: UpdateData) {
    setSavingConfig(true);
    try {
      const updated = await api.bots.update(id, data);
      setBot(updated);
      toast.success('Configuración guardada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSavingConfig(false);
    }
  }

  if (loadingBot) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!bot) return null;

  const readyDocs = docs.filter((d) => d.status === 'READY').length;

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" className="mb-4 gap-1 text-muted-foreground" asChild>
          <Link href="/dashboard"><ArrowLeft className="h-4 w-4" /> Mis Bots</Link>
        </Button>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{bot.name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              <Badge variant={bot.isActive ? 'success' : 'outline'} className="text-[10px]">
                {bot.isActive ? 'Activo' : 'Inactivo'}
              </Badge>
              <BotStatusIndicator bot={bot} docs={docs} />
              <span className="text-xs text-muted-foreground">
                {readyDocs} doc{readyDocs !== 1 ? 's' : ''} listos
              </span>
              {readyDocs === 0 && (
                <span className="text-xs text-yellow-600">
                  — Subí al menos un documento para activar el chat
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Gestionar con IA en el header (solo movil) */}
        <button
          type="button"
          onClick={() => openAssistant(id, bot.name)}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-cyan-400/30 bg-[#111120] px-3.5 py-2 text-xs font-medium text-[#E8E8F0] transition-colors hover:bg-cyan-500/10 md:hidden"
        >
          <Image src="/asistente-logo.svg" alt="" width={18} height={18} unoptimized className="h-[18px] w-[18px]" />
          Gestionar con IA
        </button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="scrollbar-hide max-w-full justify-start overflow-x-auto whitespace-nowrap">
          <TabsTrigger value="documents" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Documentos
            {docs.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {docs.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="images" className="gap-1.5">
            <ImageIcon className="h-3.5 w-3.5" />
            Imágenes
          </TabsTrigger>
          <TabsTrigger value="chat" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Chat de prueba
          </TabsTrigger>
          <TabsTrigger value="instructivo" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Instructivo
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5">
            <Settings className="h-3.5 w-3.5" />
            Configuración
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-1.5">
            <Smartphone className="h-3.5 w-3.5" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="whatsapp-profile" className="gap-1.5">
            <IdCard className="h-3.5 w-3.5" />
            Perfil de WhatsApp
          </TabsTrigger>
        </TabsList>

        {/* Documents tab */}
        <TabsContent value="documents" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Subir documento</CardTitle>
              <CardDescription>
                Los documentos se procesan en segundo plano. Una vez listos, el bot puede responder preguntas sobre su contenido.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DocumentUploader
                botId={id}
                onUploaded={(doc) => setDocs((d) => [doc, ...d])}
              />
            </CardContent>
          </Card>

          {docs.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Documentos ({docs.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {docs.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    onDelete={(docId) => setDocs((d) => d.filter((x) => x.id !== docId))}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Images tab */}
        <TabsContent value="images" className="mt-4">
          <BotImages botId={id} />
        </TabsContent>

        {/* Chat tab */}
        <TabsContent value="chat" className="mt-4">
          {readyDocs === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/30" />
                <p className="font-medium">No hay documentos listos</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Subí al menos un documento y esperá que se procese para chatear con el bot.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="max-w-2xl">
              <ChatWidget botId={id} botName={bot.name} />
            </div>
          )}
        </TabsContent>

        {/* Instructivo tab */}
        <TabsContent value="instructivo" className="mt-4">
          <InstructivoWizard
            botId={id}
            botName={bot.name}
            onUploaded={(doc) => {
              setDocs((d) => [doc, ...d]);
              setActiveTab('documents');
            }}
          />
        </TabsContent>

        {/* Config tab */}
        <TabsContent value="config" className="mt-4">
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle className="text-base">Configuración del bot</CardTitle>
              <CardDescription>Editá el nombre, idioma y personalidad del asistente</CardDescription>
            </CardHeader>
            <form onSubmit={form.handleSubmit(onSaveConfig)}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-name">Nombre</Label>
                  <Input id="cfg-name" {...form.register('name')} />
                  {form.formState.errors.name && (
                    <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Idioma</Label>
                  <Select
                    defaultValue={bot.language}
                    onValueChange={(v) => form.setValue('language', v as 'es' | 'en' | 'pt')}
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
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-personality">Personalidad / Instrucciones</Label>
                  <Textarea id="cfg-personality" rows={5} {...form.register('personality')} />
                  {form.formState.errors.personality && (
                    <p className="text-xs text-destructive">{form.formState.errors.personality.message}</p>
                  )}
                </div>
              </CardContent>
              <div className="flex justify-end p-6 pt-0">
                <Button type="submit" disabled={savingConfig}>
                  {savingConfig && <Loader2 className="h-4 w-4 animate-spin" />}
                  Guardar cambios
                </Button>
              </div>
            </form>
          </Card>

          <div className="mt-4">
            <NpsCard bot={bot} plan={user?.plan ?? 'FREE'} onUpdate={setBot} />
          </div>

          <div className="mt-4">
          </div>
        </TabsContent>

        {/* WhatsApp tab */}
        <TabsContent value="whatsapp" className="mt-4">
          {user?.plan === 'FREE' && (
            <Card className="mb-4 border-cyan-500/30 bg-cyan-500/5">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  WhatsApp está disponible desde el plan Básico. Mientras tanto, probá tu bot desde la pestaña Chat de prueba.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setActiveTab('chat')}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Ir al Chat de prueba
                </Button>
              </CardContent>
            </Card>
          )}
          <WhatsAppPanel
            bot={bot}
            onUpdate={setBot}
            docs={docs}
            onDocUploaded={(doc) => setDocs((d) => [doc, ...d])}
            onDocDeleted={(docId) => setDocs((d) => d.filter((x) => x.id !== docId))}
          />
        </TabsContent>

        {/* Perfil de WhatsApp: como ven los clientes el numero. Va aparte de la
            tab de WhatsApp, que se ocupa de CONECTAR el numero. */}
        <TabsContent value="whatsapp-profile" className="mt-4">
          <WhatsAppProfile bot={bot} onIrAConectar={() => setActiveTab('whatsapp')} />
        </TabsContent>
      </Tabs>

      {/* Gestionar con IA: FAB solo en desktop (en movil vive en el header
          para no colisionar con el trigger global del asistente) */}
      <button
        type="button"
        onClick={() => openAssistant(id, bot.name)}
        style={{ zIndex: Z.fab }}
        className="fixed bottom-6 left-[16.5rem] hidden min-h-[44px] items-center gap-2 rounded-full border border-cyan-400/30 bg-[#111120] py-2 pl-2.5 pr-4 text-sm font-medium text-[#E8E8F0] shadow-lg shadow-cyan-950/30 transition-transform hover:scale-105 md:flex"
      >
        <Image src="/asistente-logo.svg" alt="" width={20} height={20} unoptimized className="h-5 w-5" />
        Gestionar con IA
      </button>
    </div>
  );
}
