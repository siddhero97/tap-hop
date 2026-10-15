import { prisma, OrderStatus } from '@tabhop/database';
import type { SettlementService } from '../settlements/settlements.service.js';
import type { PayPalGateway } from './payments.gateway.js';
import { ServiceError } from '../lib/service-error.js';
import { logger } from '../lib/logger.js';

/**
 * Mark order as FAILED, logging any database errors but not propagating them
 * Used when capture fails to ensure order state reflects the failure
 */
export async function markOrderFailed(orderId: string): Promise<void> {
  try {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.FAILED },
    });
  } catch (updateError) {
    logger.error({ error: String(updateError) }, 'Failed to mark order as FAILED');
  }
}

/**
 * Attempt settlement dispatch after capture succeeds
 * Returns success response with settlement result, or success with error if settlement fails
 */
export async function attemptSettlementDispatch(
  service: SettlementService,
  orderId: string,
  updatedOrder: any
): Promise<Record<string, unknown>> {
  try {
    const settlementResult = await service.dispatch(orderId);
    return {
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
    };
  } catch (settlementError) {
    logger.error(
      { error: String(settlementError), orderId },
      'Settlement dispatch failed, but capture succeeded'
    );
    return {
      status: 'success',
      order: {
        id: updatedOrder.id,
        status: updatedOrder.status,
        paypalCaptureId: updatedOrder.paypalCaptureId,
      },
      settlementError: (settlementError as Error).message,
    };
  }
}

/**
 * Create a PayPal order for a PENDING order. Idempotent if one already exists.
 * Throws ServiceError for missing order or invalid state.
 */
export async function createPayPalOrderForOrder(
  gateway: PayPalGateway,
  orderId: string
): Promise<{ created: boolean; paypalOrderId: string; approveUrl: string }> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });

  if (!order) {
    throw new ServiceError(404, 'NOT_FOUND', 'Order not found');
  }

  if (order.status !== OrderStatus.PENDING) {
    throw new ServiceError(
      409,
      'ORDER_INVALID_TRANSITION',
      `Cannot create PayPal order for order in ${order.status} state`,
      { currentStatus: order.status }
    );
  }

  if (order.paypalOrderId) {
    return {
      created: false,
      paypalOrderId: order.paypalOrderId,
      approveUrl: `https://sandbox.paypal.com/fake-approve?orderId=${order.paypalOrderId}`,
    };
  }

  const paypalResult = await gateway.createOrder({
    referenceId: orderId,
    amountCents: Math.round(parseFloat(order.totalAmount.toString()) * 100),
    currency: order.currency,
  });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      paypalOrderId: paypalResult.paypalOrderId,
      status: OrderStatus.AUTHORIZED,
    },
  });

  logger.info({ orderId, paypalOrderId: paypalResult.paypalOrderId }, 'PayPal order created');

  return { created: true, ...paypalResult };
}

/**
 * Capture an AUTHORIZED order and attempt settlement dispatch (capture still succeeds if settlement fails).
 * Throws ServiceError for missing order or invalid state; any other error means the capture itself failed.
 */
export async function captureOrderAndSettle(
  gateway: PayPalGateway,
  settlementService: SettlementService,
  orderId: string
): Promise<Record<string, unknown>> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });

  if (!order) {
    throw new ServiceError(404, 'NOT_FOUND', 'Order not found');
  }

  if (order.status !== OrderStatus.AUTHORIZED) {
    throw new ServiceError(
      409,
      'ORDER_INVALID_TRANSITION',
      `Cannot capture order in ${order.status} state. Must be AUTHORIZED.`,
      { currentStatus: order.status }
    );
  }

  if (!order.paypalOrderId) {
    throw new ServiceError(409, 'ORDER_INVALID_STATE', 'Order does not have a PayPal order ID');
  }

  const captureResult = await gateway.captureOrder(order.paypalOrderId);

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      paypalCaptureId: captureResult.captureId,
      status: OrderStatus.CAPTURED,
      capturedAt: new Date(),
    },
  });

  logger.info({ orderId, paypalCaptureId: captureResult.captureId }, 'PayPal order captured');

  return attemptSettlementDispatch(settlementService, orderId, updatedOrder);
}
