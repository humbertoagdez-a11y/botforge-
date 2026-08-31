'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Loader2, Upload, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, type Bot as BotType, type WhatsAppProfile as Perfil, type WhatsAppProfileUpdate } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Limites exactos de Meta. El servidor los valida igual: esto es para avisar antes. */
const MAX = { about: 139, description: 512, address: 256, email: 128, website: 256 };
const MAX_FOTO_MB = 5;

/**
 * Enum de Meta con su traduccion. El orden es el de la documentacion, no
 * alfabetico, para que coincida con lo que devuelve la API.
 */
const VERTICALES: { valor: string; etiqueta: string }[] = [
  { valor: 'OTHER', etiqueta: 'Otro' },
  { valor: 'AUTO', etiqueta: 'Automotor' },
  { valor: 'BEAUTY', etiqueta: 'Belleza y cuidado personal' },
  { valor: 'APPAREL', etiqueta: 'Indumentaria' },
  { valor: 'EDU', etiqueta: 'Educación' },
  { valor: 'ENTERTAIN', etiqueta: 'Entretenimiento' },
  { valor: 'EVENT_PLAN', etiqueta: 'Organización de eventos' },
  { valor: 'FINANCE', etiqueta: 'Finanzas' },
  { valor: 'GROCERY', etiqueta: 'Almacén y supermercado' },
  { valor: 'GOVT', etiqueta: 'Gobierno' },
  { valor: 'HOTEL', etiqueta: 'Hotelería' },
  { valor: 'HEALTH', etiqueta: 'Salud' },
  { valor: 'NONPROFIT', etiqueta: 'Organización sin fines de lucro' },
  { valor: 'PROF_SERVICES', etiqueta: 'Servicios profesionales' },
  { valor: 'RETAIL', etiqueta: 'Comercio minorista' },
  { valor: 'TRAVEL', etiqueta: 'Turismo' },
  { valor: 'RESTAURANT', etiqueta: 'Restaurante' },
  { valor: 'ALCOHOL', etiqueta: 'Venta de alcohol' },
  { valor: 'ONLINE_GAMBLING', etiqueta: 'Apuestas en línea' },
  { valor: 'PHYSICAL_GAMBLING', etiqueta: 'Apuestas presenciales' },
  { valor: 'OTC_DRUGS', etiqueta: 'Venta de medicamentos de venta libre' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Contador de caracteres: ambar al acercarse al limite, rojo al pasarse */
function Contador({ actual, max }: { actual: number; max: number }) {
  const color =
    actual > max ? 'text-red-400' : actual > max * 0.9 ? 'text-amber-400' : 'text-muted-foreground';
  return (
    <span className={`text-[11px] tabular-nums ${color}`}>
      {actual}/{max}
    </span>
  );
}

export default function WhatsAppProfile({
  bot,
  onIrAConectar,
}: {
  bot: BotType;
  onIrAConectar: () => void;
}) {
  const { token } = useAuthStore();
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  /** Lo ultimo que devolvio Meta: la base para saber que campos cambiaron */
  const [original, setOriginal] = useState<Perfil>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const [about, setAbout] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [web1, setWeb1] = useState('');
  const [web2, setWeb2] = useState('');
  const [vertical, setVertical] = useState('');

  function volcarEnFormulario(p: Perfil) {
    setOriginal(p);
    setAbout(p.about ?? '');
    setDescription(p.description ?? '');
    setAddress(p.address ?? '');
    setEmail(p.email ?? '');
    setWeb1(p.websites?.[0] ?? '');
    setWeb2(p.websites?.[1] ?? '');
    setVertical(p.vertical ?? '');
  }

  // Con Meta el vinculo vive en metaPhoneNumberId, asi que bot.whatsappNumber
  // viene null aunque este conectado: hay que preguntarle al backend.
  useEffect(() => {
    let cancelado = false;
    void (async () => {
      setCargando(true);
      try {
        const res = await fetch(`${API}/api/v1/whatsapp/bots/${bot.id}/connection-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as { data?: { status?: string } };
        const activo = json.data?.status === 'ACTIVE';
        if (cancelado) return;
        setConectado(activo);
        // Sin numero conectado no se pide el perfil: el backend daria 400
        if (!activo) return;
        volcarEnFormulario(await api.whatsappProfile.get(bot.id));
      } catch (err) {
        if (!cancelado) {
          toast.error(err instanceof Error ? err.message : 'No se pudo cargar el perfil');
        }
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [bot.id, token]);

  /** Solo los campos que cambiaron respecto de lo ultimo que devolvio Meta */
  function armarCambios(): WhatsAppProfileUpdate | null {
    const cambios: WhatsAppProfileUpdate = {};
    if (about.trim() !== (original.about ?? '')) cambios.about = about.trim();
    if (description.trim() !== (original.description ?? '')) cambios.description = description.trim();
    if (address.trim() !== (original.address ?? '')) cambios.address = address.trim();
    if (email.trim() !== (original.email ?? '')) cambios.email = email.trim();
    if (vertical && vertical !== (original.vertical ?? '')) cambios.vertical = vertical;

    const websEnFormulario = [web1.trim(), web2.trim()].filter(Boolean);
    const websOriginales = original.websites ?? [];
    if (websEnFormulario.join('|') !== websOriginales.join('|')) cambios.websites = websEnFormulario;

    return Object.keys(cambios).length > 0 ? cambios : null;
  }

  /** Validacion en el cliente. El servidor revalida igual: esto evita el viaje. */
  function primerError(c: WhatsAppProfileUpdate): string | null {
    if (c.about !== undefined && c.about.length === 0) {
      return 'El texto de estado no puede quedar vacío';
    }
    if (c.about !== undefined && c.about.length > MAX.about) {
      return `El texto de estado no puede superar los ${MAX.about} caracteres`;
    }
    if (c.description !== undefined && c.description.length > MAX.description) {
      return `La descripción no puede superar los ${MAX.description} caracteres`;
    }
    if (c.address !== undefined && c.address.length > MAX.address) {
      return `La dirección no puede superar los ${MAX.address} caracteres`;
    }
    if (c.email !== undefined && c.email.length > 0) {
      if (c.email.length > MAX.email) return `El email no puede superar los ${MAX.email} caracteres`;
      if (!EMAIL_RE.test(c.email)) return 'El email no tiene un formato válido';
    }
    for (const w of c.websites ?? []) {
      if (w.length > MAX.website) return `Cada sitio web puede tener hasta ${MAX.website} caracteres`;
      if (!w.startsWith('http://') && !w.startsWith('https://')) {
        return 'Los sitios web tienen que empezar con http:// o https://';
      }
    }
    return null;
  }

  async function guardar() {
    const cambios = armarCambios();
    if (!cambios) {
      toast.info('No hay cambios para guardar');
      return;
    }
    const error = primerError(cambios);
    if (error) {
      toast.error(error);
      return;
    }
    setGuardando(true);
    try {
      volcarEnFormulario(await api.whatsappProfile.update(bot.id, cambios));
      toast.success('Perfil actualizado. Tus clientes ya lo ven así.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar el perfil');
    } finally {
      setGuardando(false);
    }
  }

  async function subirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FOTO_MB * 1024 * 1024) {
      toast.error(`La imagen no puede superar los ${MAX_FOTO_MB}MB`);
      return;
    }
    setSubiendoFoto(true);
    try {
      // El servidor recorta a cuadrado y reescala a 640x640: aca solo se manda
      volcarEnFormulario(await api.whatsappProfile.uploadPicture(bot.id, file));
      toast.success('Foto de perfil actualizada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo subir la foto');
    } finally {
      setSubiendoFoto(false);
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando el perfil...
      </div>
    );
  }

  if (conectado === false) {
    return (
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Todavía no conectaste WhatsApp</CardTitle>
          <CardDescription>
            El perfil de negocio es lo que ven tus clientes cuando te escriben por WhatsApp. Para
            configurarlo, primero conectá el número del bot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onIrAConectar} className="gap-1.5">
            Ir a conectar WhatsApp
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Perfil de WhatsApp</CardTitle>
          <CardDescription>
            Así te ven tus clientes cuando abren tu chat. Se guarda en WhatsApp, no en BotForge.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Foto */}
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/5">
              {original.profile_picture_url ? (
                <Image
                  src={original.profile_picture_url}
                  alt="Foto de perfil de WhatsApp"
                  fill
                  unoptimized
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <User className="h-8 w-8 text-white/25" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={(e) => void subirFoto(e)}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={subiendoFoto}
                onClick={() => fileRef.current?.click()}
                className="gap-1.5"
              >
                {subiendoFoto ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                {subiendoFoto ? 'Subiendo...' : original.profile_picture_url ? 'Cambiar foto' : 'Subir foto'}
              </Button>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                JPG o PNG, hasta {MAX_FOTO_MB}MB. La recortamos a cuadrado y la ajustamos a 640x640
                automáticamente.
              </p>
            </div>
          </div>

          {/* about */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="wa-about">Texto de estado</Label>
              <Contador actual={about.length} max={MAX.about} />
            </div>
            <Input
              id="wa-about"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Ej: Atendemos todos los días"
            />
          </div>

          {/* description */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="wa-description">Descripción del negocio</Label>
              <Contador actual={description.length} max={MAX.description} />
            </div>
            <Textarea
              id="wa-description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Lunes a sábado de 9 a 19hs. Envíos a todo Asunción."
            />
            <p className="text-[11px] text-muted-foreground">
              WhatsApp no tiene un campo aparte para el horario: escribilo acá y tus clientes lo van
              a ver.
            </p>
          </div>

          {/* address */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="wa-address">Dirección</Label>
              <Contador actual={address.length} max={MAX.address} />
            </div>
            <Input
              id="wa-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ej: Av. España 1234, Asunción"
            />
          </div>

          {/* email */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="wa-email">Email de contacto</Label>
              <Contador actual={email.length} max={MAX.email} />
            </div>
            <Input
              id="wa-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contacto@tunegocio.com"
            />
            {email.length > 0 && !EMAIL_RE.test(email.trim()) && (
              <p className="text-[11px] text-red-400">El email no tiene un formato válido</p>
            )}
          </div>

          {/* websites: dos fijos, porque el maximo de Meta es 2 */}
          <div className="space-y-1.5">
            <Label>Sitios web (máximo 2)</Label>
            <Input
              value={web1}
              onChange={(e) => setWeb1(e.target.value)}
              placeholder="Sitio web 1 — https://tunegocio.com"
            />
            <Input
              value={web2}
              onChange={(e) => setWeb2(e.target.value)}
              placeholder="Sitio web 2 — https://instagram.com/tunegocio"
            />
            <p className="text-[11px] text-muted-foreground">
              Tienen que empezar con http:// o https://
            </p>
          </div>

          {/* vertical */}
          <div className="space-y-1.5">
            <Label htmlFor="wa-vertical">Categoría del negocio</Label>
            <Select value={vertical} onValueChange={setVertical}>
              <SelectTrigger id="wa-vertical">
                <SelectValue placeholder="Elegí una categoría" />
              </SelectTrigger>
              <SelectContent>
                {VERTICALES.map((v) => (
                  <SelectItem key={v.valor} value={v.valor}>
                    {v.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-amber-200/80">
              Una vez elegida, WhatsApp no permite dejarla en blanco: solo se puede cambiar por otra.
            </p>
          </div>

          <Button onClick={() => void guardar()} disabled={guardando} className="gap-1.5">
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
