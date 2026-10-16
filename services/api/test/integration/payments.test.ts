import { describe, it, expect, beforeEach } from 'vitest';
import request, { type Response } from 'supertest';
import { prisma, OrderStatus } from '@tabhop/database';
import { createApp } from '../../src/app.js';
import { SettlementService } from '../../src/settlements/settlements.service.js';
import { FakePayPalGateway } from '../../src/payments/payments.fake-gateway.js';
import { WebhookService } from '../../src/webhooks/webhooks.service.js';
import { Decimal } from '@prisma/client/runtime/library';
import { markOrderFailed } from '../../src/payments/payments.service.js';
import {
  createTestMerchant,
  createTestItem,
  createTestOrder,
  findTestOrderById,
  updateTestOrderById,
  createTestOrderItem,
  type MerchantTestRecordDto,
  type ItemTestRecordDto,
  type OrderTestRecordDto,
} from '../helpers/test-db.repository.js';

// Create Express app for testing
function createTestApp() {
  const app: ReturnType<typeof createApp> = createApp();

  // Setup test gateway and settlement service
  const gateway: FakePayPalGateway = new FakePayPalGateway();
  const settlementService: SettlementService = new SettlementService(gateway);
  const webhookService: WebhookService = new WebhookService(prisma);

  app.locals.gateway = gateway;
  app.locals.settlementService = settlementService;
  app.locals.webhookService = webhookService;
  app.locals.paypalMode = 'fake';

  return app;
}

