import { toCents, fromCents } from '../lib/money.js';
import { Decimal } from '@prisma/client/runtime/library';
import { OrderStatus, MerchantType } from '@tabhop/database';
import { logger } from '../lib/logger.js';
import { ServiceError } from '../lib/service-error.js';
import { getPlatformSettings, type PlatformSettingsView } from '../admin/admin.service.js';
import type { CreateOrderRequest } from './orders.validator.js';
import type {
  CatalogItemWithMerchantRecordDto,
  OrderRecordDto,
  OrderWithDetailsRecordDto,
  OrderWithItemsRecordDto,
  StaffRecordDto,
  VenueRecordDto,
} from './orders.model.js';
import {
  createOrderWithItemsTransaction,
  findItemsWithMerchantByIds,
  findOrderByIdempotencyKey,
  findOrderWithDetailsById,
  findStaffById,
  findVenueById,
} from './orders.repository.js';

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
  if (input.taxRateBps < 0 || input.platformFeeBps < 0) {
    throw new Error('Tax rate and platform fee basis points cannot be negative');
  }

  // Sum line items in cents
  const subtotalCents: number = input.lineItems.reduce((sum, line) => {
    const unitCents: number = toCents(line.priceDecimal);
    if (unitCents < 0) {
      throw new Error(`Line item price cannot be negative: ${unitCents}`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`Line item quantity must be a positive integer: ${line.quantity}`);
    }
    const lineCents: number = unitCents * line.quantity;
    return sum + lineCents;
  }, 0);

  // Tax: floor to avoid overcharge
  const taxCents: number = Math.floor((subtotalCents * input.taxRateBps) / 10000);

  // Platform fee: floor, kept by platform
  const platformFeeCents: number = Math.floor((subtotalCents * input.platformFeeBps) / 10000);

  const totalCents: number = subtotalCents + taxCents + platformFeeCents;

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
  if (
    pricing.subtotalCents < 0 ||
    pricing.taxCents < 0 ||
    pricing.platformFeeCents < 0 ||
    pricing.totalCents < 0
  ) {
    throw new Error('Order pricing amounts cannot be negative');
  }
  return {
    subtotalAmount: fromCents(pricing.subtotalCents),
    taxAmount: fromCents(pricing.taxCents),
    platformFeeAmount: fromCents(pricing.platformFeeCents),
    totalAmount: fromCents(pricing.totalCents),
  };
}

function toCentsFromDecimal(value: { toString(): string }): number {
  return Math.round(parseFloat(value.toString()) * 100);
}

export interface OrderLineSummary {
  itemId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface CreatedOrderSummary {
  id: string;
  venueId: string;
  status: OrderStatus;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  platformFeeCents: number;
  totalCents: number;
  items?: OrderLineSummary[];
}

export interface OrderDetailsView {
  id: string;
  venueId: string;
  serverStaffId: string | null;
  tableNumber: string | null;
  status: OrderStatus;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  platformFeeCents: number;
  totalCents: number;
  items: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    unitPriceCents: number;
  }>;
  payoutBatch: {
    id: string;
    paypalBatchId: string | null;
    status: string;
  } | null;
  capturedAt: Date | null;
  createdAt: Date;
}

/**
 * Create an order with its items. Idempotent on idempotencyKey.
 * Throws ServiceError for missing/inactive items, venue, or staff.
 */
