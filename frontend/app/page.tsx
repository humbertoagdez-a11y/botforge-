'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  FileText,
  MessageSquare,
  Star,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─── DATA ─────────────────────────────────────────────────────────────────────

const DEMOS = [
  {
    id: 'restaurante',
    label: '🍽️ Restaurante',
    bot: 'La Pergola Bot',
    messages: [
      { from: 'user', text: 'Hola, tienen mesa para 4 personas esta noche?' },
      { from: 'bot', text: 'Hola! Sí tenemos disponibilidad 🍽️ Para qué hora preferís? Tenemos desde las 19hs en adelante' },
      { from: 'user', text: 'Para las 20:30 estaría genial' },
      { from: 'bot', text: 'Perfecto! Mesa para 4 a las 20:30 ✅ Me decís tu nombre para la reserva?' },
    ],
  },
  {
    id: 'clinica',
    label: '🏥 Clínica',
    bot: 'Consultorio Bot',
    messages: [
      { from: 'user', text: 'Quiero turno con el cardiólogo' },
      { from: 'bot', text: 'Claro, con gusto te ayudo! Es primera consulta o control?' },
      { from: 'user', text: 'Primera consulta' },
      { from: 'bot', text: 'Entendido. Tenemos el martes a las 16hs o el jueves a las 10hs. Cuál te viene mejor?' },
    ],
  },
  {
    id: 'tienda',
    label: '🛍️ Tienda',
    bot: 'Sport Store Bot',
    messages: [
      { from: 'user', text: 'Tienen zapatillas Nike talle 42?' },
      { from: 'bot', text: 'Sí tenemos! Air Max y Revolution en ese talle 👟 Querés que te mande fotos y precios?' },
      { from: 'user', text: 'Sí por favor!' },
      { from: 'bot', text: 'Te mando ahora mismo! Y si querés podés pasar hoy, cerramos a las 20hs 😊' },
    ],
  },
] as const;

const STEPS = [
  {
    num: '1',
    icon: FileText,
    title: 'Subís tu info',
    desc: 'Cargás el menú, catálogo, precios o políticas de tu negocio en PDF, Word o Excel.',
  },
  {
    num: '2',
    icon: Zap,
    title: 'La IA aprende',
    desc: 'En minutos el bot procesa todo y queda listo para responder con tus datos reales.',
  },
  {
    num: '3',
    icon: MessageSquare,
    title: 'Tus clientes chatean',
    desc: 'Responde solo por WhatsApp, 24 horas al día. Sin intervención humana.',
  },
];

const SECTORS = [
  { emoji: '🍽️', name: 'Restaurantes', desc: 'Reservas, menú y pedidos automáticos' },
  { emoji: '🏥', name: 'Clínicas', desc: 'Turnos, especialidades y horarios' },
  { emoji: '🛍️', name: 'Tiendas', desc: 'Catálogo, stock y guía de compra' },
  { emoji: '✂️', name: 'Peluquerías', desc: 'Agenda de turnos sin llamadas' },
  { emoji: '🏠', name: 'Inmobiliarias', desc: 'Propiedades y visitas programadas' },
  { emoji: '📚', name: 'Academias', desc: 'Inscripciones, horarios y precios' },
];

const TESTIMONIALS = [
  {
    quote: 'Antes perdíamos clientes porque no respondíamos a tiempo. Ahora el bot responde solo y tenemos 40% más reservas.',
    name: 'Carlos M.',
    role: 'Restaurante Asunción',
    stars: 5,
    initials: 'CM',
  },
  {
    quote: 'Mis pacientes sacan turnos a las 11 de la noche sin llamar a nadie. Fue lo mejor que hice para el consultorio.',
    name: 'Dra. Laura S.',
    role: 'Consultorio Médico',
    stars: 5,
    initials: 'LS',
  },
  {
    quote: 'Se configura en minutos y mis clientes creen que hay una persona respondiendo. La calidad de las respuestas es increíble.',
    name: 'Miguel R.',
    role: 'Tienda de ropa',
    stars: 5,
    initials: 'MR',
  },
];

