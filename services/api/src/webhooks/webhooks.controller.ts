import { Request, Response } from 'express';
import { processWebhookEvent } from './webhooks.service.js';
import { getServices } from '../lib/app-services.js';
import { logger } from '../lib/logger.js';

/**
 * POST /webhooks/paypal - Receive and process PayPal webhook events
 * Always returns 200 (PayPal expects 200 for all responses)
 */
export async function handlePayPalWebhook(req: Request, res: Response): Promise<void> {
  try {
    const { gateway: paypalGateway, webhookService: service } = getServices(req);
    const rawBody = (req as any).rawBody;
    const headers = req.headers as Record<string, string>;

    // Process webhook event
    const response = await processWebhookEvent(service, headers, rawBody, paypalGateway);
    res.status(response.status).json(response.body);
  } catch (error) {
    logger.error(
      { error: String(error) },
      'Error handling webhook'
    );
    res.status(200).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
    });
  }
}
