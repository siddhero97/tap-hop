import { prisma, OrderStatus } from '@tabhop/database';
import type { PaymentOrderRecordDto } from './payments.model.js';

/**
 * Database models accessed by the Payments module:
 * - Order
 */
export type PaymentsDatabaseClient = Pick<typeof prisma, 'order'>;

const db: PaymentsDatabaseClient = prisma;

export async function findPaymentOrderById(
  orderId: string
): Promise<PaymentOrderRecordDto | null> {
  const order: PaymentOrderRecordDto | null = (await db.order.findUnique({
    where: { id: orderId },
  })) as PaymentOrderRecordDto | null;
  return order;
}

export async function updateOrderStatusFailed(
  orderId: string
): Promise<PaymentOrderRecordDto> {
  const updatedOrder: PaymentOrderRecordDto = (await db.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.FAILED },
  })) as PaymentOrderRecordDto;
  return updatedOrder;
}

export async function updateOrderAuthorized(
  orderId: string,
  paypalOrderId: string
): Promise<PaymentOrderRecordDto> {
  const updatedOrder: PaymentOrderRecordDto = (await db.order.update({
    where: { id: orderId },
    data: {
      paypalOrderId,
      status: OrderStatus.AUTHORIZED,
    },
  })) as PaymentOrderRecordDto;
  return updatedOrder;
}

export async function updateOrderCaptured(
  orderId: string,
  paypalCaptureId: string,
  capturedAt: Date
): Promise<PaymentOrderRecordDto> {
  const updatedOrder: PaymentOrderRecordDto = (await db.order.update({
    where: { id: orderId },
    data: {
      paypalCaptureId,
      status: OrderStatus.CAPTURED,
      capturedAt,
    },
  })) as PaymentOrderRecordDto;
  return updatedOrder;
}
