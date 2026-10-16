import { prisma, OrderStatus } from '@tabhop/database';
import { Decimal } from '@prisma/client/runtime/library';
import type {
  CatalogItemWithMerchantRecordDto,
  OrderRecordDto,
  OrderWithDetailsRecordDto,
  OrderWithItemsRecordDto,
  StaffRecordDto,
  VenueRecordDto,
} from './orders.model.js';

/**
 * Database models accessed by the Orders module:
 * - Order
 * - OrderItem
 * - Item (with Merchant relation)
 * - Merchant (Venue lookup)
 * - Staff (Server staff lookup)
 */
export type OrdersDatabaseClient = Pick<
  typeof prisma,
  'order' | 'orderItem' | 'item' | 'merchant' | 'staff' | '$transaction'
>;

type OrderTransactionClient = Pick<typeof prisma, 'order' | 'orderItem'>;

const db: OrdersDatabaseClient = prisma;

export async function findOrderByIdempotencyKey(
  idempotencyKey: string
): Promise<OrderWithItemsRecordDto | null> {
  const existingOrder: OrderWithItemsRecordDto | null =
    await db.order.findUnique({
      where: { idempotencyKey },
      include: { items: { include: { item: true } } },
    });
  return existingOrder;
}

export async function findItemsWithMerchantByIds(
  itemIds: string[]
): Promise<CatalogItemWithMerchantRecordDto[]> {
  const items: CatalogItemWithMerchantRecordDto[] = await db.item.findMany({
    where: { id: { in: itemIds } },
    include: { merchant: true },
  });
  return items;
}

export async function findVenueById(
  venueId: string
): Promise<VenueRecordDto | null> {
  const venue: VenueRecordDto | null = await db.merchant.findUnique({
    where: { id: venueId },
  });
  return venue;
}

export async function findStaffById(
  staffId: string
): Promise<StaffRecordDto | null> {
  const staff: StaffRecordDto | null = await db.staff.findUnique({
    where: { id: staffId },
  });
  return staff;
}

export async function createOrderWithItemsTransaction(params: {
  venueId: string;
  tableNumber?: string;
  serverStaffId?: string;
  idempotencyKey?: string;
  subtotalAmount: Decimal;
  taxAmount: Decimal;
  tipAmount: number;
  platformFeeAmount: Decimal;
  totalAmount: Decimal;
  lines: Array<{
    itemId: string;
    quantity: number;
    unitPrice: Decimal;
  }>;
}): Promise<OrderRecordDto> {
  const order: OrderRecordDto = await db.$transaction(
    async (tx: OrderTransactionClient) => {
      const newOrder: OrderRecordDto = await tx.order.create({
        data: {
          venueId: params.venueId,
          tableNumber: params.tableNumber,
          serverStaffId: params.serverStaffId,
          idempotencyKey: params.idempotencyKey,
          subtotalAmount: params.subtotalAmount,
          taxAmount: params.taxAmount,
          tipAmount: params.tipAmount,
          platformFeeAmount: params.platformFeeAmount,
          totalAmount: params.totalAmount,
          status: OrderStatus.PENDING,
        },
      });

      await tx.orderItem.createMany({
        data: params.lines.map((line) => ({
          orderId: newOrder.id,
          itemId: line.itemId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });

      return newOrder;
    }
  );
  return order;
}

export async function findOrderWithDetailsById(
  id: string
): Promise<OrderWithDetailsRecordDto | null> {
  const order: OrderWithDetailsRecordDto | null = await db.order.findUnique({
    where: { id },
    include: { items: { include: { item: true } }, payoutBatch: true },
  });
  return order;
}
