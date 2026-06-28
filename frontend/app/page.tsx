import Link from 'next/link';
import { Bot, FileText, MessageSquare, Smartphone, Zap, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const FEATURES = [
  {
    icon: FileText,
    title: 'Base de conocimiento inteligente',
    desc: 'Subí tus PDFs, Word y Excel. El sistema extrae el texto, lo divide en fragmentos y los indexa automáticamente para búsqueda semántica.',
  },
  {
    icon: Bot,
    title: 'IA con Claude de Anthropic',
    desc: 'Cada respuesta se genera con Claude, el modelo de IA más avanzado. El bot busca contexto relevante antes de responder para máxima precisión.',
  },
  {
    icon: Smartphone,
    title: 'Integración con WhatsApp',
    desc: 'Conectá tu bot a un número de WhatsApp Business. Tus clientes chatean naturalmente y reciben respuestas 24/7 sin intervención humana.',
  },
];

const PLANS = [
  { name: 'Free', price: '0', bots: '1 bot', docs: '3 documentos', msgs: '100 mensajes', wa: false, highlight: false },
  { name: 'Starter', price: '29', bots: '1 bot', docs: '10 documentos', msgs: '1.000 mensajes', wa: true, highlight: false },
  { name: 'Pro', price: '79', bots: '5 bots', docs: '50 documentos', msgs: '10.000 mensajes', wa: true, highlight: true },
  { name: 'Agency', price: '199', bots: 'Ilimitados', docs: 'Ilimitados', msgs: '100.000 mensajes', wa: true, highlight: false },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold">BotForge</span>
          </div>
          <nav className="hidden items-center gap-6 md:flex">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Características</a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Precios</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild><Link href="/login">Ingresar</Link></Button>
            <Button size="sm" asChild><Link href="/register">Empezar gratis</Link></Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="container flex flex-col items-center gap-6 py-24 text-center">
        <Badge variant="secondary" className="gap-1.5">
          <Zap className="h-3 w-3" /> Impulsado por Claude AI
        </Badge>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          Crea tu chatbot inteligente{' '}
          <span className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
            en minutos
          </span>
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Subí tus documentos, personalizá la personalidad del bot y conectalo a WhatsApp.
          La IA hace el resto — respuestas precisas basadas en tu contenido, 24/7.
        </p>
        <div className="flex gap-3">
          <Button size="lg" asChild><Link href="/register">Empezar gratis</Link></Button>
          <Button size="lg" variant="outline" asChild><Link href="/login">Ver demo</Link></Button>
        </div>
        {/* Visual mockup */}
        <div className="mt-8 w-full max-w-2xl overflow-hidden rounded-xl border bg-card shadow-2xl">
          <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-3">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
            <span className="ml-2 text-xs text-muted-foreground">Bot de Atención al Cliente</span>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex justify-end">
              <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2 text-sm text-primary-foreground max-w-xs">
                ¿Cuáles son los horarios de atención?
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">B</div>
              <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-2 text-sm max-w-xs">
                Nuestros horarios de atención son de lunes a viernes de 9:00 a 18:00 hs. Los sábados atendemos de 9:00 a 13:00 hs.
              </div>
            </div>
            <div className="flex justify-end">
              <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2 text-sm text-primary-foreground max-w-xs">
                ¿Tienen envíos a domicilio?
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">B</div>
              <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-2 text-sm max-w-xs">
                Sí, realizamos envíos a todo el país. El costo varía según la zona y el peso del pedido. Los envíos al AMBA son gratuitos para compras mayores a $50.000.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t bg-muted/30 py-20">
        <div className="container">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold">Todo lo que necesitás</h2>
            <p className="mt-2 text-muted-foreground">Tecnología de punta, sin complicaciones</p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border bg-card p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20">
        <div className="container">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold">Precios simples</h2>
            <p className="mt-2 text-muted-foreground">Empezá gratis, escalá cuando crezcas</p>
          </div>
          <div className="grid gap-6 md:grid-cols-4">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative flex flex-col rounded-xl border p-6 ${plan.highlight ? 'border-primary bg-primary/5 shadow-lg' : 'bg-card'}`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="text-xs">Popular</Badge>
                  </div>
                )}
                <div className="mb-4">
                  <p className="font-semibold">{plan.name}</p>
                  <p className="mt-1">
                    <span className="text-3xl font-bold">${plan.price}</span>
                    <span className="text-muted-foreground">/mes</span>
                  </p>
                </div>
                <ul className="mb-6 flex-1 space-y-2 text-sm text-muted-foreground">
                  {[plan.bots, plan.docs, plan.msgs, ...(plan.wa ? ['WhatsApp incluido'] : [])].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button variant={plan.highlight ? 'default' : 'outline'} className="w-full" asChild>
                  <Link href="/register">Empezar</Link>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-gradient-to-r from-violet-600 to-indigo-600 py-20 text-white">
        <div className="container text-center">
          <h2 className="text-3xl font-bold">¿Listo para automatizar tu atención al cliente?</h2>
          <p className="mt-3 text-violet-100">Creá tu primer bot en menos de 5 minutos. Sin tarjeta de crédito.</p>
          <Button size="lg" variant="secondary" className="mt-8" asChild>
            <Link href="/register">Empezar gratis ahora</Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container flex flex-col items-center gap-2 text-center text-sm text-muted-foreground md:flex-row md:justify-between md:text-left">
          <div className="flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground">BotForge</span>
          </div>
          <p>© {new Date().getFullYear()} BotForge. Todos los derechos reservados.</p>
          <div className="flex gap-4">
            <a href="#" className="hover:text-foreground">Privacidad</a>
            <a href="#" className="hover:text-foreground">Términos</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
