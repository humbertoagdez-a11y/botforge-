import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { authLimiter, forgotPasswordLimiter } from '../middleware/rateLimit';
import { sendEmail } from '../services/email';

const router = Router();

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function welcomeEmailHtml(name: string): string {
  const dashboardUrl = `${env.FRONTEND_URL}/dashboard`;
  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:22px;font-weight:bold;color:#7C3AED;margin:0 0 24px;">BotForge</p>
      <p style="font-size:16px;margin:0 0 12px;">Hola ${name},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
        Tu cuenta está lista. Ya podés crear tu primer bot y conectarlo a WhatsApp.
      </p>
      <a href="${dashboardUrl}"
         style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:8px;margin:0 0 28px;">
        Ir al dashboard
      </a>
      <p style="font-size:14px;line-height:1.9;color:#333333;margin:0 0 28px;">
        1. Creá tu bot con nombre y personalidad<br />
        2. Subí el instructivo con la info de tu negocio<br />
        3. Conectá tu WhatsApp y dejalo responder solo
      </p>
      <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 16px;" />
      <p style="font-size:12px;color:#888888;margin:0;">
        Si no creaste esta cuenta, ignorá este email.
      </p>
    </div>
  </body>
</html>`;
}

async function sendWelcomeEmail(email: string, name: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY no configurada — se omite email de bienvenida a ${email}`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [email],
        subject: 'Bienvenido a BotForge',
        html: welcomeEmailHtml(name),
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend respondió ${res.status} al enviar bienvenida a ${email}`);
    }
  } catch (err) {
    console.error('[email] Error al enviar email de bienvenida:', err);
  }
}

function signTokens(userId: string, email: string) {
  const accessToken = jwt.sign({ userId, email }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
  const refreshToken = jwt.sign({ userId, email }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
  return { accessToken, refreshToken };
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const isProd = env.NODE_ENV === 'production';
  // En produccion frontend y backend viven en dominios distintos (Railway),
  // asi que las cookies necesitan SameSite=None para viajar cross-site
  const sameSite = isProd ? ('none' as const) : ('lax' as const);
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth/refresh',
  });
}

router.post('/register', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new AppError(409, 'El email ya está registrado');

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: { id: uuidv4(), name: body.name, email: body.email, passwordHash },
      select: { id: true, name: true, email: true, plan: true, documento: true, createdAt: true },
    });

    const { accessToken, refreshToken } = signTokens(user.id, user.email);
    await prisma.refreshToken.create({
      data: {
        id: uuidv4(),
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    setAuthCookies(res, accessToken, refreshToken);
    res.status(201).json({ data: { ...user, accessToken }, error: null, meta: null });

    // Email de bienvenida: opcional, nunca bloquea ni rompe el registro
    void sendWelcomeEmail(user.email, user.name);
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) throw new AppError(401, 'Credenciales inválidas');

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) throw new AppError(401, 'Credenciales inválidas');

    const { accessToken, refreshToken } = signTokens(user.id, user.email);
    await prisma.refreshToken.create({
      data: {
        id: uuidv4(),
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    setAuthCookies(res, accessToken, refreshToken);
    res.json({
      data: { id: user.id, name: user.name, email: user.email, plan: user.plan, accessToken },
      error: null,
      meta: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.refreshToken as string | undefined;
    if (!token) throw new AppError(401, 'No autenticado');

    const stored = await prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError(401, 'Refresh token inválido o expirado');
    }

    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as {
      userId: string;
      email: string;
    };

    await prisma.refreshToken.delete({ where: { token } });
    const { accessToken, refreshToken: newRefresh } = signTokens(payload.userId, payload.email);
    await prisma.refreshToken.create({
      data: {
        id: uuidv4(),
        token: newRefresh,
        userId: payload.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: payload.userId },
      select: { id: true, name: true, email: true, plan: true, documento: true, createdAt: true },
    });

    setAuthCookies(res, accessToken, newRefresh);
    res.json({ data: { accessToken, user }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.refreshToken as string | undefined;
    if (token) {
      await prisma.refreshToken.deleteMany({ where: { token } });
    }
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' });
    res.json({ data: { ok: true }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

const profileSchema = z.object({
  name: z.string().min(2).max(100),
});

router.put('/profile', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = profileSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { name },
      select: { id: true, name: true, email: true, plan: true, documento: true, createdAt: true },
    });
    res.json({ data: user, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /documento ───────────────────────────────────────────────────────────
// Endpoint propio en vez de sumarlo a PUT /profile: ese exige `name` y no
// acepta campos parciales, y aflojarlo obligaria a que quien solo quiere
// guardar el documento mande tambien el nombre.
const documentoSchema = z.object({
  documento: z
    .string()
    .trim()
    .regex(/^\d{6,9}$/, 'El documento debe tener entre 6 y 9 dígitos, sin puntos ni guiones'),
});

router.put('/documento', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { documento } = documentoSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { documento },
      select: { id: true, name: true, email: true, plan: true, documento: true, createdAt: true },
    });
    res.json({ data: user, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// ─── Recuperación de contraseña ───────────────────────────────────────────────

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hora
const INVALID_TOKEN_CODE = 'INVALID_TOKEN';

function resetPasswordEmailHtml(name: string, resetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:22px;font-weight:bold;color:#7C3AED;margin:0 0 24px;">BotForge</p>
      <p style="font-size:16px;margin:0 0 12px;">Hola ${name},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
        Recibimos un pedido para restablecer la contraseña de tu cuenta.
        Hacé clic en el botón para elegir una nueva.
      </p>
      <a href="${resetUrl}"
         style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:8px;margin:0 0 24px;">
        Cambiar mi contraseña
      </a>
      <p style="font-size:14px;line-height:1.6;color:#333333;margin:0 0 8px;">
        Este enlace vence en <strong>1 hora</strong> y se puede usar una sola vez.
      </p>
      <p style="font-size:13px;line-height:1.6;color:#666666;margin:0 0 28px;">
        Si el botón no funciona, copiá y pegá esta dirección en tu navegador:<br />
        <span style="color:#7C3AED;word-break:break-all;">${resetUrl}</span>
      </p>
      <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 16px;" />
      <p style="font-size:12px;color:#888888;margin:0;">
        Si no pediste esto, ignorá este email. Tu contraseña actual sigue funcionando.
      </p>
    </div>
  </body>
</html>`;
}

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