export async function createOrderWithItems(
  input: CreateOrderRequest
): Promise<{ created: boolean; order: CreatedOrderSummary }> {
  let existingOrder: OrderWithItemsRecordDto | null = null;
  if (input.idempotencyKey) {
    const foundOrder: OrderWithItemsRecordDto | null =
      await findOrderByIdempotencyKey(input.idempotencyKey);
    existingOrder = foundOrder;
  }

  let result: { created: boolean; order: CreatedOrderSummary };
  if (existingOrder) {
    logger.info(
      {
        orderId: existingOrder.id,
        venueId: existingOrder.venueId,
        idempotencyKey: input.idempotencyKey,
      },
      'Idempotent order replay returned existing order'
    );
    result = {
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
  } else {
    const itemIds: string[] = input.lines.map((line) => line.itemId);
    const uniqueItemIds: string[] = Array.from(new Set(itemIds));
    const items: CatalogItemWithMerchantRecordDto[] =
      await findItemsWithMerchantByIds(uniqueItemIds);

    if (items.length !== uniqueItemIds.length) {
      const missingIds: string[] = uniqueItemIds.filter((id) => !items.find((item) => item.id === id));
      throw new ServiceError(404, 'NOT_FOUND', 'Some items not found', { missingItemIds: missingIds });
    }

    const inactiveItems: CatalogItemWithMerchantRecordDto[] = items.filter((item) => !item.isActive);
    if (inactiveItems.length > 0) {
      throw new ServiceError(400, 'ITEM_INACTIVE', 'One or more items are inactive', {
        inactiveItemIds: inactiveItems.map((item) => item.id),
      });
    }

    const negativePriceItems: CatalogItemWithMerchantRecordDto[] = items.filter((item) => toCents(item.price) < 0);
    if (negativePriceItems.length > 0) {
      throw new ServiceError(400, 'INVALID_ITEM_PRICE', 'One or more items have a negative price', {
        invalidItemIds: negativePriceItems.map((item) => item.id),
      });
    }

    const venue: VenueRecordDto | null = await findVenueById(input.venueId);
    if (!venue || venue.merchantType !== MerchantType.PRIMARY_VENUE) {
      throw new ServiceError(404, 'NOT_FOUND', 'Venue not found or is not a primary venue');
    }

    if (input.serverStaffId) {
      const staff: StaffRecordDto | null = await findStaffById(input.serverStaffId);
      if (!staff || staff.venueId !== input.venueId) {
        throw new ServiceError(404, 'NOT_FOUND', 'Server staff not found or does not belong to this venue');
      }
    }

    const settings: PlatformSettingsView = await getPlatformSettings();

    const pricing: { subtotalCents: number; taxCents: number; platformFeeCents: number; totalCents: number; } = computeOrderTotal({
      lineItems: input.lines.map((line) => ({
        priceDecimal: items.find((i) => i.id === line.itemId)!.price,
        quantity: line.quantity,
      })),
      taxRateBps: settings.taxRateBps,
      platformFeeBps: settings.platformFeeBps,
    });
    const amounts: { subtotalAmount: Decimal; taxAmount: Decimal; platformFeeAmount: Decimal; totalAmount: Decimal; } = pricingToDecimals(pricing);

    const order: OrderRecordDto = await createOrderWithItemsTransaction({
      venueId: input.venueId,
      tableNumber: input.tableNumber,
      serverStaffId: input.serverStaffId,
      idempotencyKey: input.idempotencyKey,
      subtotalAmount: amounts.subtotalAmount,
      taxAmount: amounts.taxAmount,
      tipAmount: input.tipAmount,
      platformFeeAmount: amounts.platformFeeAmount,
      totalAmount: amounts.totalAmount,
      lines: input.lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: items.find((i) => i.id === line.itemId)!.price,
      })),
    });

    logger.info(
      {
        orderId: order.id,
        venueId: input.venueId,
        subtotalCents: pricing.subtotalCents,
        taxCents: pricing.taxCents,
        platformFeeCents: pricing.platformFeeCents,
        totalCents: pricing.totalCents,
        platformFeeBps: settings.platformFeeBps,
        taxRateBps: settings.taxRateBps,
      },
      'Order created successfully'
    );

    result = {
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

  return result;
}

/**
 * Retrieve an order with items and payout batch. Throws ServiceError(404) if missing.
 */
export async function getOrderDetails(id: string): Promise<OrderDetailsView> {
  const order: OrderWithDetailsRecordDto | null = await findOrderWithDetailsById(id);

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
