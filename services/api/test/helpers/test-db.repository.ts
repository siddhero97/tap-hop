import {
  prisma,
  type Item,
  type Merchant,
  type Order,
  type OrderItem,
  type PayoutBatch,
  type PayoutBatchItem,
  type Prisma,
  type Staff,
  type WebhookEvent,
} from '@tabhop/database';

/**
 * Database models accessed across Integration & Sandbox Test Suites:
 * - Session, PlatformSettings, User, PayoutBatchItem, PayoutBatch,
 *   OrderItem, Order, WebhookEvent, Item, Staff, Merchant
 */
export type TestDatabaseClient = Pick<
  typeof prisma,
  | 'session'
  | 'platformSettings'
  | 'user'
  | 'payoutBatchItem'
  | 'payoutBatch'
  | 'orderItem'
  | 'order'
  | 'webhookEvent'
  | 'item'
  | 'staff'
  | 'merchant'
  | '$transaction'
  | '$disconnect'
>;

export type MerchantTestRecordDto = Merchant;
export type ItemTestRecordDto = Item;
export type StaffTestRecordDto = Staff;
export type OrderTestRecordDto = Order;
export type OrderItemTestRecordDto = OrderItem;
export type OrderWithItemsTestRecordDto = Order & {
  items: OrderItem[];
};
export type PayoutBatchTestRecordDto = PayoutBatch;
export type PayoutBatchItemTestRecordDto = PayoutBatchItem;
export type PayoutBatchWithItemsTestRecordDto = PayoutBatch & {
  items: PayoutBatchItem[];
};
export type WebhookEventTestRecordDto = WebhookEvent;
export type TestBatchCountDto = Prisma.BatchPayload;

const db: TestDatabaseClient = prisma;

export async function resetTestDatabase(): Promise<TestBatchCountDto[]> {
  const results: TestBatchCountDto[] = await db.$transaction([
    db.session.deleteMany(),
    db.platformSettings.deleteMany(),
    db.user.deleteMany(),
    db.payoutBatchItem.deleteMany(),
    db.payoutBatch.deleteMany(),
    db.orderItem.deleteMany(),
    db.order.deleteMany(),
    db.webhookEvent.deleteMany(),
    db.item.deleteMany(),
    db.staff.deleteMany(),
    db.merchant.deleteMany(),
  ]);
  return results;
}

export async function disconnectTestDatabase(): Promise<void> {
  await db.$disconnect();
}

export async function createTestMerchant(
  data: Prisma.MerchantUncheckedCreateInput
): Promise<MerchantTestRecordDto> {
  const merchant: MerchantTestRecordDto = await db.merchant.create({ data });
  return merchant;
}

export async function createTestItem(
  data: Prisma.ItemUncheckedCreateInput
): Promise<ItemTestRecordDto> {
  const item: ItemTestRecordDto = await db.item.create({ data });
  return item;
}

export async function updateTestItemById(
  id: string,
  data: Prisma.ItemUncheckedUpdateInput
): Promise<ItemTestRecordDto> {
  const updatedItem: ItemTestRecordDto = await db.item.update({
    where: { id },
    data,
  });
  return updatedItem;
}

export async function createTestStaff(
  data: Prisma.StaffUncheckedCreateInput
): Promise<StaffTestRecordDto> {
  const staff: StaffTestRecordDto = await db.staff.create({ data });
  return staff;
}

export async function createTestOrder(
  data: Prisma.OrderUncheckedCreateInput
): Promise<OrderTestRecordDto> {
  const order: OrderTestRecordDto = await db.order.create({ data });
  return order;
}

export async function findTestOrderById(
  id: string
): Promise<OrderTestRecordDto | null> {
  const order: OrderTestRecordDto | null = await db.order.findUnique({
    where: { id },
  });
  return order;
}

export async function findTestOrderWithItemsById(
  id: string
): Promise<OrderWithItemsTestRecordDto | null> {
  const order: OrderWithItemsTestRecordDto | null = await db.order.findUnique({
    where: { id },
    include: { items: true },
  });
  return order;
}

export async function updateTestOrderById(
  id: string,
  data: Prisma.OrderUncheckedUpdateInput
): Promise<OrderTestRecordDto> {
  const updatedOrder: OrderTestRecordDto = await db.order.update({
    where: { id },
    data,
  });
  return updatedOrder;
}

export async function createTestOrderItem(
  data: Prisma.OrderItemUncheckedCreateInput
): Promise<OrderItemTestRecordDto> {
  const orderItem: OrderItemTestRecordDto = await db.orderItem.create({ data });
  return orderItem;
}

export async function createTestOrderItems(
  data: Prisma.OrderItemCreateManyInput[]
): Promise<TestBatchCountDto> {
  const batchResult: TestBatchCountDto = await db.orderItem.createMany({
    data,
  });
  return batchResult;
}

export async function createTestPayoutBatch(
  data: Prisma.PayoutBatchUncheckedCreateInput
): Promise<PayoutBatchTestRecordDto> {
  const batch: PayoutBatchTestRecordDto = await db.payoutBatch.create({ data });
  return batch;
}

export async function findTestPayoutBatchById(
  id: string
): Promise<PayoutBatchTestRecordDto | null> {
  const batch: PayoutBatchTestRecordDto | null =
    await db.payoutBatch.findUnique({
      where: { id },
    });
  return batch;
}

export async function findTestPayoutBatchWithItemsById(
  id: string
): Promise<PayoutBatchWithItemsTestRecordDto | null> {
  const batch: PayoutBatchWithItemsTestRecordDto | null =
    await db.payoutBatch.findUnique({
      where: { id },
      include: { items: true },
    });
  return batch;
}

export async function findTestPayoutBatchItemsByBatchId(
  payoutBatchId: string
): Promise<PayoutBatchItemTestRecordDto[]> {
  const batchItems: PayoutBatchItemTestRecordDto[] =
    await db.payoutBatchItem.findMany({
      where: { payoutBatchId },
    });
  return batchItems;
}

export async function findTestWebhookEventByEventId(
  eventId: string
): Promise<WebhookEventTestRecordDto | null> {
  const event: WebhookEventTestRecordDto | null =
    await db.webhookEvent.findUnique({
      where: { eventId },
    });
  return event;
}

export async function findTestWebhookEventsByEventId(
  eventId: string
): Promise<WebhookEventTestRecordDto[]> {
  const events: WebhookEventTestRecordDto[] = await db.webhookEvent.findMany({
    where: { eventId },
  });
  return events;
}
