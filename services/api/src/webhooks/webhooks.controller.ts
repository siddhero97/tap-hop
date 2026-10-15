import { Request, Response } from 'express';
import { PayPalGateway } from '../payments/payments.gateway.js';
import { WebhookService } from './webhooks.service.js';
import { getServices } from '../lib/app-services.js';
import { logger } from '../lib/logger.js';

/**
 * Process webhook event and return appropriate response
 * Always returns 200 for webhooks (PayPal doesn't retry on 4xx)
 */
async function processWebhookEvent(
  service: WebhookService,
  headers: Record<string, string>,
  rawBody: string,
  paypalGateway: PayPalGateway
): Promise<any> {
  try {
    await service.processPayPalEvent(headers, rawBody, paypalGateway);
    logger.info('Webhook processed successfully');
    return {
      status: 200,
      body: { status: 'success' },
    };
  } catch (processingError) {
    logger.warn(
      { error: String(processingError) },
      'Webhook processing failed'
    );
    return {
      status: 200,
      body: {
        status: 'error',
        code: 'PROCESSING_ERROR',
        message: (processingError as Error).message,
      },
    };
  }
}

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
