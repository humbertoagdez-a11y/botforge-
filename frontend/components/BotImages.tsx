'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ImageIcon, Loader2, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { api, type ApiError, type BotImage, type BotImageList } from '@/lib/api';

const MAX_MB = 5;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

function pesoLegible(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BotImages({ botId }: { botId: string }) {
  const [data, setData] = useState<BotImageList | null>(null);
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    try {
      setData(await api.images.list(botId));
    } catch {
      toast.error('No se pudieron cargar las imágenes');
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => { void cargar(); }, [cargar]);

  // La preview es un object URL: hay que revocarlo o queda en memoria
  useEffect(() => {
    if (!archivo) { setPreview(null); return; }
    const url = URL.createObjectURL(archivo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  function cerrar() {
    setAbierto(false);
    setArchivo(null);
    setNombre('');
    setDescripcion('');
    if (inputRef.current) inputRef.current.value = '';
  }

  function elegirArchivo(f: File | null) {
    if (!f) return;
    // Se valida también en el backend; esto es solo para no hacerle esperar
    // una subida que va a rebotar
    if (!TIPOS.includes(f.type)) {
      toast.error('Formato no soportado. Subí una imagen JPG, PNG o WEBP.');
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error(`La imagen no puede pesar más de ${MAX_MB} MB.`);
      return;
    }
    setArchivo(f);
    // El nombre del archivo es un punto de partida razonable
    if (!nombre) setNombre(f.name.replace(/\.[^.]+$/, '').slice(0, 60));
  }

  async function subir() {
    if (!archivo || nombre.trim().length < 2 || descripcion.trim().length < 10) return;
    setSubiendo(true);
    try {
      await api.images.upload(botId, archivo, nombre.trim(), descripcion.trim());
      toast.success('Imagen cargada. Tu bot ya puede mandarla.');
      cerrar();
      await cargar();
    } catch (err) {
      toast.error((err as ApiError).message);
    } finally {
      setSubiendo(false);
    }
  }

  async function borrar(img: BotImage) {
    setBorrando(img.id);
    try {
      await api.images.delete(botId, img.id);
      toast.success('Imagen eliminada');
      await cargar();
    } catch (err) {
      toast.error((err as ApiError).message);
    } finally {
      setBorrando(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── El plan no incluye imágenes ─────────────────────────────────────────────
  if (data?.limit === 0) {
    return (
      <Card className="overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-primary to-cyan-400" />
        <CardContent className="p-6 sm:p-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <ImageIcon className="h-5 w-5 text-primary" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">
            Que tu bot le mande fotos a tus clientes
          </h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Subí el catálogo, el menú o fotos de tus productos. Cuando un cliente pida ver algo,
            el bot le manda la imagen directo por WhatsApp, sin que vos tengas que estar.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            Está disponible desde el plan Básico, junto con WhatsApp.
          </p>
          <Button asChild className="mt-5 w-full sm:w-auto">
            <Link href="/pricing">Ver planes</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const usadas = data?.used ?? 0;
  const tope = data?.limit;
  const lleno = tope !== null && tope !== undefined && usadas >= tope;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">Imágenes del bot</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Tu bot se las manda al cliente por WhatsApp cuando la conversación lo amerita
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="shrink-0 text-xs text-muted-foreground">
                {usadas}{tope === null || tope === undefined ? '' : ` de ${tope}`}
              </span>
              <Button size="sm" onClick={() => setAbierto(true)} disabled={lleno}>
                <Plus className="h-4 w-4" />
                Subir imagen
              </Button>
            </div>
          </div>
          {lleno && (
            <p className="mt-2 text-xs text-orange-500">
              Llegaste al límite de tu plan. Borrá alguna o{' '}
              <Link href="/pricing" className="underline">mejorá el plan</Link>.
            </p>
          )}
        </CardHeader>

        <CardContent>
          {usadas === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Todavía no subiste ninguna imagen</p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
                Subí fotos de tus productos, el catálogo o el menú. El bot elige cuál mandar
                según lo que te pregunte el cliente.
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setAbierto(true)}>
                <Upload className="h-4 w-4" />
                Subir la primera
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data?.images.map((img) => (
                <div key={img.id} className="overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.name}
                    className="h-36 w-full bg-muted object-cover"
                    loading="lazy"
                  />
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{img.name}</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => borrar(img)}
                        disabled={borrando === img.id}
                        title="Eliminar"
                      >
                        {borrando === img.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {img.description}
                    </p>
                    <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                      {pesoLegible(img.fileSize)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Subir ─────────────────────────────────────────────────────────── */}
      <Dialog open={abierto} onOpenChange={(o) => (o ? setAbierto(true) : cerrar())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Subir una imagen</DialogTitle>
            <DialogDescription>
              JPG, PNG o WEBP, hasta {MAX_MB} MB.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="archivo">Imagen</Label>
              <input
                ref={inputRef}
                id="archivo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
                className="block w-full cursor-pointer rounded-md border bg-transparent text-sm file:mr-3 file:cursor-pointer file:rounded-l-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium"
              />
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="Vista previa"
                  className="mt-2 max-h-44 w-full rounded-md border bg-muted object-contain"
                />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input
                id="nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Sillón 3 cuerpos gris"
                maxLength={60}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="descripcion">Cuándo mandarla</Label>
              <Textarea
                id="descripcion"
                rows={3}
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Foto del sillón de 3 cuerpos color gris, tapizado en chenille. Mandarla cuando pregunten por sillones o living."
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground">
                Esto es lo que tu bot lee para decidir si esta imagen sirve. Mientras más
                específica, mejor elige.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={cerrar}>Cancelar</Button>
              <Button
                onClick={subir}
                disabled={
                  subiendo || !archivo || nombre.trim().length < 2 || descripcion.trim().length < 10
                }
              >
                {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Subir imagen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