const PLANS = [
  {
    id: 'FREE',
    name: 'Free',
    gs: 0,
    features: ['1 bot', '3 documentos', '100 mensajes/mes'],
    wa: false,
    highlight: false,
    cta: 'Empezar gratis',
  },
  {
    id: 'STARTER',
    name: 'Básico',
    gs: 150000,
    features: ['1 bot', '10 documentos', '1.000 mensajes/mes', 'WhatsApp incluido'],
    wa: true,
    highlight: false,
    cta: 'Contratar',
  },
  {
    id: 'PRO',
    name: 'Profesional',
    gs: 350000,
    features: ['5 bots', '50 documentos', '10.000 mensajes/mes', 'WhatsApp incluido'],
    wa: true,
    highlight: true,
    cta: 'El más elegido',
  },
  {
    id: 'AGENCY',
    name: 'Agencia',
    gs: 750000,
    features: ['Bots ilimitados', 'Docs ilimitados', '100.000 mensajes/mes', 'WhatsApp incluido'],
    wa: true,
    highlight: false,
    cta: 'Contratar',
  },
];

const FAQS = [
  {
    q: '¿Necesito saber programar?',
    a: 'No. Todo se configura desde el panel de BotForge: subís tus documentos, elegís la personalidad del bot y listo. Sin código.',
  },
  {
    q: '¿Funciona con mi número de WhatsApp actual?',
    a: 'Sí. Se conecta a tu número de WhatsApp Business mediante Twilio. El proceso tarda menos de 10 minutos.',
  },
  {
    q: '¿Qué pasa si el bot no sabe responder algo?',
    a: 'El bot responde con honestidad que esa información no la tiene y sugiere escribir directamente al negocio. Nunca inventa respuestas.',
  },
  {
    q: '¿Puedo cambiar la personalidad del bot?',
    a: 'Sí, en cualquier momento desde el panel. También podés cambiar los documentos, el idioma y el nombre del bot cuando quieras.',
  },
  {
    q: '¿Cuánto tarda en estar listo?',
    a: 'Menos de 5 minutos para crear el bot. El procesamiento de documentos tarda 1-2 minutos más dependiendo del tamaño.',
  },
];

// ─── NAVBAR ──────────────────────────────────────────────────────────────────

function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-bold">BotForge</span>
        </div>
        <nav className="hidden items-center gap-6 md:flex">
          <a href="#como-funciona" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Cómo funciona</a>
          <a href="#precios" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Precios</a>
          <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild><Link href="/login">Ingresar</Link></Button>
          <Button size="sm" asChild><Link href="/register">Empezar gratis</Link></Button>
        </div>
      </div>
    </header>
  );
}

// ─── WHATSAPP CHAT DEMO ───────────────────────────────────────────────────────

type DemoMessage = { from: 'user' | 'bot'; text: string };

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#128c7e] text-xs text-white font-bold">B</div>
      <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1 py-0.5">
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

function WhatsAppChat({ demo, active }: { demo: typeof DEMOS[number]; active: boolean }) {
  const [step, setStep] = useState(-1);
  const [showTyping, setShowTyping] = useState(false);

  useEffect(() => {
    if (!active) return;
    setStep(-1);
    setShowTyping(false);
  }, [demo.id, active]);

  useEffect(() => {
    if (!active) return;

    if (step === -1) {
      const t = setTimeout(() => setStep(0), 600);
      return () => clearTimeout(t);
    }
    if (step >= demo.messages.length) {
      const t = setTimeout(() => { setStep(-1); }, 4500);
      return () => clearTimeout(t);
    }

    const msg = demo.messages[step];
    if (msg.from === 'bot') {
      setShowTyping(true);
      const t = setTimeout(() => {
        setShowTyping(false);
        setStep((s) => s + 1);
      }, 1800);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 300 : 1400);
      return () => clearTimeout(t);
    }
  }, [step, active, demo]);

  const visible: DemoMessage[] = step > 0 ? (demo.messages.slice(0, step) as DemoMessage[]) : [];

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-2xl" style={{ maxWidth: 340 }}>
      {/* WA Header */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: '#128c7e' }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold text-white">
          {demo.bot[0]}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{demo.bot}</p>
          <p className="text-xs text-green-200">en línea</p>
        </div>
      </div>

      {/* Chat area */}
      <div
        className="flex min-h-[260px] flex-col gap-2.5 p-3"
        style={{ background: '#e5ddd5', backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='2' cy='2' r='1' fill='%23c5b8ae' fill-opacity='.3'/%3E%3C/svg%3E\")" }}
      >
        {visible.map((msg, i) => (
          <div key={i} className={cn('flex items-end gap-2', msg.from === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.from === 'bot' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#128c7e] text-xs font-bold text-white">B</div>
            )}
            <div
              className={cn(
                'max-w-[76%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm',
                msg.from === 'user'
                  ? 'rounded-tr-sm text-gray-800'
                  : 'rounded-tl-sm bg-white text-gray-800',
              )}
              style={msg.from === 'user' ? { background: '#dcf8c6' } : {}}
            >
              {msg.text}
              <span className="ml-2 text-[10px] text-gray-400">
                {new Date().toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
        {showTyping && <TypingIndicator />}
      </div>

      {/* WA Input bar */}
      <div className="flex items-center gap-2 bg-[#f0f2f5] px-3 py-2">
        <div className="flex-1 rounded-full bg-white px-4 py-2 text-sm text-gray-400">Escribí un mensaje</div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: '#128c7e' }}>
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
        </div>
      </div>
    </div>
  );
}

