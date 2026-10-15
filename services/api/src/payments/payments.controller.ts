import { Request, Response } from 'express';
import { prisma, OrderStatus } from '@tabhop/database';
import { PayPalGateway } from './payments.gateway.js';
import { PayPalGateway as SettlementPayPalGateway } from './payments.gateway.js';
import type { SettlementService } from '../settlements/settlements.service.js';
import { logger } from '../lib/logger.js';
import { OrderIdSchema } from './payments.validator.js';

/**
 * POST /orders/:id/paypal - Create a PayPal order for payment
 * Returns paypalOrderId and approveUrl for the patron
 */
export async function createPayPalOrder(req: Request, res: Response): Promise<void> {
  try {
    const { id: orderId } = req.params;
    const { gateway } = req.app.locals;

    if (!gateway || !('createOrder' in gateway)) {
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Payment gateway not configured',
      });
      return;
    }

    const paypalGateway = gateway as PayPalGateway;

    // Validate UUID format
    const parseResult = OrderIdSchema.safeParse(orderId);
    if (!parseResult.success) {
      res.status(400).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Invalid order ID format',
      });
      return;
    }

    // Fetch order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Order not found',
      });
      return;
    }

    // Validate order is in PENDING state
    if (order.status !== OrderStatus.PENDING) {
      res.status(409).json({
        status: 'error',
        code: 'ORDER_INVALID_TRANSITION',
        message: `Cannot create PayPal order for order in ${order.status} state`,
        currentStatus: order.status,
      });
      return;
    }

    // Check if PayPal order already created (idempotency)
    if (order.paypalOrderId) {
      res.status(200).json({
        status: 'success',
        paypalOrderId: order.paypalOrderId,
        approveUrl: `https://sandbox.paypal.com/fake-approve?orderId=${order.paypalOrderId}`,
      });
      return;
    }

    try {
      // Create PayPal order
      const paypalResult = await paypalGateway.createOrder({
        referenceId: orderId,
        amountCents: Math.round(parseFloat(order.totalAmount.toString()) * 100),
        currency: order.currency,
      });

      // Store paypalOrderId in database
      await prisma.order.update({
        where: { id: orderId },
        data: {
          paypalOrderId: paypalResult.paypalOrderId,
          status: OrderStatus.AUTHORIZED,
        },
      });

      logger.info(
        { orderId, paypalOrderId: paypalResult.paypalOrderId },
        'PayPal order created'
      );

      res.status(201).json({
        status: 'success',
        paypalOrderId: paypalResult.paypalOrderId,
        approveUrl: paypalResult.approveUrl,
      });
    } catch (gatewayError) {
      logger.error(
        { error: String(gatewayError), orderId },
        'Failed to create PayPal order'
      );
      res.status(400).json({
        status: 'error',
        code: 'PAYMENT_GATEWAY_ERROR',
        message: 'Failed to create PayPal order',
        details: (gatewayError as Error).message,
      });
    }
  } catch (error) {
    logger.error(
      { error: String(error), orderId: req.params.id },
      'Error creating PayPal order'
    );
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create PayPal order',
    });
  }
}

/**
 * POST /orders/:id/capture - Capture PayPal order and dispatch settlement
 */
export async function capturePayPalOrder(req: Request, res: Response): Promise<void> {
  try {
    const { id: orderId } = req.params;
    const { gateway, settlementService } = req.app.locals;

    if (!gateway || !('captureOrder' in gateway)) {
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Payment gateway not configured',
      });
      return;
    }

    if (!settlementService || !('dispatch' in settlementService)) {
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Settlement service not configured',
      });
      return;
    }

    const paypalGateway = gateway as PayPalGateway;
    const service = settlementService as SettlementService;

    // Validate UUID format
    const parseResult = OrderIdSchema.safeParse(orderId);
    if (!parseResult.success) {
      res.status(400).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Invalid order ID format',
      });
      return;
    }

    // Fetch order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Order not found',
      });
      return;
    }

    // Validate order is in AUTHORIZED state
    if (order.status !== OrderStatus.AUTHORIZED) {
      res.status(409).json({
        status: 'error',
        code: 'ORDER_INVALID_TRANSITION',
        message: `Cannot capture order in ${order.status} state. Must be AUTHORIZED.`,
        currentStatus: order.status,
      });
      return;
    }

    if (!order.paypalOrderId) {
      res.status(409).json({
        status: 'error',
        code: 'ORDER_INVALID_STATE',
        message: 'Order does not have a PayPal order ID',
      });
      return;
    }

    try {
      // Capture PayPal order
      const captureResult = await paypalGateway.captureOrder(order.paypalOrderId);

      // Update order with capture details
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          paypalCaptureId: captureResult.captureId,
          status: OrderStatus.CAPTURED,
          capturedAt: new Date(),
        },
      });

      logger.info(
        { orderId, paypalCaptureId: captureResult.captureId },
        'PayPal order captured'
      );

      try {
        // Dispatch settlement
        const settlementResult = await service.dispatch(orderId);

        res.status(200).json({
          status: 'success',
          order: {
            id: updatedOrder.id,
            status: updatedOrder.status,
            paypalCaptureId: updatedOrder.paypalCaptureId,
          },
          payoutBatch: {
            id: settlementResult.payoutBatchId,
            status: settlementResult.status,
          },
        });
      } catch (settlementError) {
        // Capture succeeded but settlement dispatch failed
        logger.error(
          { error: String(settlementError), orderId },
          'Settlement dispatch failed, but capture succeeded'
        );

        res.status(200).json({
          status: 'success',
          order: {
            id: updatedOrder.id,
            status: updatedOrder.status,
            paypalCaptureId: updatedOrder.paypalCaptureId,
          },
          settlementError: (settlementError as Error).message,
        });
      }
    } catch (captureError) {
      // Update order status to FAILED
      await prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.FAILED },
      });

      logger.error(
        { error: String(captureError), orderId },
        'Failed to capture PayPal order'
      );

      res.status(400).json({
        status: 'error',
        code: 'PAYMENT_CAPTURE_FAILED',
        message: 'Failed to capture PayPal order',
        details: (captureError as Error).message,
      });
    }
  } catch (error) {
    logger.error(
      { error: String(error), orderId: req.params.id },
      'Error capturing PayPal order'
    );
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to capture PayPal order',
    });
  }
}
