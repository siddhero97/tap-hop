import {
  prisma,
  Order,
  PayoutBatch,
  PayoutStatus,
  MerchantType,
} from '@tabhop/database';
import { PayPalGateway, PayoutBatchRequest } from '../payments/payments.gateway.js';
import { PayPalBatchStatus } from '../payments/payments.model.js';
import { OrderStatus, type OrderWithItems, type SplitRow } from '../orders/orders.model.js';
import { computeSplit } from './settlements.split.js';
import { toCents, fromCents } from '../lib/money.js';
import { logger } from '../lib/logger.js';
import { ServiceError } from '../lib/service-error.js';
import type { GetSettlementsQuery } from './settlements.validator.js';

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
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        venue: true,
        serverStaff: true,
        items: {
          include: {
            item: {
              include: {
                merchant: true,
              },
            },
          },
        },
        payoutBatch: true,
      },
    });

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.status !== OrderStatus.CAPTURED) {
      throw new Error(
        `Order must be CAPTURED to dispatch settlement, current status: ${order.status}`
      );
    }

    // Check for existing batch (idempotency)
    if (order.payoutBatch) {
      if (order.payoutBatch.status !== PayoutStatus.FAILED) {
        // Return existing batch
        const paypalStatus = this.mapPayoutStatusToPayPalBatchStatus(
          order.payoutBatch.status
        );
        return {
          payoutBatchId: order.payoutBatch.id,
          status: paypalStatus,
        };
      }
    }

    // Build vendor emails map
    const vendorEmails = new Map<string, string>();
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
      items: order.items.map((oi: any) => ({
        merchantId: oi.item.merchantId,
        merchantType: oi.item.merchant.merchantType,
        commissionRate: parseFloat(oi.item.merchant.commissionRate.toString()),
        lineCents: toCents(oi.unitPrice) * oi.quantity,
      })),
    };

    // Compute split
    const split = computeSplit(orderWithItems, vendorEmails);

    // Build PayPal request
    const payoutRequest = this.buildPayoutRequest(split, order);

    // Create batch in transaction and dispatch to gateway
    let batch: PayoutBatch | undefined;
    try {
      batch = await prisma.$transaction(async (tx: any) => {
        // PayoutBatch.orderId is unique: a retry reuses the FAILED batch and replaces its items
        const existingBatch = order.payoutBatch;
        let newBatch;
        if (existingBatch) {
          await tx.payoutBatchItem.deleteMany({ where: { payoutBatchId: existingBatch.id } });
          newBatch = await tx.payoutBatch.update({
            where: { id: existingBatch.id },
            data: {
              status: PayoutStatus.PROCESSING,
              attempts: existingBatch.attempts + 1,
              lastError: null,
            },
          });
        } else {
          newBatch = await tx.payoutBatch.create({
            data: {
              orderId: order.id,
              status: PayoutStatus.PROCESSING,
              attempts: 1,
            },
          });
        }

        // Create PayoutBatchItems
        const items = split.map((row, index) => ({
          payoutBatchId: newBatch.id,
          merchantId: row.merchantId || null,
          staffId: row.staffId || null,
          recipientType: row.recipientType,
          receiverEmail: row.receiverEmail,
          amount: fromCents(row.amountCents),
          currency: 'USD',
          senderItemId: `${newBatch.id}-${index}`,
          status: PayoutStatus.PROCESSING,
        }));

        await tx.payoutBatchItem.createMany({
          data: items,
        });

        return newBatch;
      });

      // Call gateway
      const response = await this.gateway.createPayoutBatch(payoutRequest);

      // Update batch with response
      await prisma.payoutBatch.update({
        where: { id: batch.id },
        data: {
          paypalBatchId: response.paypalBatchId,
          status: this.mapPayPalBatchStatusToPayoutStatus(response.status),
          dispatchedAt: new Date(),
        },
      });

      return {
        payoutBatchId: batch.id,
        status: response.status,
      };
    } catch (error) {
      // Enrich transaction creation errors with context
      const errorMsg = (error as Error).message;
      if (!batch && (errorMsg.includes('constraint') || errorMsg.includes('transaction'))) {
        throw new Error(`Failed to create payout batch: ${errorMsg}`);
      }

      // Store error in batch if it was created
      if (batch) {
        await prisma.payoutBatch.update({
          where: { id: batch.id },
          data: {
            status: PayoutStatus.FAILED,
            lastError: errorMsg,
          },
        });
      }

      throw error;
    }
  }

  /**
   * Build PayPal payout request from split rows.
   */
  private buildPayoutRequest(split: SplitRow[], order: Order): PayoutBatchRequest {
    const items = split.map((row, index) => ({
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
    switch (status) {
      case PayoutStatus.QUEUED:
        return PayPalBatchStatus.PENDING;
      case PayoutStatus.PROCESSING:
        return PayPalBatchStatus.PROCESSING;
      case PayoutStatus.COMPLETED:
        return PayPalBatchStatus.SUCCESS;
      case PayoutStatus.FAILED:
        return PayPalBatchStatus.FAILED;
      default:
        throw new Error(`Unknown PayoutStatus: ${status}`);
    }
  }

  /**
   * Map PayPalBatchStatus to PayoutStatus enum.
   */
  private mapPayPalBatchStatusToPayoutStatus(status: PayPalBatchStatus): PayoutStatus {
    switch (status) {
      case PayPalBatchStatus.PENDING:
        return PayoutStatus.QUEUED;
      case PayPalBatchStatus.PROCESSING:
        return PayoutStatus.PROCESSING;
      case PayPalBatchStatus.SUCCESS:
        return PayoutStatus.COMPLETED;
      case PayPalBatchStatus.FAILED:
      case PayPalBatchStatus.DENIED:
        return PayoutStatus.FAILED;
      default:
        throw new Error(`Unknown PayPalBatchStatus: ${status}`);
    }
  }

  /**
   * Retry settlement for an order whose payout batch FAILED.
   * Throws ServiceError for missing order/batch or batch not in FAILED state.
   */
  async retry(orderId: string): Promise<{ payoutBatchId: string; status: string }> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payoutBatch: true },
    });

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

    const result = await this.dispatch(orderId);
    logger.info({ orderId, payoutBatchId: result.payoutBatchId }, 'Settlement retry dispatched');
    return result;
  }

  /**
   * Retrieve a page of the settlement ledger, filtered by venue, status, and date range.
   */
  async listSettlements(query: GetSettlementsQuery): Promise<{ rows: unknown[]; total: number }> {
    const skip = (query.page - 1) * query.pageSize;
    const whereClause: any = {};

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

    const total = await prisma.payoutBatch.count({ where: whereClause });

    const batches = await prisma.payoutBatch.findMany({
      where: whereClause,
      include: {
        order: {
          include: {
            venue: true,
            items: { include: { item: { include: { merchant: true } } } },
          },
        },
        items: { include: { merchant: true, staff: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.pageSize,
    });

    const rows = batches.map((batch) => {
      const partnerNames = new Set<string>();
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
