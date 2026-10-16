import { prisma, PayoutStatus, Prisma, RecipientType } from '@tabhop/database';
import type { SplitRow } from '../orders/orders.model.js';
import type { Email } from '../lib/email.js';
import { fromCents } from '../lib/money.js';
import type {
  PayoutBatchRecordDto,
  SettlementBatchWithRelationsDto,
  SettlementOrderWithBatchDto,
  SettlementOrderWithRelationsDto,
} from './settlements.model.js';

/**
 * Database models accessed by the Settlements module:
 * - Order (with Venue, ServerStaff, OrderItems->Item->Merchant, PayoutBatch relations)
 * - PayoutBatch
 * - PayoutBatchItem
 */
export type SettlementsDatabaseClient = Pick<
  typeof prisma,
  'order' | 'payoutBatch' | 'payoutBatchItem' | '$transaction'
>;

type SettlementTransactionClient = Pick<
  typeof prisma,
  'payoutBatch' | 'payoutBatchItem'
>;

export interface SettlementWhereFilter {
  order?: { venueId: string };
  status?: PayoutStatus;
  createdAt?: { gte?: Date; lte?: Date };
}

const db: SettlementsDatabaseClient = prisma;

export async function findOrderForSettlementDispatch(
  orderId: string
): Promise<SettlementOrderWithRelationsDto> {
  const order: SettlementOrderWithRelationsDto | null =
    (await db.order.findUnique({
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
    })) as SettlementOrderWithRelationsDto | null;

  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  return order;
}

export async function savePayoutBatchTransaction(params: {
  orderId: string;
  existingBatch: PayoutBatchRecordDto | null;
  split: SplitRow[];
}): Promise<PayoutBatchRecordDto> {
  const createdBatch: PayoutBatchRecordDto = await db.$transaction(
    async (tx: SettlementTransactionClient) => {
      let newBatch: PayoutBatchRecordDto;
      if (params.existingBatch) {
        await tx.payoutBatchItem.deleteMany({
          where: { payoutBatchId: params.existingBatch.id },
        });
        const updatedBatch: PayoutBatchRecordDto = await tx.payoutBatch.update({
          where: { id: params.existingBatch.id },
          data: {
            status: PayoutStatus.PROCESSING,
            attempts: params.existingBatch.attempts + 1,
            lastError: null,
          },
        });
        newBatch = updatedBatch;
      } else {
        const initialBatch: PayoutBatchRecordDto = await tx.payoutBatch.create({
          data: {
            orderId: params.orderId,
            status: PayoutStatus.PROCESSING,
            attempts: 1,
          },
        });
        newBatch = initialBatch;
      }

      const items: { payoutBatchId: string; merchantId: string | null; staffId: string | null; recipientType: RecipientType; receiverEmail: Email; amount: Prisma.Decimal; currency: string; senderItemId: string; status: "PROCESSING"; }[] = params.split.map((row, index) => ({
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
    }
  );
  return createdBatch;
}

export async function updatePayoutBatchDispatched(params: {
  batchId: string;
  paypalBatchId: string;
  status: PayoutStatus;
  dispatchedAt: Date;
}): Promise<PayoutBatchRecordDto> {
  const updatedBatch: PayoutBatchRecordDto = await db.payoutBatch.update({
    where: { id: params.batchId },
    data: {
      paypalBatchId: params.paypalBatchId,
      status: params.status,
      dispatchedAt: params.dispatchedAt,
    },
  });
  return updatedBatch;
}

export async function updatePayoutBatchFailed(
  batchId: string,
  lastError: string
): Promise<PayoutBatchRecordDto> {
  const updatedBatch: PayoutBatchRecordDto = await db.payoutBatch.update({
    where: { id: batchId },
    data: {
      status: PayoutStatus.FAILED,
      lastError,
    },
  });
  return updatedBatch;
}

export async function findOrderWithBatchById(
  orderId: string
): Promise<SettlementOrderWithBatchDto | null> {
  const order: SettlementOrderWithBatchDto | null = await db.order.findUnique({
    where: { id: orderId },
    include: { payoutBatch: true },
  });
  return order;
}

export async function countPayoutBatches(
  whereClause: SettlementWhereFilter
): Promise<number> {
  const total: number = await db.payoutBatch.count({ where: whereClause });
  return total;
}

export async function findPayoutBatchesWithRelations(params: {
  whereClause: SettlementWhereFilter;
  skip: number;
  take: number;
}): Promise<SettlementBatchWithRelationsDto[]> {
  const batches: SettlementBatchWithRelationsDto[] =
    await db.payoutBatch.findMany({
      where: params.whereClause,
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
      skip: params.skip,
      take: params.take,
    });
  return batches;
}
