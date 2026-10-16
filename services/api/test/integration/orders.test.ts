import { describe, it, expect, beforeEach, vi } from 'vitest';
import request, { type Response } from 'supertest';
import { prisma, OrderStatus } from '@tabhop/database';
import { createApp } from '../../src/app.js';
import { FakePayPalGateway } from '../../src/payments/payments.fake-gateway.js';
import { SettlementService } from '../../src/settlements/settlements.service.js';
import { WebhookService } from '../../src/webhooks/webhooks.service.js';
import { Decimal } from '@prisma/client/runtime/library';
import * as ordersService from '../../src/orders/orders.service.js';
import {
  createTestMerchant,
  createTestItem,
  updateTestItemById,
  createTestStaff,
  createTestOrder,
  findTestOrderWithItemsById,
  createTestOrderItem,
  createTestPayoutBatch,
  type MerchantTestRecordDto,
  type ItemTestRecordDto,
  type StaffTestRecordDto,
  type OrderTestRecordDto,
  type OrderWithItemsTestRecordDto,
  type PayoutBatchTestRecordDto,
} from '../helpers/test-db.repository.js';

// Create Express app for testing
function createTestApp() {
  const app: ReturnType<typeof createApp> = createApp();

  const gateway: FakePayPalGateway = new FakePayPalGateway();
  const settlementService: SettlementService = new SettlementService(gateway);
  const webhookService: WebhookService = new WebhookService(prisma);

  app.locals.gateway = gateway;
  app.locals.settlementService = settlementService;
  app.locals.webhookService = webhookService;
  app.locals.paypalMode = 'fake';

  return app;
}

