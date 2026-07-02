'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Bot, FileText, Loader2, MessageSquare, Settings, Smartphone, Sparkles } from 'lucide-react';
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
import WhatsAppOnboarding from '@/components/WhatsAppOnboarding';
import { api, type Bot as BotType, type BotDocument } from '@/lib/api';

interface WhatsAppPanelProps {
  bot: BotType;
  onUpdate: (b: BotType) => void;
  docs: BotDocument[];
  onDocUploaded: (doc: BotDocument) => void;
  onDocDeleted: (docId: string) => void;
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

export default function BotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [bot, setBot] = useState<BotType | null>(null);
  const [docs, setDocs] = useState<BotDocument[]>([]);
  const [loadingBot, setLoadingBot] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [activeTab, setActiveTab] = useState('documents');

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
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant={bot.isActive ? 'success' : 'outline'} className="text-[10px]">
                {bot.isActive ? 'Activo' : 'Inactivo'}
              </Badge>
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
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="documents" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Documentos
            {docs.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {docs.length}
              </span>
            )}
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
                    <SelectContent>
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
        </TabsContent>

        {/* WhatsApp tab */}
        <TabsContent value="whatsapp" className="mt-4">
          <WhatsAppPanel
            bot={bot}
            onUpdate={setBot}
            docs={docs}
            onDocUploaded={(doc) => setDocs((d) => [doc, ...d])}
            onDocDeleted={(docId) => setDocs((d) => d.filter((x) => x.id !== docId))}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
