'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Bot,
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  Cpu,
  GraduationCap,
  MessageSquare,
  Scissors,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Upload,
  UtensilsCrossed,
  Zap,
} from 'lucide-react';
import BotForgeAssistant from '@/components/BotForgeAssistant';

// ─── DATOS ────────────────────────────────────────────────────────────────────

type DemoMessage =
  | { from: 'client' | 'bot'; text: string; time: string }
  | { from: 'typing' };

interface Rubro {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  botName: string;
  script: DemoMessage[];
}

const RUBROS: Rubro[] = [
  {
    id: 'restaurante',
    label: 'Restaurante',
    icon: UtensilsCrossed,
    botName: 'Sofia',
    script: [
      { from: 'client', text: 'Hola, tienen mesa para 4 personas esta noche', time: '21:03' },
      { from: 'typing' },
      { from: 'bot', text: 'Hola! Si tenemos disponibilidad para esta noche', time: '21:03' },
      { from: 'typing' },
      { from: 'bot', text: 'Para que hora la prefieren? Tenemos lugar desde las 19hs', time: '21:03' },
      { from: 'client', text: 'A las 21hs nos viene perfecto', time: '21:04' },
      { from: 'typing' },
      { from: 'bot', text: 'Listo, anoto mesa para 4 a las 21hs. Me das tu nombre para la reserva?', time: '21:04' },
    ],
  },
  {
    id: 'clinica',
    label: 'Clinica',
    icon: Stethoscope,
    botName: 'Lucas',
    script: [
      { from: 'client', text: 'Necesito turno con el cardiologo', time: '10:15' },
      { from: 'typing' },
      { from: 'bot', text: 'Hola, con gusto te ayudo a agendar el turno', time: '10:15' },
      { from: 'typing' },
      { from: 'bot', text: 'Es para primera consulta o es un control de rutina?', time: '10:15' },
      { from: 'client', text: 'Primera consulta', time: '10:16' },
      { from: 'typing' },
      { from: 'bot', text: 'Perfecto. Tenemos disponible el jueves a las 10 o el viernes a las 15. Cual te viene mejor?', time: '10:16' },
    ],
  },
  {
    id: 'tienda',
    label: 'Tienda',
    icon: ShoppingBag,
    botName: 'Valentina',
    script: [
      { from: 'client', text: 'Tienen zapatillas Nike talle 42?', time: '14:22' },
      { from: 'typing' },
      { from: 'bot', text: 'Si, tenemos en talle 42 disponibles', time: '14:22' },
      { from: 'typing' },
      { from: 'bot', text: 'Hay en negro, blanco y gris. Cual color preferis?', time: '14:22' },
      { from: 'client', text: 'Negro. Cuanto sale?', time: '14:23' },
      { from: 'typing' },
      { from: 'bot', text: 'El negro sale 450.000 Gs. Te lo enviamos a domicilio o preferis pasar a buscarlo?', time: '14:23' },
    ],
  },
  {
    id: 'peluqueria',
    label: 'Peluqueria',
    icon: Scissors,
    botName: 'Martin',
    script: [
      { from: 'client', text: 'Quiero turno para corte y barba', time: '09:45' },
      { from: 'typing' },
      { from: 'bot', text: 'Hola! Que dia te viene bien esta semana?', time: '09:45' },
      { from: 'client', text: 'El sabado si tienen', time: '09:46' },
      { from: 'typing' },
      { from: 'bot', text: 'Sabado tenemos lugar a las 10, a las 12 y a las 15. Cual preferis?', time: '09:46' },
    ],
  },
  {
    id: 'inmobiliaria',
    label: 'Inmobiliaria',
    icon: Building2,
    botName: 'Carolina',
    script: [
      { from: 'client', text: 'Busco departamento 2 dormitorios en Asuncion', time: '16:30' },
      { from: 'typing' },
      { from: 'bot', text: 'Hola, con gusto te ayudo a encontrar algo', time: '16:30' },
      { from: 'typing' },
      { from: 'bot', text: 'Que zona de Asuncion te interesa? Tenes algun presupuesto en mente?', time: '16:30' },
      { from: 'client', text: 'Zona Recoleta, hasta 500 millones', time: '16:31' },
      { from: 'typing' },
      { from: 'bot', text: 'Perfecto. Tenemos 3 opciones que encajan con eso. Te mando los detalles?', time: '16:31' },
    ],
  },
  {
    id: 'academia',
    label: 'Academia',
    icon: GraduationCap,
    botName: 'Diego',
    script: [
      { from: 'client', text: 'Quiero anotarme al curso de ingles', time: '11:05' },
      { from: 'typing' },
      { from: 'bot', text: 'Hola, me alegra que quieras empezar', time: '11:05' },
      { from: 'typing' },
      { from: 'bot', text: 'Que nivel tenes actualmente? Empezas de cero o ya tenes base?', time: '11:05' },
      { from: 'client', text: 'Nunca estudie, empiezo de cero', time: '11:06' },
      { from: 'typing' },
      { from: 'bot', text: 'Para vos arrancamos con nivel A1. El proximo grupo empieza el lunes. Cuantos dias por semana te conviene?', time: '11:06' },
    ],
  },
];

