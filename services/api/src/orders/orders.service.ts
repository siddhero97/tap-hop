import { toCents, fromCents } from '../lib/money.js';
import { Decimal } from '@prisma/client';
import { prisma, OrderStatus, MerchantType } from '@tabhop/database';
import { logger } from '../lib/logger.js';
import { ServiceError } from '../lib/service-error.js';
import type { CreateOrderRequest } from './orders.validator.js';

/**
 * Compute total order amount from items and fees.
 * All intermediate calculations in cents (integers).
 */
export function computeOrderTotal(input: {
  lineItems: Array<{ priceDecimal: Decimal; quantity: number }>;
  taxRateBps: number;
  platformFeeBps: number;
}): {
  subtotalCents: number;
  taxCents: number;
  platformFeeCents: number;
  totalCents: number;
} {
  // Sum line items in cents
  const subtotalCents = input.lineItems.reduce((sum, line) => {
    const lineCents = toCents(line.priceDecimal) * line.quantity;
    return sum + lineCents;
  }, 0);

  // Tax: floor to avoid overcharge
  const taxCents = Math.floor((subtotalCents * input.taxRateBps) / 10000);

  // Platform fee: floor, kept by platform
  const platformFeeCents = Math.floor((subtotalCents * input.platformFeeBps) / 10000);

  const totalCents = subtotalCents + taxCents + platformFeeCents;

  return {
    subtotalCents,
    taxCents,
    platformFeeCents,
    totalCents,
  };
}

/**
 * Convert pricing result to Decimal for database storage.
 */
export function pricingToDecimals(pricing: ReturnType<typeof computeOrderTotal>) {
  return {
    subtotalAmount: fromCents(pricing.subtotalCents),
    taxAmount: fromCents(pricing.taxCents),
    platformFeeAmount: fromCents(pricing.platformFeeCents),
    totalAmount: fromCents(pricing.totalCents),
  };
}

const TAX_RATE_BPS = 800;
const PLATFORM_FEE_BPS = 500;

function toCentsFromDecimal(value: { toString(): string }): number {
  return Math.round(parseFloat(value.toString()) * 100);
}

/**
 * Create an order with its items. Idempotent on idempotencyKey.
 * Throws ServiceError for missing/inactive items, venue, or staff.
 */
export async function createOrderWithItems(
  input: CreateOrderRequest
): Promise<{ created: boolean; order: Record<string, unknown> }> {
  if (input.idempotencyKey) {
    const existingOrder = await prisma.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { items: { include: { item: true } } },
    });

    if (existingOrder) {
      return {
        created: false,
        order: {
          id: existingOrder.id,
          venueId: existingOrder.venueId,
          status: existingOrder.status,
          subtotalCents: toCentsFromDecimal(existingOrder.subtotalAmount),
          taxCents: toCentsFromDecimal(existingOrder.taxAmount),
          tipCents: toCentsFromDecimal(existingOrder.tipAmount),
          platformFeeCents: toCentsFromDecimal(existingOrder.platformFeeAmount),
          totalCents: toCentsFromDecimal(existingOrder.totalAmount),
          items: existingOrder.items.map((oi) => ({
            itemId: oi.itemId,
            quantity: oi.quantity,
            unitPriceCents: toCentsFromDecimal(oi.unitPrice),
          })),
        },
      };
    }
  }

  const itemIds = input.lines.map((line) => line.itemId);
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds } },
    include: { merchant: true },
  });

  if (items.length !== itemIds.length) {
    const missingIds = itemIds.filter((id) => !items.find((item) => item.id === id));
    throw new ServiceError(404, 'NOT_FOUND', 'Some items not found', { missingItemIds: missingIds });
  }

  const inactiveItems = items.filter((item) => !item.isActive);
  if (inactiveItems.length > 0) {
    throw new ServiceError(400, 'ITEM_INACTIVE', 'One or more items are inactive', {
      inactiveItemIds: inactiveItems.map((item) => item.id),
    });
  }

  const venue = await prisma.merchant.findUnique({ where: { id: input.venueId } });
  if (!venue || venue.merchantType !== MerchantType.PRIMARY_VENUE) {
    throw new ServiceError(404, 'NOT_FOUND', 'Venue not found or is not a primary venue');
  }

  if (input.serverStaffId) {
    const staff = await prisma.staff.findUnique({ where: { id: input.serverStaffId } });
    if (!staff || staff.venueId !== input.venueId) {
      throw new ServiceError(404, 'NOT_FOUND', 'Server staff not found or does not belong to this venue');
    }
  }

  const pricing = computeOrderTotal({
    lineItems: input.lines.map((line) => ({
      priceDecimal: items.find((i) => i.id === line.itemId)!.price,
      quantity: line.quantity,
    })),
    taxRateBps: TAX_RATE_BPS,
    platformFeeBps: PLATFORM_FEE_BPS,
  });
  const amounts = pricingToDecimals(pricing);

  const order = await prisma.$transaction(async (tx: any) => {
    const newOrder = await tx.order.create({
      data: {
        venueId: input.venueId,
        tableNumber: input.tableNumber,
        serverStaffId: input.serverStaffId,
        idempotencyKey: input.idempotencyKey,
        subtotalAmount: amounts.subtotalAmount,
        taxAmount: amounts.taxAmount,
        tipAmount: input.tipAmount,
        platformFeeAmount: amounts.platformFeeAmount,
        totalAmount: amounts.totalAmount,
        status: OrderStatus.PENDING,
      },
    });

    await tx.orderItem.createMany({
      data: input.lines.map((line) => ({
        orderId: newOrder.id,
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: items.find((i) => i.id === line.itemId)!.price,
      })),
    });

    return newOrder;
  });

  logger.info({ orderId: order.id, venueId: input.venueId }, 'Order created successfully');

  return {
    created: true,
    order: {
      id: order.id,
      venueId: order.venueId,
      status: order.status,
      subtotalCents: pricing.subtotalCents,
      taxCents: pricing.taxCents,
      tipCents: Math.round(input.tipAmount * 100),
      platformFeeCents: pricing.platformFeeCents,
      totalCents: pricing.totalCents,
    },
  };
}

/**
 * Retrieve an order with items and payout batch. Throws ServiceError(404) if missing.
 */
export async function getOrderDetails(id: string): Promise<Record<string, unknown>> {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { include: { item: true } }, payoutBatch: true },
  });

  if (!order) {
    throw new ServiceError(404, 'NOT_FOUND', 'Order not found');
  }

  return {
    id: order.id,
    venueId: order.venueId,
    serverStaffId: order.serverStaffId,
    tableNumber: order.tableNumber,
    status: order.status,
    paypalOrderId: order.paypalOrderId,
    paypalCaptureId: order.paypalCaptureId,
    subtotalCents: toCentsFromDecimal(order.subtotalAmount),
    taxCents: toCentsFromDecimal(order.taxAmount),
    tipCents: toCentsFromDecimal(order.tipAmount),
    platformFeeCents: toCentsFromDecimal(order.platformFeeAmount),
    totalCents: toCentsFromDecimal(order.totalAmount),
    items: order.items.map((oi) => ({
      itemId: oi.itemId,
      itemName: oi.item.name,
      quantity: oi.quantity,
      unitPriceCents: toCentsFromDecimal(oi.unitPrice),
    })),
    payoutBatch: order.payoutBatch
      ? {
          id: order.payoutBatch.id,
          paypalBatchId: order.payoutBatch.paypalBatchId,
          status: order.payoutBatch.status,
        }
      : null,
    capturedAt: order.capturedAt,
    createdAt: order.createdAt,
  };
}
