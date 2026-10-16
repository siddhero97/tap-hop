import { prisma as defaultPrisma, PayoutStatus } from '@tabhop/database';
import { OrderStatus } from '../orders/orders.model.js';
import type {
  WebhookEventRecordDto,
  WebhookOrderRecordDto,
  WebhookPayload,
  WebhookPayoutBatchRecordDto,
} from './webhooks.model.js';

/**
 * Database models accessed by the Webhooks module:
 * - WebhookEvent
 * - Order
 * - PayoutBatch
 */
export type WebhookPrismaClient = Pick<
  typeof defaultPrisma,
  'webhookEvent' | 'order' | 'payoutBatch'
>;

export class WebhookRepository {
  constructor(private prisma: WebhookPrismaClient) {}

  async findWebhookEventByEventId(
    eventId: string
  ): Promise<WebhookEventRecordDto | null> {
    const existingEvent: WebhookEventRecordDto | null =
      await this.prisma.webhookEvent.findUnique({
        where: { eventId },
      });
    return existingEvent;
  }

  async createWebhookEvent(data: {
    provider: string;
    eventId: string;
    eventType: string;
    payload: WebhookPayload;
    verified: boolean;
  }): Promise<WebhookEventRecordDto> {
    const createdEvent: WebhookEventRecordDto =
      await this.prisma.webhookEvent.create({
        data,
      });
    return createdEvent;
  }

  async markWebhookEventProcessed(
    eventId: string,
    processedAt: Date
  ): Promise<WebhookEventRecordDto> {
    const updatedEvent: WebhookEventRecordDto =
      await this.prisma.webhookEvent.update({
        where: { eventId },
        data: { processedAt },
      });
    return updatedEvent;
  }

  async findOrderByPayPalOrderId(
    paypalOrderId: string
  ): Promise<WebhookOrderRecordDto | null> {
    const order: WebhookOrderRecordDto | null =
      await this.prisma.order.findUnique({
        where: { paypalOrderId },
      });
    return order;
  }

  async markOrderCaptured(
    orderId: string,
    capturedAt: Date
  ): Promise<WebhookOrderRecordDto> {
    const updatedOrder: WebhookOrderRecordDto = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CAPTURED,
        capturedAt,
      },
    });
    return updatedOrder;
  }

  async findPayoutBatchByPayPalBatchId(
    paypalBatchId: string
  ): Promise<WebhookPayoutBatchRecordDto | null> {
    const payoutBatch: WebhookPayoutBatchRecordDto | null =
      await this.prisma.payoutBatch.findUnique({
        where: { paypalBatchId },
      });
    return payoutBatch;
  }

  async updatePayoutBatchStatus(
    batchId: string,
    status: PayoutStatus
  ): Promise<WebhookPayoutBatchRecordDto> {
    const updatedBatch: WebhookPayoutBatchRecordDto =
      await this.prisma.payoutBatch.update({
        where: { id: batchId },
        data: { status },
      });
    return updatedBatch;
  }
}
