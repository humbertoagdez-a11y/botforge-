import { Router, Request, Response } from 'express';
import { env } from '../config/env';

/**
 * Router de Meta Cloud API (WhatsApp).
 *
 * Convive con el router de Twilio (routes/whatsapp.ts): ambos se montan en
 * /api/v1/whatsapp. Este solo define el GET de verificacion, asi que el POST
 * del webhook de Twilio sigue resolviendose en el router de Twilio sin cambios.
 *
 * El POST que procesa los mensajes entrantes de Meta todavia no esta
 * implementado — se agrega una vez confirmada la verificacion.
 */
const router = Router();

// ─── GET /webhook ─────────────────────────────────────────────────────────────
// Meta llama a esta URL al guardar el callback en el panel de la app.
// Publico: Meta no envia ninguna credencial nuestra, solo el verify token.
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Sin token configurado no se puede verificar nada: rechazar siempre.
  // Evita que un META_VERIFY_TOKEN vacio valide cualquier request.
  if (!env.META_VERIFY_TOKEN) {
    console.warn('[meta] GET /webhook rechazado: META_VERIFY_TOKEN no esta configurado');
    res.status(403).send('Forbidden');
    return;
  }

  if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN && typeof challenge === 'string') {
    console.log('[meta] Webhook verificado correctamente');
    res.status(200).type('text/plain').send(challenge);
    return;
  }

  console.warn('[meta] GET /webhook rechazado: mode o verify_token invalidos');
  res.status(403).send('Forbidden');
});

export default router;
