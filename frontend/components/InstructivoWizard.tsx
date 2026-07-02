'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  Download,
  FileUp,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { api, type BotDocument } from '@/lib/api';

const PREGUNTAS = [
  'Como se llama tu negocio y a que te dedicás?',
  'Que productos o servicios ofrecés? Describilos con precio si los tenes',
  'Cuales son tus horarios de atención?',
  'En que zona o ciudad operás? Hacés envíos?',
  'Cuales son las formas de pago que aceptás?',
  'Cual es tu politica de cambios o devoluciones?',
  'Tenes promociones o descuentos activos? Cuales?',
  'Por que te elegirian a vos y no a la competencia? Que te diferencia?',
  'Como preferirias que responda tu bot: formal, cercano, divertido?',
  'Hay alguna pregunta frecuente que te hacen mucho? Cual es la respuesta?',
  'Queres que el bot derive a una persona en algún caso? Cuando y como?',
  'Algo más que el bot deberia saber sobre tu negocio?',
];

// Las preguntas 8 en adelante (indice 7+) son opcionales
const PRIMERA_OPCIONAL = 7;

const ACCEPTED_UPLOAD = '.txt,.pdf,.docx,.xlsx';

type Phase = 'start' | 'wizard' | 'generating' | 'result' | 'uploaded';

interface Props {
  botId: string;
  botName: string;
  onUploaded: (doc: BotDocument) => void;
}

