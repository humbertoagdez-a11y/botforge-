'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCopy, Facebook, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { api, type ApiError } from '@/lib/api';

const APP_ID = '1330484219217750';
const CONFIG_ID = '1050694274686639';
const SDK_VERSION = 'v23.0';
const SDK_SRC = `https://connect.facebook.net/en_US/sdk.js`;

/** Tipado minimo del SDK: solo lo que realmente se usa. */
interface RespuestaLogin {
  authResponse?: { code?: string } | null;
  status?: string;
}
interface FacebookSdk {
  init(opciones: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: RespuestaLogin) => void, opciones: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

/** Lo que manda el popup de Meta al completar el flujo. */
interface DatosSignup {
  phoneNumberId: string;
  wabaId: string;
  businessId?: string;
}

type Estado = 'cargando' | 'listo' | 'esperando' | 'enviando' | 'conectado' | 'error';

interface ResultadoOk {
  phoneNumberId: string;
  pin: string;
}

interface Props {
  botId: string;
  /** Se llama al conectar bien, para que el padre refresque el estado del bot */
  onConectado: () => void;
}

/**
 * Mensaje de error segun DONDE se cayo el onboarding.
 *
 * La etapa viaja en el `code` del backend: cada etapa tiene el suyo, asi que no
 * hace falta leer nada mas. 'previo' es el unico que no se reintenta —
 * reintentar con el mismo numero volveria a dar lo mismo.
 */
function explicarError(err: ApiError): { mensaje: string; reintentable: boolean } {
  switch (err.code) {
    case 'META_NUMERO_TOMADO':
      return {
        mensaje: 'Ese número de WhatsApp ya está conectado a otro de tus bots. Elegí otro número, o desconectalo del bot que lo tiene.',
        reintentable: false,
      };
    case 'META_CODE_INVALIDO':
    case 'META_SIN_TOKEN':
      return {
        mensaje: 'La conexión tardó demasiado y el permiso venció. Es normal si el proceso quedó abierto un rato: volvé a empezar.',
        reintentable: true,
      };
    case 'META_SUBSCRIBE_FALLO':
      return {
        mensaje: 'Meta nos dio los permisos pero rechazó activar las notificaciones de tu cuenta. No dejamos el número a medio conectar: reintentá y, si vuelve a fallar, escribinos.',
        reintentable: true,
      };
    case 'META_REGISTER_FALLO':
      return {
        mensaje: 'Las notificaciones quedaron activas pero Meta rechazó registrar el número. Suele pasar si el número ya está registrado en otra cuenta de WhatsApp Business. Reintentá o revisalo en tu Administrador de WhatsApp.',
        reintentable: true,
      };
    case 'META_NO_CONFIGURADO':
      return { mensaje: 'La conexión con Meta no está disponible en este momento.', reintentable: false };
    default:
      return { mensaje: err.message || 'No se pudo completar la conexión.', reintentable: true };
  }
}

export default function EmbeddedSignupButton({ botId, onConectado }: Props) {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [resultado, setResultado] = useState<ResultadoOk | null>(null);
  const [error, setError] = useState<{ mensaje: string; reintentable: boolean } | null>(null);

  // El code (callback de FB.login) y los ids (evento del popup) llegan por
  // caminos distintos y en cualquier orden. Se guardan en refs y la peticion
  // sale recien cuando estan los dos.
  const codeRef = useRef<string | null>(null);
  const datosRef = useRef<DatosSignup | null>(null);
  const enviadoRef = useRef(false);

  const enviarAlBackend = useCallback(async () => {
    const code = codeRef.current;
    const datos = datosRef.current;
    if (!code || !datos || enviadoRef.current) return;

    enviadoRef.current = true;
    setEstado('enviando');
    try {
      const r = await api.whatsapp.embeddedSignup(botId, { code, ...datos });
      setResultado({ phoneNumberId: r.phoneNumberId, pin: r.pin });
      setEstado('conectado');
      toast.success('WhatsApp conectado');
      onConectado();
    } catch (err) {
      setError(explicarError(err as ApiError));
      setEstado('error');
    } finally {
      codeRef.current = null;
      datosRef.current = null;
    }
  }, [botId, onConectado]);

  // ── SDK: se carga solo al montar ESTA pestaña, nunca en el layout global ────
  useEffect(() => {
    if (window.FB) { setEstado('listo'); return; }

    window.fbAsyncInit = () => {
      window.FB?.init({ appId: APP_ID, autoLogAppEvents: false, xfbml: false, version: SDK_VERSION });
      setEstado('listo');
    };

    const existente = document.getElementById('facebook-jssdk');
    if (existente) return;

    const s = document.createElement('script');
    s.id = 'facebook-jssdk';
    s.src = SDK_SRC;
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onerror = () => {
      setError({ mensaje: 'No se pudo cargar el conector de Facebook. Revisá tu conexión o si algún bloqueador lo está frenando.', reintentable: true });
      setEstado('error');
    };
    document.body.appendChild(s);
  }, []);

  // ── Evento del popup ───────────────────────────────────────────────────────
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!ev.origin.endsWith('facebook.com')) return;
      let payload: { type?: string; event?: string; data?: Record<string, string> };
      try {
        payload = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      if (payload?.type !== 'WA_EMBEDDED_SIGNUP') return;

      // El usuario cerro el popup o Meta aborto: no es un error nuestro y no
      // hay nada que mandar al backend.
      if (payload.event && payload.event !== 'FINISH') {
        setEstado('listo');
        return;
      }

      const d = payload.data ?? {};
      if (!d.phone_number_id || !d.waba_id) return;
      datosRef.current = {
        phoneNumberId: d.phone_number_id,
        wabaId: d.waba_id,
        businessId: d.business_id,
      };
      void enviarAlBackend();
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enviarAlBackend]);

  function conectar(): void {
    if (!window.FB) return;
    setError(null);
    setResultado(null);
    codeRef.current = null;
    datosRef.current = null;
    enviadoRef.current = false;
    setEstado('esperando');

    window.FB.login(
      (r) => {
        const code = r.authResponse?.code;
        if (!code) {
          // Cerro el popup sin autorizar. Silencio a proposito.
          if (!datosRef.current) setEstado('listo');
          return;
        }
        codeRef.current = code;
        void enviarAlBackend();
      },
      {
        config_id: CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  }

  // ── Conectado ──────────────────────────────────────────────────────────────
  if (estado === 'conectado' && resultado) {
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            WhatsApp conectado
          </CardTitle>
          <CardDescription>Tu número quedó listo para recibir y responder mensajes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Identificador del número: <span className="font-mono text-foreground">{resultado.phoneNumberId}</span>
          </p>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Guardá este PIN de verificación en dos pasos
            </p>
            <p className="mt-2 font-mono text-2xl tracking-widest text-foreground">{resultado.pin}</p>
            <p className="mt-2 text-xs leading-relaxed text-amber-200/80">
              Lo generamos y lo tenemos guardado, pero anotalo igual: Meta lo pide si alguna vez
              volvés a registrar este número, y sin él la única salida es restablecer la
              verificación en dos pasos desde tu Administrador de WhatsApp.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 gap-1.5"
              onClick={() => {
                void navigator.clipboard.writeText(resultado.pin);
                toast.success('PIN copiado');
              }}
            >
              <ClipboardCopy className="h-3.5 w-3.5" /> Copiar PIN
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (estado === 'error' && error) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            No se pudo conectar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed text-muted-foreground">{error.mensaje}</p>
          {error.reintentable && (
            <Button variant="outline" className="gap-2" onClick={() => { setError(null); setEstado('listo'); }}>
              <RefreshCw className="h-4 w-4" /> Volver a intentar
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Botón ──────────────────────────────────────────────────────────────────
  const ocupado = estado === 'cargando' || estado === 'esperando' || estado === 'enviando';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Facebook className="h-5 w-5 text-[#1877F2]" />
          Conectar con Facebook
        </CardTitle>
        <CardDescription>
          Usás <span className="font-medium text-foreground">tu propio número</span> de WhatsApp
          Business. Autorizás desde tu cuenta de Facebook y queda conectado en un solo paso, sin
          códigos ni esperas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button className="w-full gap-2 bg-[#1877F2] text-white hover:bg-[#1877F2]/90" onClick={conectar} disabled={ocupado}>
          {estado === 'cargando' && <><Loader2 className="h-4 w-4 animate-spin" /> Preparando…</>}
          {estado === 'esperando' && <><Loader2 className="h-4 w-4 animate-spin" /> Esperando a Facebook…</>}
          {estado === 'enviando' && <><Loader2 className="h-4 w-4 animate-spin" /> Conectando tu número…</>}
          {estado === 'listo' && <><Facebook className="h-4 w-4" /> Continuar con Facebook</>}
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Se abre una ventana de Meta donde elegís tu cuenta de WhatsApp Business. Si la cerrás
          antes de terminar, no se conecta nada y podés volver a intentarlo.
        </p>
      </CardContent>
    </Card>
  );
}
