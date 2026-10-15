import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { prisma, OrderStatus } from '@tabhop/database';
import { createApp } from '../../src/app.js';
import { FakePayPalGateway } from '../../src/modules/payments/fake-gateway.js';
import { SettlementService } from '../../src/modules/settlements/service.js';
import { WebhookService } from '../../src/modules/webhooks/service.js';
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

describe('Orders Routes', () => {
  let app: Express.Application;
  let testVenueId: string;
  let testItemId: string;
  let testStaffId: string;

  beforeEach(async () => {
    app = createTestApp();

    // Create test data
    const venue = await prisma.merchant.create({
      data: {
        businessName: 'Test Venue',
        merchantType: 'PRIMARY_VENUE',
        paypalEmail: 'venue@example.com',
      },
    });
    testVenueId = venue.id;

    const item = await prisma.item.create({
      data: {
        merchantId: venue.id,
        name: 'Test Item',
        description: 'Test item',
        price: new Decimal('19.99'),
        category: 'Food',
        isActive: true,
      },
    });
    testItemId = item.id;

    const staff = await prisma.staff.create({
      data: {
        venueId: venue.id,
        displayName: 'Test Server',
        paypalEmail: 'staff@example.com',
      },
    });
    testStaffId = staff.id;
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.order.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.staff.deleteMany({});
    await prisma.item.deleteMany({});
    await prisma.merchant.deleteMany({});
  });

  describe('POST /orders', () => {
    it('should create a valid order and return 201', async () => {
      const payload = {
        venueId: testVenueId,
        tableNumber: '1',
        serverStaffId: testStaffId,
        lines: [{ itemId: testItemId, quantity: 2 }],
        tipAmount: 5.00,
      };

      const response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('success');
      expect(response.body.order).toHaveProperty('id');
      expect(response.body.order.status).toBe(OrderStatus.PENDING);
      expect(response.body.order.totalCents).toBeGreaterThan(0);

      // Verify order was created in database
      const order = await prisma.order.findUnique({
        where: { id: response.body.order.id },
        include: { items: true },
      });
      expect(order).toBeDefined();
      expect(order?.items.length).toBe(1);
    });

    it('should reject order with missing items', async () => {
      const payload = {
        venueId: testVenueId,
        lines: [{ itemId: 'invalid-uuid-format', quantity: 1 }],
      };

      const response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject order with inactive item', async () => {
      // Deactivate the item
      await prisma.item.update({
        where: { id: testItemId },
        data: { isActive: false },
      });

      const payload = {
        venueId: testVenueId,
        lines: [{ itemId: testItemId, quantity: 1 }],
      };

      const response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('ITEM_INACTIVE');
    });

    it('should return 404 when venue not found', async () => {
      const payload = {
        venueId: '00000000-0000-0000-0000-000000000000',
        lines: [{ itemId: testItemId, quantity: 1 }],
      };

      const response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should support idempotency key and return existing order', async () => {
      const idempotencyKey = 'test-key-123';
      const payload = {
        venueId: testVenueId,
        lines: [{ itemId: testItemId, quantity: 1 }],
        idempotencyKey,
      };

      const response1 = await request(app).post('/orders').send(payload);
      expect(response1.status).toBe(201);
      const orderId1 = response1.body.order.id;

      const response2 = await request(app).post('/orders').send(payload);
      expect(response2.status).toBe(200);
      expect(response2.body.order.id).toBe(orderId1);
    });

    it('should reject order with negative tip amount', async () => {
      const payload = {
        venueId: testVenueId,
        lines: [{ itemId: testItemId, quantity: 1 }],
        tipAmount: -5.00,
      };

      const response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should compute correct pricing with multiple items', async () => {
      const payload = {
        venueId: testVenueId,
        lines: [{ itemId: testItemId, quantity: 3 }],
      };

      const response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(201);
      // 19.99 * 3 = 59.97
      // subtotal = 5997 cents
      // tax (8%) = 479 cents
      // fee (5%) = 299 cents
      // total = 6775 cents
      expect(response.body.order.subtotalCents).toBe(5997);
      expect(response.body.order.taxCents).toBe(479);
      expect(response.body.order.platformFeeCents).toBe(299);
      expect(response.body.order.totalCents).toBe(5997 + 479 + 299);
    });
  });

  describe('GET /orders/:id', () => {
    it('should retrieve order by ID', async () => {
      // Create an order first
      const order = await prisma.order.create({
        data: {
          venueId: testVenueId,
          subtotalAmount: new Decimal('19.99'),
          taxAmount: new Decimal('1.60'),
          platformFeeAmount: new Decimal('0.99'),
          totalAmount: new Decimal('22.58'),
          status: OrderStatus.PENDING,
        },
      });

      const response = await request(app).get(`/orders/${order.id}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.order.id).toBe(order.id);
      expect(response.body.order.venueId).toBe(testVenueId);
      expect(response.body.order.status).toBe(OrderStatus.PENDING);
    });

    it('should return 404 when order not found', async () => {
      const response = await request(app).get('/orders/00000000-0000-0000-0000-000000000000');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should reject invalid UUID format', async () => {
      const response = await request(app).get('/orders/invalid-id');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should include order items in response', async () => {
      const order = await prisma.order.create({
        data: {
          venueId: testVenueId,
          subtotalAmount: new Decimal('19.99'),
          taxAmount: new Decimal('1.60'),
          platformFeeAmount: new Decimal('0.99'),
          totalAmount: new Decimal('22.58'),
          status: OrderStatus.PENDING,
        },
      });

      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          itemId: testItemId,
          quantity: 2,
          unitPrice: new Decimal('19.99'),
        },
      });

      const response = await request(app).get(`/orders/${order.id}`);

      expect(response.status).toBe(200);
      expect(response.body.order.items.length).toBe(1);
      expect(response.body.order.items[0].itemId).toBe(testItemId);
      expect(response.body.order.items[0].quantity).toBe(2);
    });

    it('should include payout batch if exists', async () => {
      const order = await prisma.order.create({
        data: {
          venueId: testVenueId,
          subtotalAmount: new Decimal('19.99'),
          taxAmount: new Decimal('1.60'),
          platformFeeAmount: new Decimal('0.99'),
          totalAmount: new Decimal('22.58'),
          status: OrderStatus.CAPTURED,
        },
      });

      const batch = await prisma.payoutBatch.create({
        data: {
          orderId: order.id,
          status: 'QUEUED',
        },
      });

      const response = await request(app).get(`/orders/${order.id}`);

      expect(response.status).toBe(200);
      expect(response.body.order.payoutBatch).toBeDefined();
      expect(response.body.order.payoutBatch.id).toBe(batch.id);
    });
  });
});
