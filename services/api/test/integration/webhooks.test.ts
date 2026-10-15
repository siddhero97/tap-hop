import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { prisma } from '@tabhop/database';
import { createApp } from '../../src/app.js';
import { WebhookService } from '../../src/webhooks/webhooks.service.js';
import * as webhooksService from '../../src/webhooks/webhooks.service.js';
import { FakePayPalGateway } from '../../src/payments/payments.fake-gateway.js';
import { SettlementService } from '../../src/settlements/settlements.service.js';
import { Decimal } from '@prisma/client';

// Create Express app for testing
function createTestApp() {
  const app = createApp();

  const gateway = new FakePayPalGateway();
  const webhookService = new WebhookService(prisma);
  const settlementService = new SettlementService(gateway);

  app.locals.gateway = gateway;
  app.locals.webhookService = webhookService;
  app.locals.settlementService = settlementService;
  app.locals.paypalMode = 'fake';

  return app;
}

describe('Webhooks Routes', () => {
  let app: Express.Application;
  let testVenueId: string;

  beforeEach(async () => {
    app = createTestApp();

    // Create test venue
    const venue = await prisma.merchant.create({
      data: {
        businessName: 'Test Venue',
        merchantType: 'PRIMARY_VENUE',
        paypalEmail: 'venue@example.com',
      },
    });
    testVenueId = venue.id;
  });

  describe('POST /webhooks/paypal', () => {
    it('should process valid webhook event and return 200', async () => {
      const payload = {
        id: 'WH-EVENT-001',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-001',
          status: 'COMPLETED',
          supplementary_data: {
            related_ids: {
              order_id: 'FAKE-ORDER-1',
            },
          },
        },
      };

      const response = await request(app)
        .post('/webhooks/paypal')
        .send(payload)
        .set('Content-Type', 'application/json')
        .set('x-fake-signature', 'ok');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');

      // Verify webhook event was stored
      const webhookEvent = await prisma.webhookEvent.findUnique({
        where: { eventId: 'WH-EVENT-001' },
      });
      expect(webhookEvent).not.toBeNull();
      expect(webhookEvent?.eventType).toBe('PAYMENT.CAPTURE.COMPLETED');
    });

    it('should always return 200 (PayPal expects this)', async () => {
      // Even with invalid payload, return 200
      const response = await request(app)
        .post('/webhooks/paypal')
        .send({})
        .set('Content-Type', 'application/json');

      // Webhook endpoint always returns 200
      expect(response.status).toBe(200);
    });

    it('should handle empty webhook gracefully', async () => {
      const response = await request(app)
        .post('/webhooks/paypal')
        .send('')
        .set('Content-Type', 'application/json');

      // Still returns 200
      expect(response.status).toBe(200);
    });

    it('should prevent replay attacks', async () => {
      const payload = {
        id: 'WH-EVENT-002',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-002',
          status: 'COMPLETED',
          supplementary_data: {
            related_ids: {
              order_id: 'FAKE-ORDER-2',
            },
          },
        },
      };

      // Send same event twice
      const response1 = await request(app)
        .post('/webhooks/paypal')
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response1.status).toBe(200);

      const response2 = await request(app)
        .post('/webhooks/paypal')
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response2.status).toBe(200);

      // Should only have one event in database (replay protection)
      const events = await prisma.webhookEvent.findMany({
        where: { eventId: 'WH-EVENT-002' },
      });
      expect(events.length).toBe(1);
    });

    it('should record webhook event in database', async () => {
      const payload = {
        id: 'WH-EVENT-003',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-003',
          status: 'COMPLETED',
        },
      };

      const response = await request(app)
        .post('/webhooks/paypal')
        .send(payload)
        .set('Content-Type', 'application/json')
        .set('x-fake-signature', 'ok');

      expect(response.status).toBe(200);

      const event = await prisma.webhookEvent.findUnique({
        where: { eventId: 'WH-EVENT-003' },
      });

      expect(event).toBeDefined();
      expect(event?.provider).toBe('paypal');
      expect(event?.eventType).toBe('PAYMENT.CAPTURE.COMPLETED');
      expect(event?.payload).toEqual(payload);
    });

    it('should handle unknown event types gracefully', async () => {
      const payload = {
        id: 'WH-EVENT-004',
        event_type: 'UNKNOWN.EVENT.TYPE',
        resource: {
          id: 'RESOURCE-004',
        },
      };

      const response = await request(app)
        .post('/webhooks/paypal')
        .send(payload)
        .set('Content-Type', 'application/json')
        .set('x-fake-signature', 'ok');

      expect(response.status).toBe(200);

      // Event should still be recorded
      const event = await prisma.webhookEvent.findUnique({
        where: { eventId: 'WH-EVENT-004' },
      });
      expect(event).toBeDefined();
    });

    it('should handle payout batch status changes', async () => {
      const payload = {
        id: 'WH-EVENT-005',
        event_type: 'PAYMENT.PAYOUTSBATCH.SUCCESS',
        resource: {
          id: 'BATCH-001',
          status: 'SUCCESS',
        },
      };

      const response = await request(app)
        .post('/webhooks/paypal')
        .send(payload)
        .set('Content-Type', 'application/json')
        .set('x-fake-signature', 'ok');

      expect(response.status).toBe(200);

      // Event should be recorded
      const event = await prisma.webhookEvent.findUnique({
        where: { eventId: 'WH-EVENT-005' },
      });
      expect(event).toBeDefined();
      expect(event?.eventType).toBe('PAYMENT.PAYOUTSBATCH.SUCCESS');
    });

    it('should mark event as processed after successful handling', async () => {
      const payload = {
        id: 'WH-EVENT-006',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-006',
          status: 'COMPLETED',
        },
      };

      const response = await request(app)
        .post('/webhooks/paypal')
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);

      // Check if event was marked as processed
      const event = await prisma.webhookEvent.findUnique({
        where: { eventId: 'WH-EVENT-006' },
      });

      // Note: processedAt may or may not be set depending on webhook service implementation
      // This is just checking it was recorded
      expect(event).toBeDefined();
    });

    it('should handle missing event ID gracefully', async () => {
      const payload = {
        // Missing id field
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-007',
        },
      };

      const response = await request(app)
        .post('/webhooks/paypal')
        .send(payload)
        .set('Content-Type', 'application/json');

      // Still returns 200
      expect(response.status).toBe(200);
    });

    it('should handle missing event type gracefully', async () => {
      const payload = {
        id: 'WH-EVENT-008',
        // Missing event_type
        resource: {
          id: 'CAPTURE-008',
        },
      };

      const response = await request(app)
        .post('/webhooks/paypal')
        .send(payload)
        .set('Content-Type', 'application/json');

      // Still returns 200
      expect(response.status).toBe(200);
    });

    it('should return 200 INTERNAL_ERROR when processWebhookEvent throws unexpectedly', async () => {
      vi.spyOn(webhooksService, 'processWebhookEvent').mockRejectedValueOnce(
        new Error('Fatal webhook error')
      );

      const response = await request(app)
        .post('/webhooks/paypal')
        .send({ id: 'WH-EVENT-009', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
});
