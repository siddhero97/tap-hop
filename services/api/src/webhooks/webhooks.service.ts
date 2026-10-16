import { PayPalGateway } from '../payments/payments.gateway.js';
import { PayPalBatchStatus } from '../payments/payments.model.js';
import { logger } from '../lib/logger.js';
import { OrderStatus } from '../orders/orders.model.js';
import { PayoutStatus } from '@tabhop/database';
import type {
  WebhookEventRecordDto,
  WebhookOrderRecordDto,
  WebhookPayload,
  WebhookPayoutBatchRecordDto,
} from './webhooks.model.js';
import {
  WebhookRepository,
  type WebhookPrismaClient,
} from './webhooks.repository.js';

export type { WebhookPrismaClient };

export interface WebhookProcessResponse {
  status: number;
  body:
    | { status: 'success' }
    | { status: 'error'; code: string; message: string };
}

/**
 * WebhookService handles PayPal webhook events.
 * - Verifies signatures
 * - Prevents replay attacks with event ID deduplication
 * - Updates orders and payouts based on event type
 * - Provides extensible settlement dispatch
 */
export class WebhookService {
  private repository: WebhookRepository;

  constructor(
    prisma: WebhookPrismaClient,
    private onSettlementDispatch?: (orderId: string) => Promise<void>
  ) {
    this.repository = new WebhookRepository(prisma);
  }

  private mapPayPalBatchStatusToPayoutStatus(status: string): PayoutStatus {
    let mappedStatus: PayoutStatus;
    switch (status) {
      case PayPalBatchStatus.SUCCESS:
        mappedStatus = PayoutStatus.COMPLETED;
        break;
      case PayPalBatchStatus.DENIED:
        mappedStatus = PayoutStatus.FAILED;
        break;
      default:
        throw new Error(`Unknown payout batch status: ${status}`);
    }
    return mappedStatus;
  }

  private async safeJsonParse(rawBody: string): Promise<WebhookPayload> {
    let parsed: WebhookPayload;
    try {
      parsed = JSON.parse(rawBody) as WebhookPayload;
    } catch (e) {
      logger.error({ error: String(e) }, 'Failed to parse webhook payload');
      throw new Error('Invalid webhook payload JSON');
    }
    return parsed;
  }

  /**
   * Process a PayPal webhook event.
   * - Verifies signature
   * - Stores event in DB with replay protection
   * - Processes event based on type
   * - Always marks processedAt on successful storage
   */
  async processPayPalEvent(
    headers: Record<string, string>,
    rawBody: string,
    paypalGateway: PayPalGateway
  ): Promise<void> {
    try {
      // Step 1: Verify webhook signature
      const isVerified: boolean = await paypalGateway.verifyWebhook(headers, rawBody);

      // Parse payload
      const payload: WebhookPayload = await this.safeJsonParse(rawBody);

      const eventId: string = payload.id;
      const eventType: string = payload.event_type;

      if (!eventId || !eventType) {
        logger.error({ payload }, 'Webhook missing eventId or eventType');
        throw new Error('Webhook missing eventId or eventType');
      }

      // Step 2: Store webhook event (with replay protection)
      const existingEvent: WebhookEventRecordDto | null =
        await this.repository.findWebhookEventByEventId(eventId);

      if (existingEvent) {
        // Duplicate event - replay protection
        logger.info({ eventId, eventType }, 'Webhook replay detected');
      } else {
        await this.repository.createWebhookEvent({
          provider: 'paypal',
          eventId,
          eventType,
          payload,
          verified: isVerified,
        });

        // Step 3: If signature unverified, throw error
        if (!isVerified) {
          logger.warn({ eventId, eventType }, 'Webhook signature verification failed');
          throw new Error('Webhook signature verification failed');
        }

        // Step 4: Process event based on type
        await this.handleEventType(eventType, payload);

        // Step 5: Mark as processed
        await this.repository.markWebhookEventProcessed(eventId, new Date());
      }
    } catch (e) {
      logger.error(
        { error: String(e) },
        'Error processing webhook event'
      );
      throw e;
    }
  }

