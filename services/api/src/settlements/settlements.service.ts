import {
  PayoutStatus,
  MerchantType,
} from '@tabhop/database';
import { PayPalGateway, PayoutBatchRequest } from '../payments/payments.gateway.js';
import { PayPalBatchStatus } from '../payments/payments.model.js';
import { OrderStatus, type OrderWithItems, type SplitRow } from '../orders/orders.model.js';
import { computeSplit } from './settlements.split.js';
import type { Email } from '../lib/email.js';
import { toCents, fromCents } from '../lib/money.js';
import { logger } from '../lib/logger.js';
import { ServiceError } from '../lib/service-error.js';
import type { GetSettlementsQuery } from './settlements.validator.js';
import type {
  PayoutBatchRecordDto,
  SettlementBatchWithRelationsDto,
  SettlementLedgerRow,
  SettlementOrderWithBatchDto,
  SettlementOrderWithRelationsDto,
} from './settlements.model.js';
import {
  countPayoutBatches,
  findOrderForSettlementDispatch,
  findOrderWithBatchById,
  findPayoutBatchesWithRelations,
  savePayoutBatchTransaction,
  updatePayoutBatchDispatched,
  updatePayoutBatchFailed,
  type SettlementWhereFilter,
} from './settlements.repository.js';

export type {
  PayoutBatchRecordDto,
  SettlementBatchWithRelationsDto,
  SettlementLedgerRow,
  SettlementOrderWithBatchDto,
  SettlementOrderWithRelationsDto,
};

/**
 * Settlement dispatch service.
 * Handles creating and dispatching payout batches to PayPal.
 */
export class SettlementService {
  constructor(private gateway: PayPalGateway) {}

  /**
   * Dispatch an order for settlement.
   * Creates a PayoutBatch, calls PayPal gateway, and stores results.
   * Idempotent: returns existing batch if already exists and not FAILED.
   */
  async dispatch(orderId: string): Promise<{
    payoutBatchId: string;
    status: PayPalBatchStatus;
  }> {
    // Load order
    const order: SettlementOrderWithRelationsDto  = await findOrderForSettlementDispatch(orderId);

    if (order.status !== OrderStatus.CAPTURED) {
      throw new Error(
        `Order must be CAPTURED to dispatch settlement, current status: ${order.status}`
      );
    }

    // Check for existing batch (idempotency)
    let result: { payoutBatchId: string; status: PayPalBatchStatus };
    if (order.payoutBatch && order.payoutBatch.status !== PayoutStatus.FAILED) {
      const paypalStatus: PayPalBatchStatus = this.mapPayoutStatusToPayPalBatchStatus(
        order.payoutBatch.status
      );
      result = {
        payoutBatchId: order.payoutBatch.id,
        status: paypalStatus,
      };
    } else {
      // Build vendor emails map
      const vendorEmails: Map<string, Email> = new Map<string, Email>();
      vendorEmails.set(order.venueId, order.venue.paypalEmail);
      if (order.serverStaffId && order.serverStaff) {
        vendorEmails.set(order.serverStaffId, order.serverStaff.paypalEmail);
      }
      for (const orderItem of order.items) {
        vendorEmails.set(orderItem.item.merchantId, orderItem.item.merchant.paypalEmail);
      }

      // Build OrderWithItems for split computation
      const orderWithItems: OrderWithItems = {
        id: order.id,
        venueId: order.venueId,
        serverStaffId: order.serverStaffId ?? undefined,
        subtotalCents: toCents(order.subtotalAmount),
        taxCents: toCents(order.taxAmount),
        tipCents: toCents(order.tipAmount),
        platformFeeCents: toCents(order.platformFeeAmount),
        totalCents: toCents(order.totalAmount),
        items: order.items.map((oi) => ({
          merchantId: oi.item.merchantId,
          merchantType: oi.item.merchant.merchantType,
          commissionRate: parseFloat(oi.item.merchant.commissionRate.toString()),
          lineCents: toCents(oi.unitPrice) * oi.quantity,
        })),
      };

      // Compute split
      const split: SplitRow[] = computeSplit(orderWithItems, vendorEmails);

      // Build PayPal request
      const payoutRequest: PayoutBatchRequest = this.buildPayoutRequest(split, order);

      // Create batch in transaction and dispatch to gateway
      let batch: PayoutBatchRecordDto | undefined;
      try {
        const createdBatch: PayoutBatchRecordDto =
          await savePayoutBatchTransaction({
            orderId: order.id,
            existingBatch: order.payoutBatch,
            split,
          });
        batch = createdBatch;

        // Call gateway
        const response: { paypalBatchId: string; status: PayPalBatchStatus } = await this.gateway.createPayoutBatch(payoutRequest);

        // Update batch with response
        await updatePayoutBatchDispatched({
          batchId: createdBatch.id,
          paypalBatchId: response.paypalBatchId,
          status: this.mapPayPalBatchStatusToPayoutStatus(response.status),
          dispatchedAt: new Date(),
        });

        result = {
          payoutBatchId: createdBatch.id,
          status: response.status,
        };
      } catch (error) {
        // Enrich transaction creation errors with context
        const errorMsg: string = (error as Error).message;
        if (!batch && (errorMsg.includes('constraint') || errorMsg.includes('transaction'))) {
          throw new Error(`Failed to create payout batch: ${errorMsg}`);
        }

        // Store error in batch if it was created
        if (batch) {
          await updatePayoutBatchFailed(batch.id, errorMsg);
        }

        throw error;
      }
    }

    return result;
  }

