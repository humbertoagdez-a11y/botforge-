import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  PINECONE_API_KEY: z.string().min(1),
  PINECONE_INDEX: z.string().default('botforge'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  // Canal Twilio: apagado por defecto. El codigo queda intacto y se reactiva
  // poniendo TWILIO_WHATSAPP_ENABLED=true, sin redeploy de codigo.
  TWILIO_WHATSAPP_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  // Meta Cloud API (WhatsApp). Conviven con Twilio durante la migracion.
  META_VERIFY_TOKEN: z.string().optional().default(''),
  META_WHATSAPP_TOKEN: z.string().optional().default(''),
  META_PHONE_NUMBER_ID: z.string().optional().default(''),
  // Numero de WhatsApp Business en formato legible: es el que ve el cliente en
  // las instrucciones de conexion, el que corresponde a META_PHONE_NUMBER_ID.
  // No confundir con META_PHONE_NUMBER_ID, que es el id interno de Meta.
  META_WHATSAPP_DISPLAY_NUMBER: z.string().optional().default('+595991820602'),
  // Pagopar: pasarela activa. La private key solo se usa para firmar tokens
  // sha1, nunca viaja en una URL ni se loguea.
  PAGOPAR_PUBLIC_KEY: z.string().optional().default(''),
  PAGOPAR_PRIVATE_KEY: z.string().optional().default(''),
  // Stripe: dado de baja, el codigo queda por si hay que volver atras
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_AGENCY: z.string().optional(),
  RESEND_API_KEY: z.string().optional().default(''),
  // Remitente unico de todos los emails. El dominio tiene que estar verificado
  // en Resend o los envios se rechazan con 403.
  EMAIL_FROM: z.string().optional().default('BotForge <noreply@mibotforge.com>'),
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  TAVILY_API_KEY: z.string().optional().default(''),
  FIRECRAWL_API_KEY: z.string().optional().default(''),
  DEEPGRAM_API_KEY: z.string().optional().default(''),
  GOOGLE_VISION_API_KEY: z.string().optional().default(''),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  // URL publica del backend: la usa la validacion de firma de Twilio.
  // En Railway DEBE ser https://botforge-production-b16f.up.railway.app
  BACKEND_URL: z.string().default('http://localhost:3001'),
  UPLOADS_DIR: z.string().default('./uploads'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