  private async handleEventType(
    eventType: string,
    payload: WebhookPayload
  ): Promise<void> {
    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await this.handleCaptureCompleted(payload);
        break;
      case 'PAYMENT.PAYOUTSBATCH.SUCCESS':
      case 'PAYMENT.PAYOUTSBATCH.DENIED':
        await this.handlePayoutBatchStatusChanged(eventType, payload);
        break;
      default:
        // Unknown event type - log but don't process
        logger.info({ eventType }, 'Received unknown webhook event type');
    }
  }

  private async handleCaptureCompleted(payload: WebhookPayload): Promise<void> {
    try {
      const paypalOrderId: string | undefined = payload.resource?.supplementary_data?.related_ids?.order_id;

      if (!paypalOrderId) {
        logger.warn(
          { payload },
          'PAYMENT.CAPTURE.COMPLETED missing paypalOrderId'
        );
      } else {
        // Load order by paypalOrderId
        const order: WebhookOrderRecordDto | null =
          await this.repository.findOrderByPayPalOrderId(paypalOrderId);

        if (!order) {
          logger.warn({ paypalOrderId }, 'Order not found for capture event');
        } else if (order.status !== OrderStatus.CAPTURED) {
          await this.repository.markOrderCaptured(order.id, new Date());

          logger.info({ orderId: order.id, paypalOrderId }, 'Order marked as captured');

          // Dispatch settlement if callback is provided
          if (this.onSettlementDispatch) {
            await this.onSettlementDispatch(order.id);
          }
        }
      }
    } catch (e) {
      logger.error({ error: String(e) }, 'Error handling capture completed event');
      throw e;
    }
  }

  private async handlePayoutBatchStatusChanged(
    eventType: string,
    payload: WebhookPayload
  ): Promise<void> {
    try {
      const paypalBatchId: string | undefined = payload.resource?.id;

      if (!paypalBatchId) {
        logger.warn({ eventType, payload }, 'Payout batch event missing batch ID');
      } else {
        // Map event type to PayPal batch status
        const statusMap: Record<string, string> = {
          'PAYMENT.PAYOUTSBATCH.SUCCESS': PayPalBatchStatus.SUCCESS,
          'PAYMENT.PAYOUTSBATCH.DENIED': PayPalBatchStatus.DENIED,
        };

        const paypalStatus: string = statusMap[eventType];
        if (!paypalStatus) {
          logger.error({ eventType }, 'Unknown payout batch event type');
        } else {
          // Map PayPal status to PayoutStatus
          const newStatus: PayoutStatus = this.mapPayPalBatchStatusToPayoutStatus(paypalStatus);

          // Update payout batch status
          const payoutBatch: WebhookPayoutBatchRecordDto | null =
            await this.repository.findPayoutBatchByPayPalBatchId(paypalBatchId);

          if (!payoutBatch) {
            logger.warn({ paypalBatchId }, 'PayoutBatch not found for payout event');
          } else {
            await this.repository.updatePayoutBatchStatus(payoutBatch.id, newStatus);

            logger.info(
              { paypalBatchId, newStatus },
              'PayoutBatch status updated'
            );
          }
        }
      }
    } catch (e) {
      logger.error({ error: String(e) }, 'Error handling payout batch status change');
      throw e;
    }
  }
}

/**
 * Process webhook event and return appropriate response
 * Always returns 200 for webhooks (PayPal doesn't retry on 4xx)
 */
export async function processWebhookEvent(
  service: WebhookService,
  headers: Record<string, string>,
  rawBody: string,
  paypalGateway: PayPalGateway
): Promise<WebhookProcessResponse> {
  let response: WebhookProcessResponse;
  try {
    await service.processPayPalEvent(headers, rawBody, paypalGateway);
    logger.info('Webhook processed successfully');
    response = {
      status: 200,
      body: { status: 'success' },
    };
  } catch (processingError) {
    logger.warn(
      { error: String(processingError) },
      'Webhook processing failed'
    );
    response = {
      status: 200,
      body: {
        status: 'error',
        code: 'PROCESSING_ERROR',
        message: (processingError as Error).message,
      },
    };
  }
  return response;
}