const PASOS = [
  {
    num: '01',
    icon: Upload,
    title: 'Subis tu informacion',
    desc: 'Cargas el menu, catalogo, precios o informacion de tu negocio',
  },
  {
    num: '02',
    icon: Cpu,
    title: 'La IA procesa todo',
    desc: 'En minutos lee, entiende y aprende todo sobre tu negocio',
  },
  {
    num: '03',
    icon: MessageSquare,
    title: 'Tu bot responde solo',
    desc: 'Atiende a tus clientes por WhatsApp las 24 horas, sin que vos intervengas',
  },
];

const RUBRO_CARDS = [
  { icon: UtensilsCrossed, title: 'Restaurantes', desc: 'Reservas, menu y pedidos sin llamadas' },
  { icon: Stethoscope, title: 'Clinicas', desc: 'Turnos, recordatorios y consultas automaticas' },
  { icon: ShoppingBag, title: 'Tiendas', desc: 'Catalogo, precios y seguimiento de pedidos' },
  { icon: Scissors, title: 'Peluquerias y Esteticas', desc: 'Agenda de turnos sin interrupciones' },
  { icon: Building2, title: 'Inmobiliarias', desc: 'Propiedades, visitas y calificacion de leads' },
  { icon: GraduationCap, title: 'Academias', desc: 'Inscripciones, horarios y dudas resueltas' },
];

const PLANES = [
  {
    name: 'FREE',
    price: 'Gs. 0',
    highlight: false,
    features: ['1 bot activo', '100 mensajes por mes', '3 documentos', 'Chat web'],
    cta: 'Empezar gratis',
  },
  {
    name: 'BASICO',
    price: 'Gs. 150.000',
    highlight: false,
    features: ['1 bot activo', '1.000 mensajes por mes', '10 documentos por bot', 'WhatsApp incluido'],
    cta: 'Elegir Basico',
  },
  {
    name: 'PROFESIONAL',
    price: 'Gs. 350.000',
    highlight: true,
    features: [
      '5 bots activos',
      '10.000 mensajes por mes',
      '50 documentos por bot',
      'WhatsApp + Chat web',
      'Panel de estadisticas',
    ],
    cta: 'Elegir Profesional',
  },
  {
    name: 'AGENCIA',
    price: 'Gs. 750.000',
    highlight: false,
    features: [
      'Bots ilimitados',
      '100.000 mensajes por mes',
      'Documentos ilimitados',
      'Todo lo del plan Profesional',
      'Soporte prioritario',
      'Acceso a API',
    ],
    cta: 'Elegir Agencia',
  },
];

