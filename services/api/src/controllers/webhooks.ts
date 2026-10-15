import { Request, Response } from 'express';
import { PayPalGateway } from '../modules/payments/gateway.js';
import { WebhookService } from '../modules/webhooks/service.js';
import { logger } from '../lib/logger.js';

/**
 * POST /webhooks/paypal - Receive and process PayPal webhook events
 * Always returns 200 (PayPal expects 200 for all responses)
 */
export async function handlePayPalWebhook(req: Request, res: Response): Promise<void> {
  try {
    const { gateway, webhookService } = req.app.locals;
    const rawBody = (req as any).rawBody;
    const headers = req.headers as Record<string, string>;

    if (!gateway || !('verifyWebhook' in gateway)) {
      logger.error('Payment gateway not configured');
      // Still return 200 because PayPal doesn't retry on 4xx
      res.status(200).json({
        status: 'error',
        code: 'GATEWAY_NOT_CONFIGURED',
      });
      return;
    }

    if (!webhookService || !('processPayPalEvent' in webhookService)) {
      logger.error('Webhook service not configured');
      // Still return 200 because PayPal doesn't retry on 4xx
      res.status(200).json({
        status: 'error',
        code: 'SERVICE_NOT_CONFIGURED',
      });
      return;
    }

    const paypalGateway = gateway as PayPalGateway;
    const service = webhookService as WebhookService;

    // Validate raw body is not empty
    if (!rawBody) {
      logger.warn('Received empty webhook payload');
      res.status(200).json({
        status: 'error',
        code: 'EMPTY_PAYLOAD',
      });
      return;
    }

    try {
      // Process webhook event
      await service.processPayPalEvent(headers, rawBody, paypalGateway);

      logger.info('Webhook processed successfully');
      res.status(200).json({
        status: 'success',
      });
    } catch (processingError) {
      // Log error but still return 200
      logger.warn(
        { error: String(processingError) },
        'Webhook processing failed'
      );

      res.status(200).json({
        status: 'error',
        code: 'PROCESSING_ERROR',
        message: (processingError as Error).message,
      });
    }
  } catch (error) {
    logger.error(
      { error: String(error) },
      'Error handling webhook'
    );
    // Always return 200 for webhooks
    res.status(200).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
    });
  }
}
