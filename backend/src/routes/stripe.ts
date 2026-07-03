import { Router, Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import type { Plan } from '@prisma/client';

const router = Router();

function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(503, 'Pagos no configurados aún', 'STRIPE_NOT_CONFIGURED');
  }
  return new Stripe(env.STRIPE_SECRET_KEY);
}

// Mapa plan → priceId de Stripe (configurable por env)
function getPriceId(plan: 'STARTER' | 'PRO' | 'AGENCY'): string {
  const prices: Record<string, string | undefined> = {
    STARTER: env.STRIPE_PRICE_STARTER,
    PRO: env.STRIPE_PRICE_PRO,
    AGENCY: env.STRIPE_PRICE_AGENCY,
  };
  const id = prices[plan];
  if (!id) {
    throw new AppError(503, 'Pagos no configurados aún', 'STRIPE_NOT_CONFIGURED');
  }
  return id;
}

const checkoutSchema = z.object({
  plan: z.enum(['STARTER', 'PRO', 'AGENCY']),
});

// ─── POST /checkout — crea sesión de Stripe Checkout ─────────────────────────
router.post('/checkout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { plan } = checkoutSchema.parse(req.body);
    const stripe = getStripe();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.name });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: getPriceId(plan), quantity: 1 }],
      success_url: `${env.FRONTEND_URL}/dashboard?upgrade=success`,
      cancel_url: `${env.FRONTEND_URL}/pricing`,
      metadata: { userId: user.id, plan },
      subscription_data: { metadata: { userId: user.id, plan } },
    });

    res.json({ data: { url: session.url }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /portal — portal de cliente Stripe ──────────────────────────────────
router.post('/portal', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stripe = getStripe();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });

    if (!user.stripeCustomerId) throw new AppError(400, 'No tenés una suscripción activa');

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${env.FRONTEND_URL}/dashboard`,
    });

    res.json({ data: { url: session.url }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /webhook — recibe eventos de Stripe ────────────────────────────────
router.post(
  '/webhook',
  // body-parser desactivado para este endpoint (necesitamos el raw body)
  async (req: Request, res: Response) => {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
      res.sendStatus(200);
      return;
    }

    const stripe = getStripe();
    const sig = req.headers['stripe-signature'] as string;

    let event: Stripe.Event;
    try {
      // req.body ya es Buffer gracias a la configuración en index.ts
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        sig,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      res.status(400).send('Webhook signature verification failed');
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.metadata?.userId;
          const plan = session.metadata?.plan as Plan | undefined;
          if (userId && plan) {
            await prisma.user.update({
              where: { id: userId },
              data: {
                plan,
                stripeSubscriptionId: session.subscription as string,
              },
            });
          }
          break;
        }
        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription;
          const userId = sub.metadata.userId;
          const plan = sub.metadata.plan as Plan | undefined;
          if (userId) {
            await prisma.user.update({
              where: { id: userId },
              data: {
                ...(plan ? { plan } : {}),
                planExpiresAt: new Date(((sub as unknown as { current_period_end: number }).current_period_end ?? 0) * 1000),
              },
            });
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          const userId = sub.metadata.userId;
          if (userId) {
            await prisma.user.update({
              where: { id: userId },
              data: { plan: 'FREE', stripeSubscriptionId: null, planExpiresAt: null },
            });
          }
          break;
        }
      }
    } catch (err) {
      console.error('[stripe] Error procesando webhook:', err);
    }

    res.sendStatus(200);
  },
);

export default router;
