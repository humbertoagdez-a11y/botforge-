'use client';

import { useCallback, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { DocumentRow } from './DocumentUploader';
import { api, type BotDocument } from '@/lib/api';

const ACCEPTED = '.txt,.pdf,.docx,.xlsx,.csv';
const ACCEPTED_TYPES = [
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];
const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024;

interface Props {
  botId: string;
  docs: BotDocument[];
  onUploaded: (doc: BotDocument) => void;
  onDeleted: (docId: string) => void;
}

export default function DocumentDropzone({ botId, docs, onUploaded, onDeleted }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const atLimit = docs.length >= MAX_FILES;

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (atLimit) {
        toast.error(`Máximo ${MAX_FILES} archivos. Eliminá alguno para subir más.`);
        return;
      }
      const room = MAX_FILES - docs.length;
      const selected = files.slice(0, room);

      for (const file of selected) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
          toast.error(`"${file.name}": formato no soportado. Usá TXT, PDF, Word, Excel o CSV.`);
          continue;
        }
        if (file.size > MAX_SIZE) {
          toast.error(`"${file.name}" supera el límite de 10 MB.`);
          continue;
        }
        setUploading(true);
        try {
          const doc = await api.documents.upload(botId, file);
          onUploaded(doc);
          toast.success(`"${file.name}" subido. Procesando en segundo plano...`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Error al subir "${file.name}"`);
        }
      }
      setUploading(false);
    },
    [atLimit, botId, docs.length, onUploaded],
  );

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(Array.from(e.dataTransfer.files));
        }}
        className={`flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
        } ${atLimit ? 'opacity-60' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void handleFiles(files);
            e.target.value = '';
          }}
        />

        {uploading ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm font-medium">Subiendo archivos...</p>
          </>
        ) : (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
              <Upload className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">
              {atLimit ? `Límite de ${MAX_FILES} archivos alcanzado` : 'Arrastrá archivos o hacé clic'}
            </p>
            <p className="text-xs text-muted-foreground">
              TXT, PDF, Word, Excel o CSV — máx. {MAX_FILES} archivos de 10 MB
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={atLimit}
              onClick={() => inputRef.current?.click()}
            >
              Elegir archivos
            </Button>
          </>
        )}
      </div>

      {docs.length > 0 && (
        <div className="space-y-2">
          {docs.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} onDelete={onDeleted} />
          ))}
        </div>
      )}
    </div>
  );
}
