import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://botforge.ai'),
  title: {
    default: 'BotForge — Tu negocio responde solo, las 24 horas',
    template: '%s | BotForge',
  },
  description:
    'Crea un chatbot con IA para tu negocio en menos de 5 minutos. Conectado a WhatsApp. Sin saber programar. Ideal para restaurantes, clínicas, tiendas y más negocios en Paraguay.',
  keywords: ['chatbot WhatsApp Paraguay', 'bot IA negocio', 'atención al cliente automatizada', 'BotForge'],
  authors: [{ name: 'BotForge' }],
  openGraph: {
    title: 'BotForge — Tu negocio responde solo, las 24 horas',
    description: 'Chatbots con IA para negocios paraguayos. Conectado a WhatsApp. Sin programar.',
    url: 'https://botforge.ai',
    siteName: 'BotForge',
    locale: 'es_PY',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BotForge — Chatbots con IA para tu negocio',
    description: 'Crea tu bot en 5 minutos y respondé clientes 24/7 por WhatsApp.',
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={inter.className}>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
