import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { prisma, PayoutStatus } from '@tabhop/database';
import { createApp } from '../../src/app.js';
import { SettlementService } from '../../src/settlements/settlements.service.js';
import { FakePayPalGateway } from '../../src/payments/payments.fake-gateway.js';
import { WebhookService } from '../../src/webhooks/webhooks.service.js';
import { Decimal } from '@prisma/client';

// Create Express app for testing
function createTestApp() {
  const app = createApp();

  const gateway = new FakePayPalGateway();
  const settlementService = new SettlementService(gateway);
  const webhookService = new WebhookService();

  app.locals.gateway = gateway;
  app.locals.settlementService = settlementService;
  app.locals.webhookService = webhookService;
  app.locals.paypalMode = 'fake';

  return app;
}

describe('Settlements Routes', () => {
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

  describe('POST /settlements/:orderId/retry', () => {
    it('should retry a failed settlement batch', async () => {
      // Create order with failed batch
      const order = await prisma.order.create({
        data: {
          venueId: testVenueId,
          subtotalAmount: new Decimal('100.00'),
          taxAmount: new Decimal('8.00'),
          platformFeeAmount: new Decimal('5.00'),
          totalAmount: new Decimal('113.00'),
          status: 'CAPTURED',
        },
      });

      const item = await prisma.item.create({
        data: {
          merchantId: testVenueId,
          name: 'Retry Item',
          description: 'Retry item',
          price: new Decimal('100.00'),
          category: 'Food',
          isActive: true,
        },
      });
      await prisma.orderItem.create({
        data: { orderId: order.id, itemId: item.id, quantity: 1, unitPrice: new Decimal('100.00') },
      });

      const batch = await prisma.payoutBatch.create({
        data: {
          orderId: order.id,
          status: PayoutStatus.FAILED,
          lastError: 'Previous error',
        },
      });

      const response = await request(app)
        .post(`/settlements/${order.id}/retry`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.payoutBatch).toBeDefined();
    });

    it('should return 400 for invalid order ID format', async () => {
      const response = await request(app)
        .post('/settlements/invalid-id/retry')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 when order not found', async () => {
      const response = await request(app)
        .post('/settlements/00000000-0000-0000-0000-000000000000/retry')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 404 when batch does not exist', async () => {
      const order = await prisma.order.create({
        data: {
          venueId: testVenueId,
          subtotalAmount: new Decimal('100.00'),
          taxAmount: new Decimal('8.00'),
          platformFeeAmount: new Decimal('5.00'),
          totalAmount: new Decimal('113.00'),
          status: 'CAPTURED',
        },
      });

      const response = await request(app)
        .post(`/settlements/${order.id}/retry`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 409 when batch not in FAILED state', async () => {
      const order = await prisma.order.create({
        data: {
          venueId: testVenueId,
          subtotalAmount: new Decimal('100.00'),
          taxAmount: new Decimal('8.00'),
          platformFeeAmount: new Decimal('5.00'),
          totalAmount: new Decimal('113.00'),
          status: 'CAPTURED',
        },
      });

      const batch = await prisma.payoutBatch.create({
        data: {
          orderId: order.id,
          status: PayoutStatus.PROCESSING,
        },
      });

      const response = await request(app)
        .post(`/settlements/${order.id}/retry`)
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('SETTLEMENT_INVALID_TRANSITION');
    });
  });

  describe('GET /settlements', () => {
    beforeEach(async () => {
      // Create test orders and batches
      for (let i = 0; i < 15; i++) {
        const order = await prisma.order.create({
          data: {
            venueId: testVenueId,
            subtotalAmount: new Decimal('100.00'),
            taxAmount: new Decimal('8.00'),
            platformFeeAmount: new Decimal('5.00'),
            totalAmount: new Decimal('113.00'),
            status: 'CAPTURED',
          },
        });

        await prisma.payoutBatch.create({
          data: {
            orderId: order.id,
            status: i % 2 === 0 ? PayoutStatus.COMPLETED : PayoutStatus.FAILED,
          },
        });
      }
    });

    it('should return paginated settlements list', async () => {
      const response = await request(app).get('/settlements');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.data).toBeDefined();
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.pageSize).toBe(10);
      expect(response.body.pagination.total).toBe(15);
      expect(response.body.pagination.pages).toBe(2);
    });

    it('should respect custom page size', async () => {
      const response = await request(app).get('/settlements?pageSize=5');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(5);
      expect(response.body.pagination.pageSize).toBe(5);
      expect(response.body.pagination.pages).toBe(3);
    });

    it('should support pagination', async () => {
      const response = await request(app).get('/settlements?page=2&pageSize=5');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(5);
      expect(response.body.pagination.page).toBe(2);
    });

    it('should filter by venueId', async () => {
      // Create another venue
      const venue2 = await prisma.merchant.create({
        data: {
          businessName: 'Test Venue 2',
          merchantType: 'PRIMARY_VENUE',
          paypalEmail: 'venue2@example.com',
        },
      });

      const order = await prisma.order.create({
        data: {
          venueId: venue2.id,
          subtotalAmount: new Decimal('100.00'),
          taxAmount: new Decimal('8.00'),
          platformFeeAmount: new Decimal('5.00'),
          totalAmount: new Decimal('113.00'),
          status: 'CAPTURED',
        },
      });

      await prisma.payoutBatch.create({
        data: {
          orderId: order.id,
          status: PayoutStatus.COMPLETED,
        },
      });

      const response = await request(app).get(`/settlements?venueId=${testVenueId}`);

      expect(response.status).toBe(200);
      expect(response.body.pagination.total).toBe(15);
    });

    it('should filter by status', async () => {
      const response = await request(app).get(`/settlements?status=COMPLETED`);

      expect(response.status).toBe(200);
      // 15 total, half are COMPLETED (8)
      expect(response.body.pagination.total).toBe(8);
    });

    it('should filter by date range', async () => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const response = await request(app).get(
        `/settlements?startDate=${now.toISOString()}&endDate=${tomorrow.toISOString()}`
      );

      expect(response.status).toBe(200);
      // Should include today's batches
      expect(response.body.pagination.total).toBeGreaterThan(0);
    });

    it('should return 400 for invalid query parameters', async () => {
      const response = await request(app).get('/settlements?page=invalid');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should include settlement details in response', async () => {
      const response = await request(app).get('/settlements?pageSize=1');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(1);

      const row = response.body.data[0];
      expect(row.orderId).toBeDefined();
      expect(row.venueName).toBe('Test Venue');
      expect(row.partnerNames).toBeDefined();
      expect(row.subtotalCents).toBeDefined();
      expect(row.taxCents).toBeDefined();
      expect(row.tipCents).toBeDefined();
      expect(row.platformFeeCents).toBeDefined();
      expect(row.totalCents).toBeDefined();
      expect(row.status).toBeDefined();
      expect(row.attempts).toBeDefined();
      expect(row.createdAt).toBeDefined();
    });
  });
});