const FAQS = [
  {
    q: 'Necesito saber programar para usarlo?',
    a: 'No. Todo se configura desde el panel con formularios simples. Si sabes escribir un mensaje, podes usar BotForge.',
  },
  {
    q: 'Funciona con mi numero de WhatsApp actual?',
    a: 'Si. Se conecta a tu numero existente en menos de 2 minutos siguiendo los pasos del panel.',
  },
  {
    q: 'Que pasa si el bot no sabe responder algo?',
    a: 'Le avisa al cliente que una persona va a responder, y vos recibis el mensaje para atenderlo. Nunca queda sin respuesta.',
  },
  {
    q: 'Puedo cambiar lo que responde el bot despues?',
    a: 'Si, en cualquier momento. Subis un documento nuevo o editado y el bot incorpora la informacion de inmediato.',
  },
  {
    q: 'Cuanto tarda en estar listo el primer bot?',
    a: 'Menos de 5 minutos desde que te registras hasta que el bot puede responder mensajes reales.',
  },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function useInView<T extends HTMLElement>(threshold = 0.25) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView };
}

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${
        inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      }`}
    >
      {children}
    </div>
  );
}

function AnimatedCounter({
  value,
  format,
}: {
  value: number;
  format: (n: number) => string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.5);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const duration = 1600;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value]);

  return <span ref={ref}>{format(display)}</span>;
}

// ─── NAVBAR ───────────────────────────────────────────────────────────────────

function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-300 ${
        scrolled ? 'border-b border-white/5 bg-black/80 backdrop-blur-lg' : 'bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-lg font-bold text-white">
          BotForge
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-gray-400 md:flex">
          <button onClick={() => scrollTo('como-funciona')} className="transition-colors hover:text-white">
            Caracteristicas
          </button>
          <button onClick={() => scrollTo('precios')} className="transition-colors hover:text-white">
            Precios
          </button>
          <button onClick={() => scrollTo('faq')} className="transition-colors hover:text-white">
            FAQ
          </button>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/auth/login"
            className="rounded-lg border border-white/20 px-3.5 py-1.5 text-sm text-white transition-colors hover:bg-white/10"
          >
            Ingresar
          </Link>
          <Link
            href="/auth/register"
            className="rounded-lg bg-violet-600 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-500"
          >
            Empezar gratis
          </Link>
        </div>
      </div>
    </header>
  );
}

// ─── HERO ─────────────────────────────────────────────────────────────────────

function Hero() {
  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <section
      className="relative overflow-hidden"
      style={{
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }}
    >
      {/* Gradiente radial violeta que pulsa detras del headline */}
      <div className="pointer-events-none absolute left-1/2 top-16 h-[480px] w-[720px] -translate-x-1/2 animate-pulse rounded-full bg-violet-700/25 blur-3xl [animation-duration:4s]" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-20 pt-16 sm:px-6 md:grid-cols-[1.2fr_1fr] md:pb-28 md:pt-24">
        <div className="text-center md:text-left">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/40 bg-violet-600/20 px-4 py-1.5 text-xs font-medium text-violet-300">
            <Sparkles className="h-3.5 w-3.5" />
            Impulsado por Claude AI — Hecho en Paraguay
          </div>

          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
            Tu negocio nunca
            <br />
            para de responder.
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-base text-gray-300 sm:text-lg md:mx-0">
            Crea un asistente con IA en minutos. Conectalo a WhatsApp. El trabaja solo mientras vos
            te enfocas en lo que importa.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row md:justify-start">
            <Link
              href="/auth/register"
              className="w-full rounded-xl bg-violet-600 px-7 py-3.5 text-center text-base font-semibold text-white transition-colors hover:bg-violet-500 sm:w-auto"
            >
              Crear mi bot gratis
            </Link>
            <button
              onClick={() => scrollTo('como-funciona')}
              className="w-full rounded-xl border border-white/25 px-7 py-3.5 text-base font-medium text-white transition-colors hover:bg-white/10 sm:w-auto"
            >
              Ver como funciona
            </button>
          </div>

          <p className="mt-5 text-xs text-gray-500">
            Sin tarjeta de credito · Sin contrato · Cancela cuando quieras
          </p>
        </div>

        <div className="mx-auto w-64 sm:w-80 md:w-full md:max-w-sm">
          <Image
            src="/mascota.svg"
            alt="Mascota de BotForge"
            width={400}
            height={400}
            priority
            unoptimized
            className="h-auto w-full"
          />
        </div>
      </div>
    </section>
  );
}

// ─── DEMO WHATSAPP ────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md bg-white px-3.5 py-3 shadow-sm">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

function PhoneDemo({ rubro }: { rubro: Rubro }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [cycle, setCycle] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stepDelay = 1000;

    rubro.script.forEach((_, i) => {
      timers.push(setTimeout(() => setVisibleCount(i + 1), (i + 1) * stepDelay));
    });
    timers.push(setTimeout(() => setCycle((c) => c + 1), 12000));

    return () => timers.forEach(clearTimeout);
  }, [rubro, cycle]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [visibleCount]);

  const visible = rubro.script.slice(0, visibleCount);

  return (
    <div className="mx-auto w-full max-w-xs">
      <div className="rounded-[2.5rem] bg-[#1A1A1A] p-2.5 shadow-2xl shadow-violet-900/30">
        <div className="overflow-hidden rounded-[2rem]">
          {/* Header WhatsApp */}
          <div className="flex items-center gap-3 bg-[#075E54] px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">{rubro.botName}</p>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                <p className="text-[11px] text-green-100">en linea</p>
              </div>
            </div>
          </div>

          {/* Conversacion */}
          <div ref={scrollRef} className="h-[380px] space-y-2 overflow-y-auto bg-[#ECE5DD] p-3">
            {visible.map((msg, i) => {
              if (msg.from === 'typing') {
                return i === visibleCount - 1 ? <TypingDots key={`t-${i}`} /> : null;
              }
              const isClient = msg.from === 'client';
              return (
                <div key={i} className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 shadow-sm ${
                      isClient ? 'rounded-br-md bg-[#DCF8C6]' : 'rounded-bl-md bg-white'
                    }`}
                  >
                    <p className="text-[13px] leading-snug text-black">{msg.text}</p>
                    <div className="mt-0.5 flex items-center justify-end gap-1">
                      <span className="text-[10px] text-gray-500">{msg.time}</span>
                      {isClient && <CheckCheck className="h-3 w-3 text-[#53BDEB]" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoSection() {
  const [activeId, setActiveId] = useState(RUBROS[0].id);
  const active = RUBROS.find((r) => r.id === activeId) ?? RUBROS[0];

  return (
    <section id="como-funciona" className="bg-[#0D0D12] py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Mira como responde tu bot
        </h2>
        <p className="mt-3 text-center text-gray-400">
          Selecciona un rubro y ve la experiencia en tiempo real
        </p>

        {/* Selector de rubro */}
        <div className="mt-10 flex flex-wrap justify-center gap-2.5">
          {RUBROS.map((r) => {
            const Icon = r.icon;
            const isActive = r.id === activeId;
            return (
              <button
                key={r.id}
                onClick={() => setActiveId(r.id)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-violet-600 text-white'
                    : 'border border-gray-500/30 bg-transparent text-gray-400 hover:border-violet-500/50 hover:text-gray-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                {r.label}
              </button>
            );
          })}
        </div>

        <div className="mt-12">
          <PhoneDemo rubro={active} />
        </div>
      </div>
    </section>
  );
}

// ─── METRICAS ─────────────────────────────────────────────────────────────────

function MetricsSection() {
  const stats = [
    {
      icon: MessageSquare,
      value: 1247,
      format: (n: number) => n.toLocaleString('es-PY'),
      label: 'mensajes respondidos hoy',
    },
    {
      icon: Bot,
      value: 43,
      format: (n: number) => String(n),
      label: 'bots activos en Paraguay',
    },
    {
      icon: Zap,
      value: 2,
      format: (n: number) => `menos de ${n} seg`,
      label: 'tiempo promedio de respuesta',
    },
  ];

  return (
    <section className="bg-[#0F0520] py-16 md:py-20">
      <div className="mx-auto grid max-w-5xl gap-10 px-4 sm:grid-cols-3 sm:px-6">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex flex-col items-center text-center">
              <Icon className="mb-3 h-6 w-6 text-violet-400" />
              <p className="text-4xl font-extrabold text-white sm:text-5xl">
                <AnimatedCounter value={s.value} format={s.format} />
              </p>
              <p className="mt-2 text-sm text-gray-300">{s.label}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── COMO FUNCIONA ────────────────────────────────────────────────────────────

function StepsSection() {
  return (
    <section className="bg-[#0A0A0F] py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          De cero a bot activo en 5 minutos
        </h2>

        <div className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-6">
          {/* Linea punteada conectora */}
          <div className="absolute left-[16%] right-[16%] top-16 hidden border-t-2 border-dashed border-violet-500/25 md:block" />

          {PASOS.map((paso, i) => {
            const Icon = paso.icon;
            return (
              <Reveal key={paso.num} delay={i * 150}>
                <div className="relative flex flex-col items-center text-center">
                  <span className="text-5xl font-extrabold text-violet-600/70">{paso.num}</span>
                  <div className="relative z-10 mt-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-500/30 bg-[#111118]">
                    <Icon className="h-7 w-7 text-violet-400" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-white">{paso.title}</h3>
                  <p className="mt-2 max-w-xs text-sm text-gray-400">{paso.desc}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── RUBROS ───────────────────────────────────────────────────────────────────

function RubrosSection() {
  return (
    <section className="bg-[#0D0D12] py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Para cualquier tipo de negocio
        </h2>

        <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6">
          {RUBRO_CARDS.map((card, i) => {
            const Icon = card.icon;
            return (
              <Reveal key={card.title} delay={i * 80}>
                <div className="group h-full rounded-2xl border border-white/5 bg-[#111118] p-5 transition-all duration-300 hover:-translate-y-1 hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-900/20 md:p-6">
                  <Icon className="h-8 w-8 text-violet-500" />
                  <h3 className="mt-4 font-semibold text-white">{card.title}</h3>
                  <p className="mt-1.5 text-sm text-gray-400">{card.desc}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── PRECIOS ──────────────────────────────────────────────────────────────────

function PricingSection() {
  return (
    <section id="precios" className="bg-[#0A0A0F] py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Planes que crecen con tu negocio
        </h2>
        <p className="mt-3 text-center text-gray-400">Sin contrato. Cancela cuando quieras.</p>

        <div className="mt-12 grid items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLANES.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl p-6 ${
                plan.highlight
                  ? 'border border-violet-400/50 bg-violet-700 shadow-xl shadow-violet-900/40 lg:-my-3 lg:py-9'
                  : 'border border-gray-500/20 bg-[#111118]'
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-semibold text-violet-700">
                  El mas elegido
                </span>
              )}
              <p className={`text-sm font-semibold tracking-wide ${plan.highlight ? 'text-violet-200' : 'text-gray-400'}`}>
                {plan.name}
              </p>
              <p className="mt-3 text-2xl font-extrabold text-white">
                {plan.price}
                <span className={`text-sm font-normal ${plan.highlight ? 'text-violet-200' : 'text-gray-500'}`}>
                  /mes
                </span>
              </p>
              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${plan.highlight ? 'text-white' : 'text-violet-500'}`} />
                    <span className={plan.highlight ? 'text-violet-50' : 'text-gray-300'}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/register"
                className={`mt-7 rounded-xl py-2.5 text-center text-sm font-semibold transition-colors ${
                  plan.highlight
                    ? 'bg-white text-violet-700 hover:bg-violet-50'
                    : 'bg-violet-600 text-white hover:bg-violet-500'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="bg-[#0D0D12] py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Preguntas frecuentes
        </h2>

        <div className="mt-10 space-y-3">
          {FAQS.map((faq, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={faq.q} className="overflow-hidden rounded-xl border border-white/10 bg-[#111118]">
                <button
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <span className="text-sm font-medium text-white sm:text-base">{faq.q}</span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-violet-400 transition-transform duration-300 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                <div
                  className="grid transition-all duration-300 ease-in-out"
                  style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 pb-4 text-sm leading-relaxed text-gray-400">{faq.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── CTA FINAL + FOOTER ───────────────────────────────────────────────────────

function FinalCta() {
  return (
    <section className="bg-gradient-to-br from-[#3B0764] to-[#1E1B4B] py-20 md:py-24">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-3xl font-extrabold text-white sm:text-4xl">
          Empieza hoy. Tu primer bot es gratis.
        </h2>
        <p className="mt-4 text-gray-300">
          Sin tarjeta de credito. Sin contrato. Solo tu negocio respondiendo solo.
        </p>
        <Link
          href="/auth/register"
          className="mt-8 inline-block rounded-xl bg-white px-8 py-4 text-base font-semibold text-violet-700 transition-transform hover:scale-105"
        >
          Crear mi bot ahora
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <footer className="bg-[#070709] py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-center gap-6 text-center">
          <div>
            <p className="text-lg font-bold text-white">BotForge</p>
            <p className="mt-1 text-sm text-gray-500">Chatbots con IA para negocios paraguayos</p>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-gray-500">
            <button onClick={() => scrollTo('como-funciona')} className="transition-colors hover:text-gray-300">
              Caracteristicas
            </button>
            <span className="text-gray-700">|</span>
            <button onClick={() => scrollTo('precios')} className="transition-colors hover:text-gray-300">
              Precios
            </button>
            <span className="text-gray-700">|</span>
            <button onClick={() => scrollTo('faq')} className="transition-colors hover:text-gray-300">
              FAQ
            </button>
            <span className="text-gray-700">|</span>
            <a href="mailto:hola@botforge.com.py" className="transition-colors hover:text-gray-300">
              Contacto
            </a>
            <span className="text-gray-700">|</span>
            <Link href="/terminos" className="transition-colors hover:text-gray-300">
              Términos
            </Link>
            <span className="text-gray-700">|</span>
            <Link href="/privacidad" className="transition-colors hover:text-gray-300">
              Privacidad
            </Link>
          </nav>
        </div>
        <div className="mt-8 border-t border-white/5 pt-6 text-center">
          <p className="text-xs text-gray-600">2026 BotForge · Desarrollado en Paraguay</p>
          <a href="mailto:hola@botforge.com.py" className="mt-1 inline-block text-xs text-gray-600 hover:text-gray-400">
            hola@botforge.com.py
          </a>
        </div>
      </div>
    </footer>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#0A0A0F] font-sans antialiased">
      <Navbar />
      <Hero />
      <DemoSection />
      <MetricsSection />
      <StepsSection />
      <RubrosSection />
      <PricingSection />
      <FaqSection />
      <FinalCta />
      <Footer />
      <BotForgeAssistant />
    </main>
  );
}

/*
PENDIENTES PARA PRODUCCION:
[ ] Agregar NEXT_PUBLIC_API_URL (o BACKEND_URL) en las variables Railway del frontend
    apuntando a https://botforge-production-b16f.up.railway.app
[ ] Verificar que ANTHROPIC_API_KEY este en las variables del backend Railway
[ ] Reemplazar los contadores estaticos de metricas (1.247 / 43 / 2 seg) por datos
    reales de la base de datos cuando haya usuarios reales
[ ] Agregar Google Analytics o Vercel Analytics para tracking de conversiones
[ ] Configurar dominio propio y actualizar FRONTEND_URL en el backend Railway
[ ] Agregar meta tags OG para compartir en redes sociales (layout.tsx)
[ ] Configurar Stripe con price IDs reales de los planes Basico/Profesional/Agencia
[ ] Ajustar el rate limit de /api/v1/assistant/chat segun trafico real
*/