export default function InstructivoWizard({ botId, botName, onUploaded }: Props) {
  const [phase, setPhase] = useState<Phase>('start');
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [input, setInput] = useState('');
  const [instructivo, setInstructivo] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadingResult, setUploadingResult] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [currentIndex, phase]);

  function startWizard() {
    setAnswers([]);
    setCurrentIndex(0);
    setInput('');
    setPhase('wizard');
  }

  async function handleDirectUpload(file: File) {
    setUploadingFile(true);
    try {
      const doc = await api.documents.upload(botId, file);
      toast.success(`"${file.name}" subido. Procesando en segundo plano...`);
      onUploaded(doc);
      setPhase('uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al subir el archivo');
    } finally {
      setUploadingFile(false);
    }
  }

  function advance(answer: string) {
    const next = [...answers];
    next[currentIndex] = answer;
    setAnswers(next);
    setInput('');

    if (currentIndex + 1 >= PREGUNTAS.length) {
      void generate(next);
    } else {
      setCurrentIndex(currentIndex + 1);
    }
  }

  function goBack() {
    if (currentIndex === 0) {
      setPhase('start');
      return;
    }
    const prev = currentIndex - 1;
    setInput(answers[prev] ?? '');
    setCurrentIndex(prev);
  }

  async function generate(finalAnswers: string[]) {
    setPhase('generating');
    try {
      const payload: Record<string, string> = {};
      PREGUNTAS.forEach((q, i) => {
        payload[q] = finalAnswers[i] ?? '';
      });
      const { instructivo: text } = await api.bots.generateInstructivo(botId, payload);
      setInstructivo(text);
      setPhase('result');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al generar el instructivo');
      setPhase('wizard');
    }
  }

  function downloadTxt() {
    const blob = new Blob([instructivo], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `instructivo-${botName.toLowerCase().replace(/\s+/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function uploadResult() {
    setUploadingResult(true);
    try {
      const fileName = `instructivo-${botName.toLowerCase().replace(/\s+/g, '-')}.txt`;
      const file = new File([instructivo], fileName, { type: 'text/plain' });
      const doc = await api.documents.upload(botId, file);
      toast.success('Instructivo subido al bot. Procesando en segundo plano...');
      onUploaded(doc);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al subir el instructivo');
    } finally {
      setUploadingResult(false);
    }
  }

  // ── PASO 0: pantalla inicial ────────────────────────────────────────────────
  if (phase === 'start') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_UPLOAD}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleDirectUpload(f);
            e.target.value = '';
          }}
        />

        <Card
          className="cursor-pointer transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
          onClick={startWizard}
        >
          <CardHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-base">Generar instructivo con IA</CardTitle>
            <CardDescription>
              Respondé unas preguntas guiadas sobre tu negocio y la IA arma un instructivo de
              entrenamiento completo para tu bot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm">Empezar</Button>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
          onClick={() => !uploadingFile && fileRef.current?.click()}
        >
          <CardHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
              <FileUp className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-base">Subir mi propio archivo</CardTitle>
            <CardDescription>
              Ya tenés un documento con la información de tu negocio. Subilo directo al bot (TXT,
              PDF, Word o Excel).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" variant="outline" disabled={uploadingFile}>
              {uploadingFile && <Loader2 className="h-4 w-4 animate-spin" />}
              Elegir archivo
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Confirmacion de subida directa ─────────────────────────────────────────
  if (phase === 'uploaded') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-14 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <Check className="h-6 w-6 text-green-600" />
          </div>
          <p className="font-semibold">Archivo subido correctamente</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Se está procesando en segundo plano. Podés verlo en el tab Documentos.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setPhase('start')}>
            Subir otro o generar con IA
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── PASO 2: generando ───────────────────────────────────────────────────────
  if (phase === 'generating') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
          <p className="font-semibold">Generando tu instructivo...</p>
          <p className="mt-1 text-sm text-muted-foreground">
            La IA está armando el documento de entrenamiento con tus respuestas. Esto puede tardar
            unos segundos.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── PASO 3: resultado ───────────────────────────────────────────────────────
  if (phase === 'result') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tu instructivo está listo</CardTitle>
          <CardDescription>
            Revisalo y editá lo que quieras antes de guardarlo. Este texto es lo que va a usar tu
            bot para responder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={instructivo}
            onChange={(e) => setInstructivo(e.target.value)}
            rows={20}
            className="font-mono text-xs leading-relaxed"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadTxt}>
              <Download className="h-4 w-4" />
              Descargar como .txt
            </Button>
            <Button size="sm" onClick={() => void uploadResult()} disabled={uploadingResult || !instructivo.trim()}>
              {uploadingResult ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Subir al bot
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCurrentIndex(0);
                setInput(answers[0] ?? '');
                setPhase('wizard');
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Regenerar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── PASO 1: wizard de preguntas ─────────────────────────────────────────────
  const isOptional = currentIndex >= PRIMERA_OPCIONAL;
  const progressPct = (currentIndex / PREGUNTAS.length) * 100;

  return (
    <Card className="max-w-2xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Contame sobre tu negocio</CardTitle>
          <span className="text-xs font-medium text-muted-foreground">
            Pregunta {currentIndex + 1} de {PREGUNTAS.length}
          </span>
        </div>
        <Progress value={progressPct} className="mt-2" />
      </CardHeader>
      <CardContent>
        {/* Historial tipo chat */}
        <div ref={chatRef} className="mb-4 max-h-80 space-y-3 overflow-y-auto pr-1">
          {PREGUNTAS.slice(0, currentIndex + 1).map((q, i) => (
            <div key={q} className="space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="rounded-2xl rounded-tl-md bg-muted px-3.5 py-2.5 text-sm">{q}</div>
              </div>
              {i < currentIndex && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
                    {answers[i]?.trim() ? answers[i] : 'Saltada'}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Input de respuesta */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) advance(input.trim());
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim()) advance(input.trim());
              }
            }}
            rows={3}
            placeholder="Escribí tu respuesta..."
            autoFocus
          />
          <div className="mt-3 flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={goBack}>
              <ArrowLeft className="h-4 w-4" />
              Atras
            </Button>
            <div className="flex gap-2">
              {isOptional && (
                <Button type="button" variant="outline" size="sm" onClick={() => advance('')}>
                  Saltar
                </Button>
              )}
              <Button type="submit" size="sm" disabled={!input.trim()}>
                {currentIndex + 1 === PREGUNTAS.length ? 'Generar instructivo' : 'Siguiente'}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
