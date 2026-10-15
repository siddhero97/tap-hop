import { prisma, OrderStatus } from '@tabhop/database';
import type { SettlementService } from '../settlements/settlements.service.js';
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
): Promise<any> {
  try {
    const settlementResult = await service.dispatch(orderId);
    return {
      status: 200,
      body: {
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
      },
    };
  } catch (settlementError) {
    logger.error(
      { error: String(settlementError), orderId },
      'Settlement dispatch failed, but capture succeeded'
    );
    return {
      status: 200,
      body: {
        status: 'success',
        order: {
          id: updatedOrder.id,
          status: updatedOrder.status,
          paypalCaptureId: updatedOrder.paypalCaptureId,
        },
        settlementError: (settlementError as Error).message,
      },
    };
  }
}
