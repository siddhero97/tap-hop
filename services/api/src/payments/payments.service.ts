import { OrderStatus } from '@tabhop/database';
import type { SettlementService } from '../settlements/settlements.service.js';
import type { PayPalGateway } from './payments.gateway.js';
import { ServiceError } from '../lib/service-error.js';
import { logger } from '../lib/logger.js';
import type { PaymentOrderRecordDto, PayPalBatchStatus, PayPalCaptureStatus } from './payments.model.js';
import {
  findPaymentOrderById,
  updateOrderAuthorized,
  updateOrderCaptured,
  updateOrderStatusFailed,
} from './payments.repository.js';

// TODO(microservice): Extract the payments domain (PayPal order creation, capture,
// gateway adapters, and webhook verification/processing) into a dedicated Payment
// Microservice (`services/payments`) at a later date, communicating with the core API
// via internal RPC/events.

/**
 * Mark order as FAILED, logging any database errors but not propagating them
 * Used when capture fails to ensure order state reflects the failure
 */
export async function markOrderFailed(orderId: string): Promise<void> {
  try {
    await updateOrderStatusFailed(orderId);
  } catch (updateError) {
    logger.error({ error: String(updateError) }, 'Failed to mark order as FAILED');
  }
}

export interface CapturedOrderSummary {
  id: string;
  status: OrderStatus;
  paypalCaptureId: string | null;
}

export interface CaptureAndSettleResult {
  status: 'success';
  order: CapturedOrderSummary;
  payoutBatch?: {
    id: string;
    status: string;
  };
  settlementError?: string;
}

/**
 * Attempt settlement dispatch after capture succeeds
 * Returns success response with settlement result, or success with error if settlement fails
 */
export async function attemptSettlementDispatch(
  service: SettlementService,
  orderId: string,
  updatedOrder: CapturedOrderSummary
): Promise<CaptureAndSettleResult> {
  let result: CaptureAndSettleResult;
  try {
    const settlementResult: { payoutBatchId: string; status: PayPalBatchStatus } = await service.dispatch(orderId);
    result = {
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
    result = {
      status: 'success',
      order: {
        id: updatedOrder.id,
        status: updatedOrder.status,
        paypalCaptureId: updatedOrder.paypalCaptureId,
      },
      settlementError: (settlementError as Error).message,
    };
  }
  return result;
}

/**
 * Create a PayPal order for a PENDING order. Idempotent if one already exists.
 * Throws ServiceError for missing order or invalid state.
 */
export async function createPayPalOrderForOrder(
  gateway: PayPalGateway,
  orderId: string
): Promise<{ created: boolean; paypalOrderId: string; approveUrl: string }> {
  const order: PaymentOrderRecordDto | null = await findPaymentOrderById(orderId);

  if (!order) {
    throw new ServiceError(404, 'NOT_FOUND', 'Order not found');
  }

  let result: { created: boolean; paypalOrderId: string; approveUrl: string };
  if (order.paypalOrderId && order.status === OrderStatus.AUTHORIZED) {
    result = {
      created: false,
      paypalOrderId: order.paypalOrderId,
      approveUrl: `https://sandbox.paypal.com/fake-approve?orderId=${order.paypalOrderId}`,
    };
  } else {
    if (order.status !== OrderStatus.PENDING) {
      throw new ServiceError(
        409,
        'ORDER_INVALID_TRANSITION',
        `Cannot create PayPal order for order in ${order.status} state`,
        { currentStatus: order.status }
      );
    }

    const amountCents: number = Math.round(parseFloat(order.totalAmount.toString()) * 100);
    if (amountCents <= 0) {
      throw new ServiceError(
        400,
        'INVALID_ORDER_AMOUNT',
        'Order total amount must be greater than zero',
        { totalAmount: order.totalAmount.toString() }
      );
    }

    const paypalResult: { paypalOrderId: string; approveUrl: string } = await gateway.createOrder({
      referenceId: orderId,
      amountCents,
      currency: order.currency,
    });

    await updateOrderAuthorized(orderId, paypalResult.paypalOrderId);

    logger.info({ orderId, paypalOrderId: paypalResult.paypalOrderId }, 'PayPal order created');

    result = { created: true, ...paypalResult };
  }

  return result;
}

/**
 * Capture an AUTHORIZED order and attempt settlement dispatch (capture still succeeds if settlement fails).
 * Throws ServiceError for missing order or invalid state; any other error means the capture itself failed.
 */
export async function captureOrderAndSettle(
  gateway: PayPalGateway,
  settlementService: SettlementService,
  orderId: string
): Promise<CaptureAndSettleResult> {
  const order: PaymentOrderRecordDto | null = await findPaymentOrderById(orderId);

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

  const captureResult: { captureId: string; status: PayPalCaptureStatus; amountCents: number } = await gateway.captureOrder(order.paypalOrderId);

  const updatedOrder: PaymentOrderRecordDto = await updateOrderCaptured(
    orderId,
    captureResult.captureId,
    new Date()
  );

  logger.info({ orderId, paypalCaptureId: captureResult.captureId }, 'PayPal order captured');

  return attemptSettlementDispatch(settlementService, orderId, updatedOrder);
}
