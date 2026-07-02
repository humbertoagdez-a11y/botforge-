import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';

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
        from: 'BotForge <noreply@botforge.com.py>',
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
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
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
      select: { id: true, name: true, email: true, plan: true, createdAt: true },
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

    setAuthCookies(res, accessToken, newRefresh);
    res.json({ data: { ok: true }, error: null, meta: null });
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
      select: { id: true, name: true, email: true, plan: true, createdAt: true },
    });
    res.json({ data: user, error: null, meta: null });
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
      select: { id: true, name: true, email: true, plan: true, createdAt: true },
    });
    res.json({ data: user, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

export default router;
