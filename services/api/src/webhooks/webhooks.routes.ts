import { Router, Request, Response, NextFunction } from 'express';
import { handlePayPalWebhook } from './webhooks.controller.js';

const router = Router();

/**
 * Middleware to capture raw body for webhook signature verification
 */
function rawBodyMiddleware(req: Request, _res: Response, next: NextFunction): void {
  let rawBody = '';
  req.on('data', (chunk) => {
    rawBody += chunk.toString();
  });
  req.on('end', () => {
    (req as any).rawBody = rawBody;
    next();
  });
}

router.use(rawBodyMiddleware);

/**
 * POST /webhooks/paypal - Receive and process PayPal webhook events
 */
router.post('/', handlePayPalWebhook);

export { router as webhooksRouter };