/**
 * POST /forgot-password — público.
 *
 * Responde siempre lo mismo exista o no el email: si contestara distinto,
 * cualquiera podría usar este endpoint para averiguar qué direcciones están
 * registradas en BotForge.
 */
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

      if (user) {
        // Invalidar los pedidos anteriores: solo el último link debe servir
        await prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });

        // randomBytes y no uuid: el token tiene que ser impredecible
        const token = randomBytes(32).toString('hex');
        await prisma.passwordResetToken.create({
          data: {
            id: uuidv4(),
            userId: user.id,
            token,
            expiresAt: new Date(Date.now() + RESET_TTL_MS),
          },
        });

        const resetUrl = `${env.FRONTEND_URL}/auth/reset-password?token=${token}`;

        // Solo fuera de producción: permite probar el flujo sin email configurado.
        // Nunca en producción, donde el log daría acceso a cualquier cuenta.
        if (env.NODE_ENV !== 'production') {
          console.log(`[auth] Link de reseteo para ${user.email}: ${resetUrl}`);
        }

        void sendEmail(user.email, 'Recuperá tu contraseña de BotForge', resetPasswordEmailHtml(user.name, resetUrl));
      }

      res.json({ data: { sent: true }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  },
);

/** Busca un token utilizable: existe, sin usar y sin vencer */
async function findUsableResetToken(token: string) {
  if (!token) return null;
  const stored = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!stored || stored.usedAt || stored.expiresAt < new Date()) return null;
  return stored;
}

// GET /reset-password/verify?token=xxx — público
// Deja que el frontend avise "este link venció" antes de pedir la contraseña
router.get('/reset-password/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const stored = await findUsableResetToken(token);
    res.json({ data: { valid: stored !== null }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

// POST /reset-password — público
router.post('/reset-password', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);

    const stored = await findUsableResetToken(token);
    if (!stored) {
      throw new AppError(400, 'El link expiró o no es válido', INVALID_TOKEN_CODE);
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      // Un solo uso: marcarlo antes de que alguien reintente con el mismo link
      prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      // Cierra cualquier sesión abierta con la contraseña vieja
      prisma.refreshToken.deleteMany({ where: { userId: stored.userId } }),
    ]);

    console.log(`[auth] Contraseña restablecida para el usuario ${stored.userId}`);

    res.json({ data: { success: true }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

router.put('/password', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = passwordSchema.parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError(400, 'Contraseña actual incorrecta');

    if (currentPassword === newPassword) {
      throw new AppError(400, 'La nueva contraseña no puede ser igual a la actual');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    res.json({ data: { success: true }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.userId },
      select: { id: true, name: true, email: true, plan: true, documento: true, createdAt: true },
    });
    res.json({ data: user, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

export default router;
