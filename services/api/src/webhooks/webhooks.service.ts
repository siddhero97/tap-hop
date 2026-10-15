import { PayPalGateway } from '../payments/payments.gateway.js';
import { logger } from '../lib/logger.js';
import type { WebhookPayload } from './webhooks.model.js';

/**
 * WebhookService handles PayPal webhook events.
 * - Verifies signatures
 * - Prevents replay attacks with event ID deduplication
 * - Updates orders and payouts based on event type
 * - Provides extensible settlement dispatch
 */
export class WebhookService {
  constructor(
    private prisma: any,
    private onSettlementDispatch?: (orderId: string) => Promise<void>
  ) {}

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
    // Step 1: Verify webhook signature
    const isVerified = await paypalGateway.verifyWebhook(headers, rawBody);

    // Parse payload
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      logger.error({ error: String(e) }, 'Failed to parse webhook payload');
      throw new Error('Invalid webhook payload JSON');
    }

    const eventId = payload.id;
    const eventType = payload.event_type;

    if (!eventId || !eventType) {
      logger.error({ payload }, 'Webhook missing eventId or eventType');
      throw new Error('Webhook missing eventId or eventType');
    }

    // Step 2: Store webhook event (with replay protection)
    try {
      const existingEvent = await this.prisma.webhookEvent.findUnique({
        where: { eventId },
      });

      if (existingEvent) {
        // Duplicate event - replay protection
        logger.info({ eventId, eventType }, 'Webhook replay detected');
        return;
      }

      await this.prisma.webhookEvent.create({
        data: {
          provider: 'paypal',
          eventId,
          eventType,
          payload,
          verified: isVerified,
        },
      });
    } catch (e) {
      logger.error({ error: String(e), eventId }, 'Failed to store webhook event');
      throw new Error('Failed to store webhook event');
    }

    // Step 3: If signature unverified, throw error
    if (!isVerified) {
      logger.warn({ eventId, eventType }, 'Webhook signature verification failed');
      throw new Error('Webhook signature verification failed');
    }

    // Step 4: Process event based on type
    try {
      await this.handleEventType(eventType, payload);
    } catch (e) {
      logger.error(
        { error: String(e), eventId, eventType },
        'Error processing webhook event'
      );
      throw e;
    }

    // Step 5: Mark as processed
    try {
      await this.prisma.webhookEvent.update({
        where: { eventId },
        data: { processedAt: new Date() },
      });
    } catch (e) {
      logger.error({ error: String(e), eventId }, 'Failed to mark event as processed');
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
    const paypalOrderId = payload.resource?.supplementary_data?.related_ids?.order_id;

    if (!paypalOrderId) {
      logger.warn(
        { payload },
        'PAYMENT.CAPTURE.COMPLETED missing paypalOrderId'
      );
      return;
    }

    // Load order by paypalOrderId
    const order = await this.prisma.order.findUnique({
      where: { paypalOrderId },
    });

    if (!order) {
      logger.warn({ paypalOrderId }, 'Order not found for capture event');
      return;
    }

    // If not already captured, update status and dispatch settlement
    if (order.status !== 'CAPTURED') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'CAPTURED',
          capturedAt: new Date(),
        },
      });

      logger.info({ orderId: order.id, paypalOrderId }, 'Order marked as captured');

      // Dispatch settlement if callback is provided
      if (this.onSettlementDispatch) {
        await this.onSettlementDispatch(order.id);
      }
    }
  }

  private async handlePayoutBatchStatusChanged(
    eventType: string,
    payload: WebhookPayload
  ): Promise<void> {
    const paypalBatchId = payload.resource?.id;

    if (!paypalBatchId) {
      logger.warn({ eventType, payload }, 'Payout batch event missing batch ID');
      return;
    }

    // Map event type to batch status
    const statusMap: Record<string, 'SUCCESS' | 'DENIED'> = {
      'PAYMENT.PAYOUTSBATCH.SUCCESS': 'SUCCESS',
      'PAYMENT.PAYOUTSBATCH.DENIED': 'DENIED',
    };

    const newStatus = statusMap[eventType];
    if (!newStatus) {
      logger.error({ eventType }, 'Unknown payout batch event type');
      return;
    }

    // Update payout batch status
    const payoutBatch = await this.prisma.payoutBatch.findUnique({
      where: { paypalBatchId },
    });

    if (!payoutBatch) {
      logger.warn({ paypalBatchId }, 'PayoutBatch not found for payout event');
      return;
    }

    await this.prisma.payoutBatch.update({
      where: { id: payoutBatch.id },
      data: { status: newStatus },
    });

    logger.info(
      { paypalBatchId, newStatus },
      'PayoutBatch status updated'
    );
  }
}