describe('Payments Routes', () => {
  let app: ReturnType<typeof createApp>;
  let testVenueId: string;
  let testOrderId: string;
  let gateway: FakePayPalGateway;

  beforeEach(async () => {
    app = createTestApp();
    gateway = app.locals.gateway;

    // Create test venue
    const venue: MerchantTestRecordDto = await createTestMerchant({
      businessName: 'Test Venue',
      merchantType: 'PRIMARY_VENUE',
      paypalEmail: 'venue@example.com',
    });
    testVenueId = venue.id;

    // Create test order in PENDING state
    const order: OrderTestRecordDto = await createTestOrder({
      venueId: venue.id,
      subtotalAmount: new Decimal('100.00'),
      taxAmount: new Decimal('8.00'),
      platformFeeAmount: new Decimal('5.00'),
      totalAmount: new Decimal('113.00'),
      status: OrderStatus.PENDING,
    });
    testOrderId = order.id;
  });

  describe('POST /orders/:id/paypal', () => {
    it('should create PayPal order and return 201', async () => {
      const response: Response = await request(app).post(`/orders/${testOrderId}/paypal`).send({});

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('success');
      expect(response.body.paypalOrderId).toBeDefined();
      expect(response.body.approveUrl).toBeDefined();

      // Verify order status updated to AUTHORIZED
      const order: OrderTestRecordDto | null = await findTestOrderById(testOrderId);
      expect(order?.status).toBe(OrderStatus.AUTHORIZED);
      expect(order?.paypalOrderId).toBe(response.body.paypalOrderId);
    });

    it('should return 400 for invalid order ID format', async () => {
      const response: Response = await request(app).post('/orders/invalid-id/paypal').send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 when order not found', async () => {
      const response: Response = await request(app)
        .post('/orders/00000000-0000-0000-0000-000000000000/paypal')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 409 when order not in PENDING state', async () => {
      // Update order to AUTHORIZED
      await updateTestOrderById(testOrderId, { status: OrderStatus.AUTHORIZED });

      const response: Response = await request(app).post(`/orders/${testOrderId}/paypal`).send({});

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ORDER_INVALID_TRANSITION');
    });

    it('should support idempotency and return existing PayPal order', async () => {
      const response1: Response = await request(app).post(`/orders/${testOrderId}/paypal`).send({});
      expect(response1.status).toBe(201);
      const paypalOrderId1: string = response1.body.paypalOrderId;

      const response2: Response = await request(app).post(`/orders/${testOrderId}/paypal`).send({});
      expect(response2.status).toBe(200);
      expect(response2.body.paypalOrderId).toBe(paypalOrderId1);
    });

    it('should handle gateway errors gracefully', async () => {
      gateway.failNext('createOrder');

      const response: Response = await request(app).post(`/orders/${testOrderId}/paypal`).send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('PAYMENT_GATEWAY_ERROR');
    });

    it('should reject creating PayPal order when order totalAmount is negative or zero', async () => {
      const negativeOrder: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        subtotalAmount: new Decimal('-10.00'),
        taxAmount: new Decimal('0.00'),
        platformFeeAmount: new Decimal('0.00'),
        totalAmount: new Decimal('-10.00'),
        status: OrderStatus.PENDING,
      });

      const negResponse: Response = await request(app)
        .post(`/orders/${negativeOrder.id}/paypal`)
        .send({});
      expect(negResponse.status).toBe(400);
      expect(negResponse.body.code).toBe('INVALID_ORDER_AMOUNT');

      const zeroOrder: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        subtotalAmount: new Decimal('0.00'),
        taxAmount: new Decimal('0.00'),
        platformFeeAmount: new Decimal('0.00'),
        totalAmount: new Decimal('0.00'),
        status: OrderStatus.PENDING,
      });

      const zeroResponse: Response = await request(app)
        .post(`/orders/${zeroOrder.id}/paypal`)
        .send({});
      expect(zeroResponse.status).toBe(400);
      expect(zeroResponse.body.code).toBe('INVALID_ORDER_AMOUNT');
    });
  });

  describe('POST /orders/:id/capture', () => {
    let authorizedOrderId: string;

    beforeEach(async () => {
      const item: ItemTestRecordDto = await createTestItem({
        merchantId: testVenueId,
        name: 'Test Item',
        description: 'Test Item',
        price: new Decimal('100.00'),
        category: 'Food',
        isActive: true,
      });

      // Create and authorize an order with a matching OrderItem
      const authorizedOrder: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        paypalOrderId: 'FAKE-ORDER-1',
        subtotalAmount: new Decimal('100.00'),
        taxAmount: new Decimal('8.00'),
        platformFeeAmount: new Decimal('5.00'),
        totalAmount: new Decimal('113.00'),
        status: OrderStatus.AUTHORIZED,
      });
      authorizedOrderId = authorizedOrder.id;

      await createTestOrderItem({
        orderId: authorizedOrderId,
        itemId: item.id,
        quantity: 1,
        unitPrice: new Decimal('100.00'),
      });
    });

    it('should capture order and dispatch settlement', async () => {
      const response: Response = await request(app)
        .post(`/orders/${authorizedOrderId}/capture`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.order.status).toBe(OrderStatus.CAPTURED);
      expect(response.body.order.paypalCaptureId).toBeDefined();

      // Verify order status updated in database
      const order: OrderTestRecordDto | null = await findTestOrderById(authorizedOrderId);
      expect(order?.status).toBe(OrderStatus.CAPTURED);
      expect(order?.capturedAt).toBeDefined();
    });

    it('should return 400 for invalid order ID format', async () => {
      const response: Response = await request(app).post('/orders/invalid-id/capture').send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 when order not found', async () => {
      const response: Response = await request(app)
        .post('/orders/00000000-0000-0000-0000-000000000000/capture')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 409 when order not in AUTHORIZED state', async () => {
      // Create a pending order
      const pendingOrder: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        subtotalAmount: new Decimal('100.00'),
        taxAmount: new Decimal('8.00'),
        platformFeeAmount: new Decimal('5.00'),
        totalAmount: new Decimal('113.00'),
        status: OrderStatus.PENDING,
      });

      const response: Response = await request(app)
        .post(`/orders/${pendingOrder.id}/capture`)
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ORDER_INVALID_TRANSITION');
    });

    it('should return 409 on double capture attempt after order is already CAPTURED', async () => {
      const firstCapture: Response = await request(app)
        .post(`/orders/${authorizedOrderId}/capture`)
        .send({});
      expect(firstCapture.status).toBe(200);

      const secondCapture: Response = await request(app)
        .post(`/orders/${authorizedOrderId}/capture`)
        .send({});
      expect(secondCapture.status).toBe(409);
      expect(secondCapture.body.code).toBe('ORDER_INVALID_TRANSITION');
    });

    it('should return 409 when order has no PayPal order ID', async () => {
      const orderNoPayPal: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        subtotalAmount: new Decimal('100.00'),
        taxAmount: new Decimal('8.00'),
        platformFeeAmount: new Decimal('5.00'),
        totalAmount: new Decimal('113.00'),
        status: OrderStatus.AUTHORIZED,
        // No paypalOrderId
      });

      const response: Response = await request(app)
        .post(`/orders/${orderNoPayPal.id}/capture`)
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ORDER_INVALID_STATE');
    });

    it('should handle capture failure gracefully', async () => {
      gateway.failNext('captureOrder');

      const response: Response = await request(app)
        .post(`/orders/${authorizedOrderId}/capture`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('PAYMENT_CAPTURE_FAILED');

      // Order should be marked as FAILED
      const order: OrderTestRecordDto | null = await findTestOrderById(authorizedOrderId);
      expect(order?.status).toBe(OrderStatus.FAILED);
    });

    it('should handle markOrderFailed error gracefully when order does not exist in DB', async () => {
      await expect(
        markOrderFailed('00000000-0000-0000-0000-000000000000')
      ).resolves.toBeUndefined();
    });

    it('should return success even if settlement dispatch fails', async () => {
      gateway.failNext('createPayoutBatch');

      const response: Response = await request(app)
        .post(`/orders/${authorizedOrderId}/capture`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
    });
  });
});
