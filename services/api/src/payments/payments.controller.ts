import { Request, Response } from 'express';
import {
  createPayPalOrderForOrder,
  captureOrderAndSettle,
  markOrderFailed,
  type CaptureAndSettleResult,
} from './payments.service.js';
import { getServices } from '../lib/app-services.js';
import { sendServiceError } from '../lib/service-error.js';
import { logger } from '../lib/logger.js';

/**
 * POST /orders/:id/paypal - Create a PayPal order for payment
 * Returns paypalOrderId and approveUrl for the patron
 */
export async function createPayPalOrder(req: Request, res: Response): Promise<void> {
  try {
    const { gateway } = getServices(req);
    const { created, paypalOrderId, approveUrl }: { created: boolean; paypalOrderId: string; approveUrl: string } = await createPayPalOrderForOrder(
      gateway,
      req.params.id
    );
    res.status(created ? 201 : 200).json({ status: 'success', paypalOrderId, approveUrl });
  } catch (error) {
    if (!sendServiceError(res, error)) {
      logger.error({ error: String(error), orderId: req.params.id }, 'Error creating PayPal order');
      res.status(400).json({
        status: 'error',
        code: 'PAYMENT_GATEWAY_ERROR',
        message: 'Failed to create PayPal order',
        details: (error as Error).message,
      });
    }
  }
}

/**
 * POST /orders/:id/capture - Capture PayPal order and dispatch settlement
 */
export async function capturePayPalOrder(req: Request, res: Response): Promise<void> {
  try {
    const { gateway, settlementService } = getServices(req);
    const body: CaptureAndSettleResult = await captureOrderAndSettle(gateway, settlementService, req.params.id);
    res.status(200).json(body);
  } catch (error) {
    if (!sendServiceError(res, error)) {
      await markOrderFailed(req.params.id);
      logger.error({ error: String(error), orderId: req.params.id }, 'Error capturing PayPal order');
      res.status(400).json({
        status: 'error',
        code: 'PAYMENT_CAPTURE_FAILED',
        message: 'Failed to capture PayPal order',
        details: (error as Error).message,
      });
    }
  }
}
