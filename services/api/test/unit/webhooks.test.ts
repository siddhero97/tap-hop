import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderStatus } from '../../src/orders/orders.model';
import { PayoutStatus } from '@tabhop/database';

// Set up mock BEFORE importing WebhookService
vi.mock('@tabhop/database', () => ({
  PayoutStatus: {
    QUEUED: 'QUEUED',
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
  },
  OrderStatus: {
    PENDING: 'PENDING',
    AUTHORIZED: 'AUTHORIZED',
    CAPTURED: 'CAPTURED',
    FAILED: 'FAILED',
  },
}));

import { WebhookService } from '../../src/webhooks/webhooks.service';
import type { WebhookPayload } from '../../src/webhooks/webhooks.model';

describe('WebhookService', () => {
  let service: WebhookService;
  let mockPrisma: any;
  let mockGateway: any;
  let onSettlementDispatch: any;

  beforeEach(() => {
    // Mock Prisma client
    mockPrisma = {
      webhookEvent: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      payoutBatch: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

    // Mock PayPal Gateway
    mockGateway = {
      verifyWebhook: vi.fn(),
    };

    // Mock settlement dispatch callback
    onSettlementDispatch = vi.fn();

    service = new WebhookService(mockPrisma, onSettlementDispatch);
  });

  describe('processPayPalEvent', () => {
    describe('valid signature', () => {
      it('verifies signature and processes event', async () => {
        const headers = { 'x-signature': 'valid' };
        const payload: WebhookPayload = {
          id: 'evt-123',
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: {
            supplementary_data: {
              related_ids: {
                order_id: 'paypal-order-123',
              },
            },
          },
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);
        mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'webhook-1' });
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 'order-1',
          paypalOrderId: 'paypal-order-123',
          status: 'AUTHORIZED',
        });
        mockPrisma.order.update.mockResolvedValue({
          id: 'order-1',
          status: 'CAPTURED',
        });
        mockPrisma.webhookEvent.update.mockResolvedValue({
          id: 'webhook-1',
          processedAt: new Date(),
        });

        await service.processPayPalEvent(headers, rawBody, mockGateway);

        expect(mockGateway.verifyWebhook).toHaveBeenCalledWith(headers, rawBody);
        expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith({
          data: {
            provider: 'paypal',
            eventId: 'evt-123',
            eventType: 'PAYMENT.CAPTURE.COMPLETED',
            payload,
            verified: true,
          },
        });
        expect(mockPrisma.order.update).toHaveBeenCalled();
        expect(onSettlementDispatch).toHaveBeenCalledWith('order-1');
        expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
          where: { eventId: 'evt-123' },
          data: { processedAt: expect.any(Date) },
        });
      });
    });

    describe('unverified signature', () => {
      it('throws error when signature verification fails', async () => {
        const headers = { 'x-signature': 'invalid' };
        const payload: WebhookPayload = {
          id: 'evt-456',
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(false);
        mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'webhook-2' });

        await expect(
          service.processPayPalEvent(headers, rawBody, mockGateway)
        ).rejects.toThrow('Webhook signature verification failed');

        // Verify event was still stored but marked as unverified
        expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith({
          data: {
            provider: 'paypal',
            eventId: 'evt-456',
            eventType: 'PAYMENT.CAPTURE.COMPLETED',
            payload,
            verified: false,
          },
        });
      });
    });

    describe('replay protection', () => {
      it('returns early when eventId is duplicate', async () => {
        const headers = { 'x-signature': 'valid' };
        const payload: WebhookPayload = {
          id: 'evt-789',
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);
        mockPrisma.webhookEvent.findUnique.mockResolvedValue({
          id: 'webhook-3',
          eventId: 'evt-789',
          processedAt: new Date(),
        });

        await service.processPayPalEvent(headers, rawBody, mockGateway);

        // Should not create a new event
        expect(mockPrisma.webhookEvent.create).not.toHaveBeenCalled();
        // Should not process further
        expect(mockPrisma.order.update).not.toHaveBeenCalled();
      });
    });

    describe('PAYMENT.CAPTURE.COMPLETED', () => {
      it('updates order status to CAPTURED and dispatches settlement', async () => {
        const headers = { 'x-signature': 'valid' };
        const payload: WebhookPayload = {
          id: 'evt-capture-1',
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: {
            supplementary_data: {
              related_ids: {
                order_id: 'paypal-order-456',
              },
            },
          },
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);
        mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'webhook-4' });
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 'order-456',
          paypalOrderId: 'paypal-order-456',
          status: 'AUTHORIZED',
        });
        mockPrisma.order.update.mockResolvedValue({
          id: 'order-456',
          status: 'CAPTURED',
          capturedAt: new Date(),
        });
        mockPrisma.webhookEvent.update.mockResolvedValue({
          id: 'webhook-4',
          processedAt: new Date(),
        });

        await service.processPayPalEvent(headers, rawBody, mockGateway);

        expect(mockPrisma.order.update).toHaveBeenCalledWith({
          where: { id: 'order-456' },
          data: {
            status: OrderStatus.CAPTURED,
            capturedAt: expect.any(Date),
          },
        });
        expect(onSettlementDispatch).toHaveBeenCalledWith('order-456');
      });

      it('skips settlement dispatch if order already captured', async () => {
        const headers = { 'x-signature': 'valid' };
        const payload: WebhookPayload = {
          id: 'evt-capture-2',
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: {
            supplementary_data: {
              related_ids: {
                order_id: 'paypal-order-789',
              },
            },
          },
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);
        mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'webhook-5' });
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 'order-789',
          paypalOrderId: 'paypal-order-789',
          status: 'CAPTURED',
        });
        mockPrisma.webhookEvent.update.mockResolvedValue({
          id: 'webhook-5',
          processedAt: new Date(),
        });

        await service.processPayPalEvent(headers, rawBody, mockGateway);

        expect(mockPrisma.order.update).not.toHaveBeenCalled();
        expect(onSettlementDispatch).not.toHaveBeenCalled();
      });
    });

    describe('PAYMENT.PAYOUTSBATCH.SUCCESS', () => {
      it('updates payout batch status to SUCCESS', async () => {
        const headers = { 'x-signature': 'valid' };
        const payload: WebhookPayload = {
          id: 'evt-payout-success-1',
          event_type: 'PAYMENT.PAYOUTSBATCH.SUCCESS',
          resource: {
            id: 'paypal-batch-123',
            status: 'SUCCESS',
          },
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);
        mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'webhook-6' });
        mockPrisma.payoutBatch.findUnique.mockResolvedValue({
          id: 'batch-123',
          paypalBatchId: 'paypal-batch-123',
          status: 'PROCESSING',
        });
        mockPrisma.payoutBatch.update.mockResolvedValue({
          id: 'batch-123',
          status: 'SUCCESS',
        });
        mockPrisma.webhookEvent.update.mockResolvedValue({
          id: 'webhook-6',
          processedAt: new Date(),
        });

        await service.processPayPalEvent(headers, rawBody, mockGateway);

        expect(mockPrisma.payoutBatch.update).toHaveBeenCalledWith({
          where: { id: 'batch-123' },
          data: { status: PayoutStatus.COMPLETED },
        });
      });
    });

    describe('PAYMENT.PAYOUTSBATCH.DENIED', () => {
      it('updates payout batch status to DENIED', async () => {
        const headers = { 'x-signature': 'valid' };
        const payload: WebhookPayload = {
          id: 'evt-payout-denied-1',
          event_type: 'PAYMENT.PAYOUTSBATCH.DENIED',
          resource: {
            id: 'paypal-batch-456',
            status: 'DENIED',
          },
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);
        mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'webhook-7' });
        mockPrisma.payoutBatch.findUnique.mockResolvedValue({
          id: 'batch-456',
          paypalBatchId: 'paypal-batch-456',
          status: 'PROCESSING',
        });
        mockPrisma.payoutBatch.update.mockResolvedValue({
          id: 'batch-456',
          status: 'DENIED',
        });
        mockPrisma.webhookEvent.update.mockResolvedValue({
          id: 'webhook-7',
          processedAt: new Date(),
        });

        await service.processPayPalEvent(headers, rawBody, mockGateway);

        expect(mockPrisma.payoutBatch.update).toHaveBeenCalledWith({
          where: { id: 'batch-456' },
          data: { status: PayoutStatus.FAILED },
        });
      });
    });

    describe('unknown event type', () => {
      it('stores event but does not process', async () => {
        const headers = { 'x-signature': 'valid' };
        const payload: WebhookPayload = {
          id: 'evt-unknown-1',
          event_type: 'UNKNOWN.EVENT.TYPE',
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);
        mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'webhook-8' });
        mockPrisma.webhookEvent.update.mockResolvedValue({
          id: 'webhook-8',
          processedAt: new Date(),
        });

        await service.processPayPalEvent(headers, rawBody, mockGateway);

        expect(mockPrisma.webhookEvent.create).toHaveBeenCalled();
        expect(mockPrisma.order.update).not.toHaveBeenCalled();
        expect(mockPrisma.payoutBatch.update).not.toHaveBeenCalled();
        expect(mockPrisma.webhookEvent.update).toHaveBeenCalled();
      });
    });

    describe('edge cases', () => {
      it('throws error when payload JSON is invalid', async () => {
        const headers = { 'x-signature': 'valid' };
        const rawBody = 'not valid json';

        mockGateway.verifyWebhook.mockResolvedValue(true);

        await expect(
          service.processPayPalEvent(headers, rawBody, mockGateway)
        ).rejects.toThrow('Invalid webhook payload JSON');
      });

      it('throws error when eventId is missing', async () => {
        const headers = { 'x-signature': 'valid' };
        const payload: any = {
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);

        await expect(
          service.processPayPalEvent(headers, rawBody, mockGateway)
        ).rejects.toThrow('Webhook missing eventId or eventType');
      });

      it('throws error when eventType is missing', async () => {
        const headers = { 'x-signature': 'valid' };
        const payload: any = {
          id: 'evt-999',
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);

        await expect(
          service.processPayPalEvent(headers, rawBody, mockGateway)
        ).rejects.toThrow('Webhook missing eventId or eventType');
      });

      it('works without settlement dispatch callback', async () => {
        const serviceWithoutCallback = new WebhookService(mockPrisma);
        const headers = { 'x-signature': 'valid' };
        const payload: WebhookPayload = {
          id: 'evt-no-callback',
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: {
            supplementary_data: {
              related_ids: {
                order_id: 'paypal-order-999',
              },
            },
          },
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);
        mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'webhook-9' });
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 'order-999',
          paypalOrderId: 'paypal-order-999',
          status: 'AUTHORIZED',
        });
        mockPrisma.order.update.mockResolvedValue({
          id: 'order-999',
          status: 'CAPTURED',
        });
        mockPrisma.webhookEvent.update.mockResolvedValue({
          id: 'webhook-9',
          processedAt: new Date(),
        });

        await serviceWithoutCallback.processPayPalEvent(
          headers,
          rawBody,
          mockGateway
        );

        expect(mockPrisma.order.update).toHaveBeenCalled();
      });

      it('handles order not found for capture event gracefully', async () => {
        const headers = { 'x-signature': 'valid' };
        const payload: WebhookPayload = {
          id: 'evt-order-not-found',
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: {
            supplementary_data: {
              related_ids: {
                order_id: 'paypal-order-missing',
              },
            },
          },
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);
        mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'webhook-10' });
        mockPrisma.order.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.update.mockResolvedValue({
          id: 'webhook-10',
          processedAt: new Date(),
        });

        await service.processPayPalEvent(headers, rawBody, mockGateway);

        expect(mockPrisma.order.update).not.toHaveBeenCalled();
        expect(onSettlementDispatch).not.toHaveBeenCalled();
      });

      it('handles batch not found for payout event gracefully', async () => {
        const headers = { 'x-signature': 'valid' };
        const payload: WebhookPayload = {
          id: 'evt-batch-not-found',
          event_type: 'PAYMENT.PAYOUTSBATCH.SUCCESS',
          resource: {
            id: 'paypal-batch-missing',
          },
        };
        const rawBody = JSON.stringify(payload);

        mockGateway.verifyWebhook.mockResolvedValue(true);
        mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'webhook-11' });
        mockPrisma.payoutBatch.findUnique.mockResolvedValue(null);
        mockPrisma.webhookEvent.update.mockResolvedValue({
          id: 'webhook-11',
          processedAt: new Date(),
        });

        await service.processPayPalEvent(headers, rawBody, mockGateway);

        expect(mockPrisma.payoutBatch.update).not.toHaveBeenCalled();
      });
    });
  });
});
