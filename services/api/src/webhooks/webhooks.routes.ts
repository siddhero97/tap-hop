import { Router } from 'express';
import { validateRawBodyMiddleware } from '../middleware/validate.js';
import { RawBodySchema } from './webhooks.validator.js';
import { handlePayPalWebhook } from './webhooks.controller.js';

const router: Router = Router();

/**
 * POST /webhooks/paypal - Receive and process PayPal webhook events
 */
router.post('/paypal', validateRawBodyMiddleware(RawBodySchema, 'EMPTY_PAYLOAD'), handlePayPalWebhook);

export { router as webhooksRouter };