  /**
   * Build PayPal payout request from split rows.
   */
  private buildPayoutRequest(split: SplitRow[], order: { id: string }): PayoutBatchRequest {
    const items: { recipient_type: "EMAIL"; amount: { value: string; currency: string; }; receiver: Email; note: string; sender_item_id: string; }[] = split.map((row, index) => ({
      recipient_type: 'EMAIL' as const,
      amount: {
        value: fromCents(row.amountCents).toFixed(2),
        currency: 'USD',
      },
      receiver: row.receiverEmail,
      note: `Payment for order ${order.id}`,
      sender_item_id: `${order.id}-${index}`,
    }));

    return {
      sender_batch_header: {
        sender_batch_id: `order-${order.id}-${Date.now()}`,
        email_subject: 'You have a payment',
        email_message: 'Your payout is being processed',
      },
      items,
    };
  }

  /**
   * Map PayOutStatus enum to PayPalBatchStatus.
   */
  private mapPayoutStatusToPayPalBatchStatus(status: PayoutStatus): PayPalBatchStatus {
    let mappedStatus: PayPalBatchStatus;
    switch (status) {
      case PayoutStatus.QUEUED:
        mappedStatus = PayPalBatchStatus.PENDING;
        break;
      case PayoutStatus.PROCESSING:
        mappedStatus = PayPalBatchStatus.PROCESSING;
        break;
      case PayoutStatus.COMPLETED:
        mappedStatus = PayPalBatchStatus.SUCCESS;
        break;
      case PayoutStatus.FAILED:
        mappedStatus = PayPalBatchStatus.FAILED;
        break;
      default:
        throw new Error(`Unknown PayoutStatus: ${status}`);
    }
    return mappedStatus;
  }

  /**
   * Map PayPalBatchStatus to PayoutStatus enum.
   */
  private mapPayPalBatchStatusToPayoutStatus(status: PayPalBatchStatus): PayoutStatus {
    let mappedStatus: PayoutStatus;
    switch (status) {
      case PayPalBatchStatus.PENDING:
        mappedStatus = PayoutStatus.QUEUED;
        break;
      case PayPalBatchStatus.PROCESSING:
        mappedStatus = PayoutStatus.PROCESSING;
        break;
      case PayPalBatchStatus.SUCCESS:
        mappedStatus = PayoutStatus.COMPLETED;
        break;
      case PayPalBatchStatus.FAILED:
      case PayPalBatchStatus.DENIED:
        mappedStatus = PayoutStatus.FAILED;
        break;
      default:
        throw new Error(`Unknown PayPalBatchStatus: ${status}`);
    }
    return mappedStatus;
  }