function DemoSection() {
  const [activeIdx, setActiveIdx] = useState(0);

  return (
    <section className="py-20">
      <div className="container">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold">Mirá cómo responde tu bot</h2>
          <p className="mt-2 text-muted-foreground">Conversaciones reales con clientes reales</p>
        </div>

        {/* Tab selector */}
        <div className="mb-8 flex justify-center gap-2 flex-wrap">
          {DEMOS.map((d, i) => (
            <button
              key={d.id}
              onClick={() => setActiveIdx(i)}
              className={cn(
                'rounded-full px-5 py-2 text-sm font-medium transition-all',
                activeIdx === i
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Chat demo centered */}
        <div className="flex justify-center">
          <WhatsAppChat key={DEMOS[activeIdx].id} demo={DEMOS[activeIdx]} active />
        </div>
      </div>
    </section>
  );
}

// ─── HOW IT WORKS ────────────────────────────────────────────────────────────

function HowItWorksSection() {
  return (
    <section id="como-funciona" className="border-t bg-muted/30 py-20">
      <div className="container">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold">Cómo funciona</h2>
          <p className="mt-2 text-muted-foreground">Tres pasos y tu negocio ya no pierde consultas</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.num} className="relative flex flex-col items-center text-center">
              {i < STEPS.length - 1 && (
                <div className="absolute left-[calc(50%+48px)] top-10 hidden h-px w-[calc(100%-96px)] bg-border md:block" />
              )}
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
                <step.icon className="h-9 w-9 text-primary" />
              </div>
              <div className="mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {step.num}
              </div>
              <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── SECTORS ─────────────────────────────────────────────────────────────────

function SectorsSection() {
  return (
    <section className="py-20">
      <div className="container">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold">Para cualquier negocio</h2>
          <p className="mt-2 text-muted-foreground">Si tu negocio recibe mensajes, BotForge lo puede automatizar</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECTORS.map((s) => (
            <div key={s.name} className="flex items-center gap-4 rounded-xl border bg-card p-5 transition-shadow hover:shadow-md">
              <span className="text-4xl">{s.emoji}</span>
              <div>
                <p className="font-semibold">{s.name}</p>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── TESTIMONIALS ─────────────────────────────────────────────────────────────

function TestimonialsSection() {
  return (
    <section className="border-t bg-muted/30 py-20">
      <div className="container">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold">Lo que dicen nuestros clientes</h2>
          <p className="mt-2 text-muted-foreground">Negocios que ya automatizaron su atención</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="flex flex-col rounded-xl border bg-card p-6 shadow-sm">
              <div className="mb-4 flex gap-0.5">
                {Array.from({ length: t.stars }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                ))}
              </div>
              <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                &ldquo;{t.quote}&rdquo;
              </p>
              <div className="mt-5 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {t.initials}
                </div>
                <div>
                  <p className="text-sm font-semibold">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── PRICING ─────────────────────────────────────────────────────────────────

function PricingSection() {
  return (
    <section id="precios" className="py-20">
      <div className="container">
        <div className="mb-10 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-4 py-1.5 text-sm font-medium text-orange-700">
            🔥 Primeros 3 meses con 20% OFF
          </div>
          <h2 className="text-3xl font-bold">Precios simples, en guaraníes</h2>
          <p className="mt-2 text-muted-foreground">Empezá gratis. Escalá cuando crezcas. Cancelá cuando quieras.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                'relative flex flex-col rounded-xl border p-6',
                plan.highlight ? 'border-primary bg-primary/5 shadow-xl' : 'bg-card',
              )}
            >
              {plan.highlight && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground shadow">
                    ⭐ El más elegido
                  </span>
                </div>
              )}
              <div className="mb-5">
                <p className="font-semibold">{plan.name}</p>
                {plan.gs === 0 ? (
                  <p className="mt-1 text-3xl font-bold">Gratis</p>
                ) : (
                  <div className="mt-1">
                    <p className="text-2xl font-bold">Gs. {plan.gs.toLocaleString('es-PY')}</p>
                    <p className="text-xs text-muted-foreground">/mes</p>
                  </div>
                )}
              </div>
              <ul className="mb-6 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                variant={plan.highlight ? 'default' : 'outline'}
                className="w-full"
                asChild
              >
                <Link href="/register">
                  {plan.gs === 0 ? 'Empezar gratis' : 'Contratar'}
                </Link>
              </Button>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Sin tarjeta de crédito para el plan Free · Cancelá cuando quieras · Soporte incluido
        </p>
      </div>
    </section>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="faq" className="border-t bg-muted/30 py-20">
      <div className="container max-w-2xl">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold">Preguntas frecuentes</h2>
          <p className="mt-2 text-muted-foreground">Todo lo que necesitás saber antes de empezar</p>
        </div>
        <div className="space-y-1">
          {FAQS.map((faq, i) => (
            <div key={i} className="rounded-xl border bg-card overflow-hidden">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/50"
              >
                <span className="font-medium text-sm">{faq.q}</span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                    open === i && 'rotate-180',
                  )}
                />
              </button>
              {open === i && (
                <div className="border-t px-5 py-4">
                  <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FOOTER ──────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t py-12">
      <div className="container">
        <div className="flex flex-col items-center gap-6 md:flex-row md:justify-between">
          <div className="flex flex-col items-center gap-1 md:items-start">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
                <Zap className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold">BotForge</span>
            </div>
            <p className="text-sm text-muted-foreground">Chatbots con IA para negocios paraguayos</p>
            <p className="text-sm text-muted-foreground">Hecho en Paraguay 🇵🇾</p>
          </div>

          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <a href="#como-funciona" className="hover:text-foreground transition-colors">Características</a>
            <a href="#precios" className="hover:text-foreground transition-colors">Precios</a>
            <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
            <a href="mailto:hola@botforge.ai" className="hover:text-foreground transition-colors">hola@botforge.ai</a>
          </nav>

          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} BotForge. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      {/* HERO */}
      <section className="container flex flex-col items-center gap-6 pb-16 pt-20 text-center">
        <Badge variant="secondary" className="gap-1.5 px-4 py-1.5 text-sm">
          <Zap className="h-3.5 w-3.5 text-primary" />
          Sin tarjeta de crédito · Gratis para empezar
        </Badge>

        <h1 className="max-w-3xl text-5xl font-bold tracking-tight leading-tight sm:text-6xl">
          Tu negocio responde solo,{' '}
          <span className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
            las 24 horas
          </span>
        </h1>

        <p className="max-w-xl text-lg text-muted-foreground">
          ¿Cuántos clientes perdés porque no podés responder WhatsApp a tiempo?
          BotForge crea un chatbot con IA que conoce tu negocio y responde por vos —
          menú, precios, turnos, todo.
        </p>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Button size="lg" className="gap-2 px-8 text-base shadow-lg shadow-primary/25" asChild>
            <Link href="/register">
              Empezar gratis ahora <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">Listo en menos de 5 minutos</p>
        </div>

        {/* Stats strip */}
        <div className="mt-6 flex flex-wrap justify-center gap-8">
          {[
            { val: '5 min', label: 'para configurar' },
            { val: '24/7', label: 'responde solo' },
            { val: '0', label: 'código necesario' },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-2xl font-bold text-primary">{s.val}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <DemoSection />
      <HowItWorksSection />
      <SectorsSection />
      <TestimonialsSection />
      <PricingSection />
      <FaqSection />

      {/* FINAL CTA */}
      <section className="bg-gradient-to-r from-violet-600 to-indigo-600 py-20 text-white">
        <div className="container flex flex-col items-center gap-5 text-center">
          <h2 className="text-4xl font-bold">Empezá hoy. Tu primer bot, gratis.</h2>
          <p className="text-lg text-violet-100">
            Más de 5 minutos esperando no le cuesta solo tiempo — le cuesta clientes.
          </p>
          <Button size="lg" variant="secondary" className="gap-2 px-10 text-base font-semibold" asChild>
            <Link href="/register">
              Crear mi bot ahora <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <p className="text-sm text-violet-200">Sin tarjeta de crédito · Cancelá cuando quieras</p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