describe('Orders Routes', () => {
  let app: ReturnType<typeof createApp>;
  let testVenueId: string;
  let testItemId: string;
  let testStaffId: string;

  beforeEach(async () => {
    app = createTestApp();

    // Create test data
    const venue: MerchantTestRecordDto = await createTestMerchant({
      businessName: 'Test Venue',
      merchantType: 'PRIMARY_VENUE',
      paypalEmail: 'venue@example.com',
    });
    testVenueId = venue.id;

    const item: ItemTestRecordDto = await createTestItem({
      merchantId: venue.id,
      name: 'Test Item',
      description: 'Test item',
      price: new Decimal('19.99'),
      category: 'Food',
      isActive: true,
    });
    testItemId = item.id;

    const staff: StaffTestRecordDto = await createTestStaff({
      venueId: venue.id,
      displayName: 'Test Server',
      paypalEmail: 'staff@example.com',
    });
    testStaffId = staff.id;
  });

  describe('POST /orders', () => {
    it('should create a valid order and return 201', async () => {
      const payload: { venueId: string; tableNumber: string; serverStaffId: string; lines: { itemId: string; quantity: number; }[]; tipAmount: number; } = {
        venueId: testVenueId,
        tableNumber: '1',
        serverStaffId: testStaffId,
        lines: [{ itemId: testItemId, quantity: 2 }],
        tipAmount: 5.00,
      };

      const response: Response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('success');
      expect(response.body.order).toHaveProperty('id');
      expect(response.body.order.status).toBe(OrderStatus.PENDING);
      expect(response.body.order.totalCents).toBeGreaterThan(0);

      // Verify order was created in database
      const order: OrderWithItemsTestRecordDto | null =
        await findTestOrderWithItemsById(response.body.order.id);
      expect(order).toBeDefined();
      expect(order?.items.length).toBe(1);
    });

    it('should reject order with missing items', async () => {
      const payload: { venueId: string; lines: { itemId: string; quantity: number; }[]; } = {
        venueId: testVenueId,
        lines: [{ itemId: 'invalid-uuid-format', quantity: 1 }],
      };

      const response: Response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject order with inactive item', async () => {
      // Deactivate the item
      await updateTestItemById(testItemId, { isActive: false });

      const payload: { venueId: string; lines: { itemId: string; quantity: number; }[]; } = {
        venueId: testVenueId,
        lines: [{ itemId: testItemId, quantity: 1 }],
      };

      const response: Response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('ITEM_INACTIVE');
    });

    it('should return 404 when venue not found', async () => {
      const payload: { venueId: string; lines: { itemId: string; quantity: number; }[]; } = {
        venueId: '00000000-0000-0000-0000-000000000000',
        lines: [{ itemId: testItemId, quantity: 1 }],
      };

      const response: Response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should support idempotency key and return existing order', async () => {
      const idempotencyKey: string = 'test-key-123';
      const payload: { venueId: string; lines: { itemId: string; quantity: number; }[]; idempotencyKey: string; } = {
        venueId: testVenueId,
        lines: [{ itemId: testItemId, quantity: 1 }],
        idempotencyKey,
      };

      const response1: Response = await request(app).post('/orders').send(payload);
      expect(response1.status).toBe(201);
      const orderId1: string = response1.body.order.id;

      const response2: Response = await request(app).post('/orders').send(payload);
      expect(response2.status).toBe(200);
      expect(response2.body.order.id).toBe(orderId1);
    });

    it('should reject order with negative tip amount', async () => {
      const payload: { venueId: string; lines: { itemId: string; quantity: number; }[]; tipAmount: number; } = {
        venueId: testVenueId,
        lines: [{ itemId: testItemId, quantity: 1 }],
        tipAmount: -5.00,
      };

      const response: Response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject order with negative, zero, or fractional item quantity', async () => {
      const negResponse: Response = await request(app)
        .post('/orders')
        .send({
          venueId: testVenueId,
          lines: [{ itemId: testItemId, quantity: -2 }],
        });
      expect(negResponse.status).toBe(400);
      expect(negResponse.body.code).toBe('VALIDATION_ERROR');

      const zeroResponse: Response = await request(app)
        .post('/orders')
        .send({
          venueId: testVenueId,
          lines: [{ itemId: testItemId, quantity: 0 }],
        });
      expect(zeroResponse.status).toBe(400);
      expect(zeroResponse.body.code).toBe('VALIDATION_ERROR');

      const fracResponse: Response = await request(app)
        .post('/orders')
        .send({
          venueId: testVenueId,
          lines: [{ itemId: testItemId, quantity: 1.5 }],
        });
      expect(fracResponse.status).toBe(400);
      expect(fracResponse.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject order with empty lines array', async () => {
      const response: Response = await request(app)
        .post('/orders')
        .send({
          venueId: testVenueId,
          lines: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject order when item in DB has negative price', async () => {
      const negItem: ItemTestRecordDto = await createTestItem({
        merchantId: testVenueId,
        name: 'Negative Price Item',
        description: 'Corrupted item with negative price',
        price: new Decimal('-5.00'),
        category: 'Food',
        isActive: true,
      });

      const response: Response = await request(app)
        .post('/orders')
        .send({
          venueId: testVenueId,
          lines: [{ itemId: negItem.id, quantity: 1 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_ITEM_PRICE');
    });

    it('should return 404 when venueId points to an EXTERNAL_PARTNER instead of PRIMARY_VENUE', async () => {
      const partner: MerchantTestRecordDto = await createTestMerchant({
        businessName: 'Partner Truck',
        merchantType: 'EXTERNAL_PARTNER',
        paypalEmail: 'partner@example.com',
      });

      const response: Response = await request(app)
        .post('/orders')
        .send({
          venueId: partner.id,
          lines: [{ itemId: testItemId, quantity: 1 }],
        });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should handle duplicate itemId lines in the same order and sum their quantities accurately', async () => {
      const payload: { venueId: string; lines: { itemId: string; quantity: number; }[]; } = {
        venueId: testVenueId,
        lines: [
          { itemId: testItemId, quantity: 1 },
          { itemId: testItemId, quantity: 2 },
        ],
      };

      const response: Response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(201);
      // Total 3 units of $19.99 = 5997 cents
      expect(response.body.order.subtotalCents).toBe(5997);
      expect(response.body.order.taxCents).toBe(479);
      expect(response.body.order.platformFeeCents).toBe(299);
      expect(response.body.order.totalCents).toBe(5997 + 479 + 299);
    });

    it('should compute correct pricing with multiple items', async () => {
      const payload: { venueId: string; lines: { itemId: string; quantity: number; }[]; } = {
        venueId: testVenueId,
        lines: [{ itemId: testItemId, quantity: 3 }],
      };

      const response: Response = await request(app).post('/orders').send(payload);

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

    it('should return 404 when item UUID does not exist', async () => {
      const payload: { venueId: string; lines: { itemId: string; quantity: number; }[]; } = {
        venueId: testVenueId,
        lines: [{ itemId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
      };

      const response: Response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 404 when serverStaffId does not exist or belongs to another venue', async () => {
      const payload: { venueId: string; serverStaffId: string; lines: { itemId: string; quantity: number; }[]; } = {
        venueId: testVenueId,
        serverStaffId: '00000000-0000-0000-0000-000000000000',
        lines: [{ itemId: testItemId, quantity: 1 }],
      };

      const response: Response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');

      // Also test when staff exists in DB but belongs to another venue
      const otherVenue: MerchantTestRecordDto = await createTestMerchant({
        businessName: 'Other Venue',
        merchantType: 'PRIMARY_VENUE',
        paypalEmail: 'othervenue@example.com',
      });
      const otherStaff: StaffTestRecordDto = await createTestStaff({
        venueId: otherVenue.id,
        displayName: 'Other Server',
        paypalEmail: 'otherstaff@example.com',
      });

      const crossVenueResponse: Response = await request(app)
        .post('/orders')
        .send({
          venueId: testVenueId,
          serverStaffId: otherStaff.id,
          lines: [{ itemId: testItemId, quantity: 1 }],
        });

      expect(crossVenueResponse.status).toBe(404);
      expect(crossVenueResponse.body.code).toBe('NOT_FOUND');
    });

    it('should return 500 on unexpected error in POST /orders', async () => {
      vi.spyOn(ordersService, 'createOrderWithItems').mockRejectedValueOnce(
        new Error('Unexpected DB error')
      );

      const payload: { venueId: string; lines: { itemId: string; quantity: number; }[]; } = {
        venueId: testVenueId,
        lines: [{ itemId: testItemId, quantity: 1 }],
      };

      const response: Response = await request(app).post('/orders').send(payload);

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /orders/:id', () => {
    it('should retrieve order by ID', async () => {
      // Create an order first
      const order: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        subtotalAmount: new Decimal('19.99'),
        taxAmount: new Decimal('1.60'),
        platformFeeAmount: new Decimal('0.99'),
        totalAmount: new Decimal('22.58'),
        status: OrderStatus.PENDING,
      });

      const response: Response = await request(app).get(`/orders/${order.id}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.order.id).toBe(order.id);
      expect(response.body.order.venueId).toBe(testVenueId);
      expect(response.body.order.status).toBe(OrderStatus.PENDING);
    });

    it('should return 404 when order not found', async () => {
      const response: Response = await request(app).get('/orders/00000000-0000-0000-0000-000000000000');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should reject invalid UUID format', async () => {
      const response: Response = await request(app).get('/orders/invalid-id');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should include order items in response', async () => {
      const order: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        subtotalAmount: new Decimal('19.99'),
        taxAmount: new Decimal('1.60'),
        platformFeeAmount: new Decimal('0.99'),
        totalAmount: new Decimal('22.58'),
        status: OrderStatus.PENDING,
      });

      await createTestOrderItem({
        orderId: order.id,
        itemId: testItemId,
        quantity: 2,
        unitPrice: new Decimal('19.99'),
      });

      const response: Response = await request(app).get(`/orders/${order.id}`);

      expect(response.status).toBe(200);
      expect(response.body.order.items.length).toBe(1);
      expect(response.body.order.items[0].itemId).toBe(testItemId);
      expect(response.body.order.items[0].quantity).toBe(2);
    });

    it('should include payout batch if exists', async () => {
      const order: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        subtotalAmount: new Decimal('19.99'),
        taxAmount: new Decimal('1.60'),
        platformFeeAmount: new Decimal('0.99'),
        totalAmount: new Decimal('22.58'),
        status: OrderStatus.CAPTURED,
      });

      const batch: PayoutBatchTestRecordDto = await createTestPayoutBatch({
        orderId: order.id,
        status: 'QUEUED',
      });

      const response: Response = await request(app).get(`/orders/${order.id}`);

      expect(response.status).toBe(200);
      expect(response.body.order.payoutBatch).toBeDefined();
      expect(response.body.order.payoutBatch.id).toBe(batch.id);
    });

    it('should return 500 on unexpected error in GET /orders/:id', async () => {
      vi.spyOn(ordersService, 'getOrderDetails').mockRejectedValueOnce(
        new Error('Unexpected DB error')
      );

      const response: Response = await request(app).get('/orders/00000000-0000-0000-0000-000000000000');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
});
