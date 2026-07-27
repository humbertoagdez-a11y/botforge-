import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, randomInt } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { authLimiter, forgotPasswordLimiter, resendVerificationLimiter } from '../middleware/rateLimit';
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
      <p style="font-size:14px;line-height:1.9;color:#333333;margin:0 0 20px;">
        1. Creá tu bot con nombre y personalidad<br />
        2. Cargá tu instructivo con la info de tu negocio<br />
        3. Conectá tu WhatsApp y dejalo responder solo
      </p>
      <p style="font-size:14px;line-height:1.6;color:#333333;margin:0 0 28px;">
        Y si te trabás en algo, escribile al Asistente que está siempre en el panel: te guía paso a paso.
      </p>
      <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 16px;" />
      <p style="font-size:12px;color:#888888;margin:0;">
        Si no creaste esta cuenta, ignorá este email.
      </p>
    </div>
  </body>
</html>`;
}

// ─── Verificación de email ────────────────────────────────────────────────────

const VERIFICATION_TTL_MS = 15 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;

function verificationEmailHtml(name: string, code: string): string {
  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:22px;font-weight:bold;color:#7C3AED;margin:0 0 24px;">BotForge</p>
      <p style="font-size:16px;margin:0 0 12px;">Hola ${name},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
        Usá este código para confirmar tu email y activar tu cuenta:
      </p>
      <p style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:bold;letter-spacing:10px;color:#111111;background:#F5F3FF;border:1px solid #DDD6FE;border-radius:10px;text-align:center;padding:18px 8px;margin:0 0 20px;">${code}</p>
      <p style="font-size:14px;line-height:1.6;color:#333333;margin:0 0 28px;">
        El código vence en <strong>15 minutos</strong>.
      </p>
      <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 16px;" />
      <p style="font-size:12px;color:#888888;margin:0;">
        Si no creaste una cuenta en BotForge, ignorá este email.
      </p>
    </div>
  </body>
</html>`;
}

/**
 * Genera y envía un código nuevo, invalidando los anteriores del usuario.
 * randomInt (CSPRNG) y no Math.random: el código no debe ser predecible.
 */
async function issueVerificationCode(user: { id: string; email: string; name: string }): Promise<void> {
  await prisma.emailVerificationCode.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  await prisma.emailVerificationCode.create({
    data: {
      id: uuidv4(),
      userId: user.id,
      code,
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });

  // Solo fuera de producción: permite probar sin email configurado
  if (env.NODE_ENV !== 'production') {
    console.log(`[auth] Código de verificación para ${user.email}: ${code}`);
  }

  void sendEmail(user.email, 'Tu código de verificación de BotForge', verificationEmailHtml(user.name, code));
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

/** Emite tokens + cookies. Solo se llama con el email ya verificado. */
async function issueSession(res: Response, user: { id: string; email: string }): Promise<string> {
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
  return accessToken;
}

router.post('/register', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new AppError(409, 'El email ya está registrado');

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: { id: uuidv4(), name: body.name, email: body.email, passwordHash },
      select: { id: true, name: true, email: true },
    });

    // Sin tokens hasta verificar: la sesión se emite recién en /verify-email.
    // El email de bienvenida también espera a la verificación.
    await issueVerificationCode(user);

    res.status(201).json({ data: { needsVerification: true, email: user.email }, error: null, meta: null });
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

    // Recién acá, con la contraseña ya validada: si el chequeo fuera antes,
    // cualquiera podría averiguar si un email está registrado sin conocerla.
    if (!user.emailVerified) {
      throw new AppError(
        403,
        'Tu email todavía no está verificado. Revisá tu casilla o pedí un código nuevo.',
        'EMAIL_NOT_VERIFIED',
      );
    }

    const accessToken = await issueSession(res, user);
    res.json({
      data: { id: user.id, name: user.name, email: user.email, plan: user.plan, accessToken },
      error: null,
      meta: null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /verify-email ───────────────────────────────────────────────────────
const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().trim().regex(/^\d{6}$/, 'El código tiene 6 dígitos'),
});

router.post('/verify-email', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, code } = verifyEmailSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    // Mismo error genérico si el usuario no existe: no revelar emails registrados
    if (!user) throw new AppError(400, 'Código inválido o vencido', 'VERIFICATION_INVALID');

    if (user.emailVerified) {
      // Ya estaba verificado (doble click, otra pestaña): no emitir sesión sin
      // contraseña, que entre por login
      res.json({ data: { alreadyVerified: true }, error: null, meta: null });
      return;
    }

    const stored = await prisma.emailVerificationCode.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!stored) throw new AppError(400, 'Código inválido o vencido', 'VERIFICATION_INVALID');

    // El intento se cobra SIEMPRE, antes de comparar: así la fuerza bruta
    // quema el código aunque adivine tarde
    const updated = await prisma.emailVerificationCode.update({
      where: { id: stored.id },
      data: { attempts: { increment: 1 } },
    });

    if (updated.attempts > MAX_VERIFICATION_ATTEMPTS) {
      await prisma.emailVerificationCode.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      });
      throw new AppError(
        429,
        'Demasiados intentos. Pedí un código nuevo.',
        'VERIFICATION_LOCKED',
      );
    }

    if (stored.expiresAt < new Date() || stored.code !== code) {
      throw new AppError(400, 'Código inválido o vencido', 'VERIFICATION_INVALID');
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true, emailVerifiedAt: new Date() },
      }),
      prisma.emailVerificationCode.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // La bienvenida se manda SOLO acá: con el email ya confirmado como real
    void sendEmail(user.email, 'Bienvenido a BotForge', welcomeEmailHtml(user.name));

    const accessToken = await issueSession(res, user);
    res.json({
      data: { id: user.id, name: user.name, email: user.email, plan: user.plan, accessToken },
      error: null,
      meta: null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /resend-verification ────────────────────────────────────────────────
const resendSchema = z.object({ email: z.string().email() });

// Responde siempre { sent: true }, exista o no el usuario y esté verificado o
// no: cualquier diferencia serviría para enumerar emails registrados.
router.post(
  '/resend-verification',
  resendVerificationLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = resendSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email } });

      if (user && !user.emailVerified) {
        await issueVerificationCode(user);
      }

      res.json({ data: { sent: true }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  },
);

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
