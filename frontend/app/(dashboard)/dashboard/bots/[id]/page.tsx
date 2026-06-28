'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Bot, FileText, Loader2, MessageSquare, Settings, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DocumentUploader, { DocumentRow } from '@/components/DocumentUploader';
import ChatWidget from '@/components/ChatWidget';
import { api, type Bot as BotType, type BotDocument } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function WhatsAppPanel({ bot, onUpdate }: { bot: BotType; onUpdate: (b: BotType) => void }) {
  const { token } = useAuthStore();
  const [number, setNumber] = useState(bot.whatsappNumber ?? '');
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function connect() {
    if (!number.match(/^\+\d{7,15}$/)) { toast.error('Número inválido. Formato: +595981234567'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/whatsapp/bots/${bot.id}/connect`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ whatsappNumber: number }),
      });
      const data = (await res.json()) as { data?: BotType; error?: { message: string } };
      if (!res.ok) throw new Error(data.error?.message);
      onUpdate(data.data!);
      toast.success('Número conectado correctamente');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/whatsapp/bots/${bot.id}/connect`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { data?: BotType; error?: { message: string } };
      if (!res.ok) throw new Error(data.error?.message);
      onUpdate(data.data!);
      setNumber('');
      toast.success('Número desconectado');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Error'); }
    finally { setDisconnecting(false); }
  }

  const webhookUrl = `${API_URL}/api/v1/whatsapp/webhook`;

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conectar número de WhatsApp</CardTitle>
          <CardDescription>
            Asociá un número de Twilio a este bot. Los mensajes que lleguen a ese número serán respondidos automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {bot.whatsappNumber ? (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
              <Smartphone className="h-5 w-5 text-green-600" />
              <div className="flex-1">
                <p className="font-mono text-sm font-semibold">{bot.whatsappNumber}</p>
                <p className="text-xs text-muted-foreground">Número conectado y activo</p>
              </div>
              <Button variant="outline" size="sm" onClick={disconnect} disabled={disconnecting}>
                {disconnecting && <Loader2 className="h-3 w-3 animate-spin" />}
                Desconectar
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Número de WhatsApp (formato internacional)</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="+595981234567"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  className="font-mono"
                />
                <Button onClick={connect} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Conectar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configurar Twilio</CardTitle>
          <CardDescription>Seguí estos pasos para conectar tu número de WhatsApp</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="space-y-2 text-muted-foreground">
            <li className="flex gap-2"><span className="font-semibold text-foreground">1.</span> Entrá a console.twilio.com → Messaging → Try it out → Send a WhatsApp message</li>
            <li className="flex gap-2"><span className="font-semibold text-foreground">2.</span> Para producción: comprá un número de Twilio con capacidad WhatsApp</li>
            <li className="flex gap-2"><span className="font-semibold text-foreground">3.</span> En la configuración del número, pegá esta URL en el campo "When a message comes in":</li>
          </ol>
          <div className="flex items-center gap-2 rounded-md bg-muted p-3 font-mono text-xs">
            <span className="flex-1 break-all">{webhookUrl}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 text-xs"
              onClick={() => { void navigator.clipboard.writeText(webhookUrl); toast.success('URL copiada'); }}
            >
              Copiar
            </Button>
          </div>
          <li className="flex gap-2 text-muted-foreground"><span className="font-semibold text-foreground">4.</span> Asegurate de seleccionar HTTP POST como método</li>
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

      <Tabs defaultValue="documents">
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
          <WhatsAppPanel bot={bot} onUpdate={setBot} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
