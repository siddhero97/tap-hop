import { prisma } from '../src/index.js';
import type { Item, Merchant, Prisma, Staff } from '@prisma/client';

/**
 * Database models accessed by the Prisma Seed script:
 * - OrderItem, Order, PayoutBatchItem, PayoutBatch, WebhookEvent, Item, Staff, Merchant
 */
export type SeedDatabaseClient = Pick<
  typeof prisma,
  | 'orderItem'
  | 'order'
  | 'payoutBatchItem'
  | 'payoutBatch'
  | 'webhookEvent'
  | 'item'
  | 'staff'
  | 'merchant'
  | '$disconnect'
>;

export type SeedMerchantRecordDto = Merchant;
export type SeedStaffRecordDto = Staff;
export type SeedItemRecordDto = Item;
export type SeedBatchCountDto = Prisma.BatchPayload;

const db: SeedDatabaseClient = prisma;

export async function clearAllSeedData(): Promise<void> {
  const deletedOrderItems: SeedBatchCountDto = await db.orderItem.deleteMany();
  const deletedOrders: SeedBatchCountDto = await db.order.deleteMany();
  const deletedBatchItems: SeedBatchCountDto =
    await db.payoutBatchItem.deleteMany();
  const deletedBatches: SeedBatchCountDto = await db.payoutBatch.deleteMany();
  const deletedWebhooks: SeedBatchCountDto = await db.webhookEvent.deleteMany();
  const deletedItems: SeedBatchCountDto = await db.item.deleteMany();
  const deletedStaff: SeedBatchCountDto = await db.staff.deleteMany();
  const deletedMerchants: SeedBatchCountDto = await db.merchant.deleteMany();
  void [
    deletedOrderItems,
    deletedOrders,
    deletedBatchItems,
    deletedBatches,
    deletedWebhooks,
    deletedItems,
    deletedStaff,
    deletedMerchants,
  ];
}

export async function createSeedMerchant(
  data: Prisma.MerchantUncheckedCreateInput
): Promise<SeedMerchantRecordDto> {
  const merchant: SeedMerchantRecordDto = await db.merchant.create({ data });
  return merchant;
}

export async function createSeedStaff(
  data: Prisma.StaffUncheckedCreateInput
): Promise<SeedStaffRecordDto> {
  const staff: SeedStaffRecordDto = await db.staff.create({ data });
  return staff;
}

export async function createSeedItems(
  data: Prisma.ItemCreateManyInput[]
): Promise<SeedBatchCountDto> {
  const batchResult: SeedBatchCountDto = await db.item.createMany({ data });
  return batchResult;
}

export async function disconnectSeedDatabase(): Promise<void> {
  await db.$disconnect();
}
