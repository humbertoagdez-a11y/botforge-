'use client';

import { useCallback, useRef, useState } from 'react';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { api, type BotDocument } from '@/lib/api';
import { formatBytes } from '@/lib/utils';

interface Props {
  botId: string;
  onUploaded: (doc: BotDocument) => void;
}

const ACCEPTED = '.pdf,.docx,.xlsx,.xls,.txt';
const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
];

export default function DocumentUploader({ botId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFile = useCallback(
    async (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error('Tipo de archivo no soportado. Usá PDF, Word, Excel o TXT.');
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        toast.error('El archivo supera el límite de 20 MB.');
        return;
      }
      setUploading(true);
      setProgress(20);
      try {
        const interval = setInterval(() => setProgress((p) => Math.min(p + 10, 85)), 400);
        const doc = await api.documents.upload(botId, file);
        clearInterval(interval);
        setProgress(100);
        setTimeout(() => { setProgress(0); setUploading(false); }, 600);
        onUploaded(doc);
        toast.success(`"${file.name}" subido. Procesando en segundo plano...`);
      } catch (err) {
        setUploading(false);
        setProgress(0);
        toast.error(err instanceof Error ? err.message : 'Error al subir el archivo');
      }
    },
    [botId, onUploaded],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
        dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
      />

      {uploading ? (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Subiendo archivo...</p>
          <Progress value={progress} className="w-48" />
        </>
      ) : (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">Arrastrá un archivo o hacé clic</p>
            <p className="mt-1 text-xs text-muted-foreground">PDF, Word, Excel, TXT — máx. 20 MB</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            Elegir archivo
          </Button>
        </>
      )}
    </div>
  );
}

interface DocRowProps {
  doc: BotDocument;
  onDelete: (id: string) => void;
}

const STATUS_CONFIG = {
  PENDING:    { label: 'En cola',      className: 'bg-gray-100 text-gray-700' },
  PROCESSING: { label: 'Procesando',   className: 'bg-yellow-100 text-yellow-800' },
  READY:      { label: 'Listo',        className: 'bg-green-100 text-green-800' },
  ERROR:      { label: 'Error',        className: 'bg-red-100 text-red-800' },
};

export function DocumentRow({ doc, onDelete }: DocRowProps) {
  const [deleting, setDeleting] = useState(false);
  const cfg = STATUS_CONFIG[doc.status];

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.documents.delete(doc.botId, doc.id);
      onDelete(doc.id);
      toast.success('Documento eliminado');
    } catch {
      toast.error('No se pudo eliminar el documento');
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <FileText className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{doc.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(doc.fileSize)}
          {doc._count?.chunks ? ` · ${doc._count.chunks} fragmentos` : ''}
        </p>
      </div>
      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
        {cfg.label}
      </span>
      {doc.status === 'PROCESSING' && (
        <Loader2 className="h-4 w-4 animate-spin text-yellow-600 shrink-0" />
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={handleDelete}
        disabled={deleting}
      >
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