  /**
   * Retry settlement for an order whose payout batch FAILED.
   * Throws ServiceError for missing order/batch or batch not in FAILED state.
   */
  async retry(orderId: string): Promise<{ payoutBatchId: string; status: string }> {
    const order: SettlementOrderWithBatchDto | null =
      await findOrderWithBatchById(orderId);

    if (!order) {
      throw new ServiceError(404, 'NOT_FOUND', 'Order not found');
    }

    if (!order.payoutBatch) {
      throw new ServiceError(404, 'NOT_FOUND', 'No settlement batch found for this order');
    }

    if (order.payoutBatch.status !== PayoutStatus.FAILED) {
      throw new ServiceError(
        409,
        'SETTLEMENT_INVALID_TRANSITION',
        `Cannot retry settlement batch in ${order.payoutBatch.status} state`,
        { currentStatus: order.payoutBatch.status }
      );
    }

    const result: { payoutBatchId: string; status: PayPalBatchStatus } = await this.dispatch(orderId);
    logger.info({ orderId, payoutBatchId: result.payoutBatchId }, 'Settlement retry dispatched');
    return result;
  }

  /**
   * Retrieve a page of the settlement ledger, filtered by venue, status, and date range.
   */
  async listSettlements(query: GetSettlementsQuery): Promise<{ rows: SettlementLedgerRow[]; total: number }> {
    const skip: number = (query.page - 1) * query.pageSize;
    const whereClause: SettlementWhereFilter = {};

    if (query.venueId) {
      whereClause.order = { venueId: query.venueId };
    }

    if (query.status) {
      whereClause.status = query.status;
    }

    if (query.startDate || query.endDate) {
      whereClause.createdAt = {};
      if (query.startDate) {
        whereClause.createdAt.gte = query.startDate;
      }
      if (query.endDate) {
        whereClause.createdAt.lte = query.endDate;
      }
    }

    const total: number = await countPayoutBatches(whereClause);

    const batches: SettlementBatchWithRelationsDto[] =
      await findPayoutBatchesWithRelations({
        whereClause,
        skip,
        take: query.pageSize,
      });

    const rows: { orderId: string; venueName: string; partnerNames: string[]; subtotalCents: number; taxCents: number; tipCents: number; platformFeeCents: number; totalCents: number; status: PayoutStatus; attempts: number; lastError: string | null; dispatchedAt: Date | null; createdAt: Date; }[] = batches.map((batch) => {
      const partnerNames: Set<string> = new Set<string>();
      batch.order.items.forEach((oi) => {
        if (oi.item.merchant.merchantType === MerchantType.EXTERNAL_PARTNER) {
          partnerNames.add(oi.item.merchant.businessName);
        }
      });

      return {
        orderId: batch.orderId,
        venueName: batch.order.venue.businessName,
        partnerNames: Array.from(partnerNames),
        subtotalCents: Math.round(parseFloat(batch.order.subtotalAmount.toString()) * 100),
        taxCents: Math.round(parseFloat(batch.order.taxAmount.toString()) * 100),
        tipCents: Math.round(parseFloat(batch.order.tipAmount.toString()) * 100),
        platformFeeCents: Math.round(parseFloat(batch.order.platformFeeAmount.toString()) * 100),
        totalCents: Math.round(parseFloat(batch.order.totalAmount.toString()) * 100),
        status: batch.status,
        attempts: batch.attempts,
        lastError: batch.lastError,
        dispatchedAt: batch.dispatchedAt,
        createdAt: batch.createdAt,
      };
    });

    return { rows, total };
  }
}
