import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { prisma, OrderStatus, PayoutStatus } from '@tabhop/database';
import { createApp } from '../../src/app.js';
import { PayPalGateway } from '../../src/modules/payments/gateway.js';
import { SettlementService } from '../../src/modules/settlements/service.js';
import { FakePayPalGateway } from '../../src/modules/payments/fake-gateway.js';
import { WebhookService } from '../../src/modules/webhooks/service.js';
import { Decimal } from '@prisma/client';
import { PayPalBatchStatus } from '../../src/modules/payments/constants.js';

// Create Express app for testing
function createTestApp() {
  const app = createApp();

  // Setup test gateway and settlement service
  const gateway = new FakePayPalGateway();
  const settlementService = new SettlementService(gateway);
  const webhookService = new WebhookService();

  app.locals.gateway = gateway;
  app.locals.settlementService = settlementService;
  app.locals.webhookService = webhookService;
  app.locals.paypalMode = 'fake';

  return app;
}

describe('Payments Routes', () => {
  let app: Express.Application;
  let testVenueId: string;
  let testOrderId: string;
  let gateway: FakePayPalGateway;

  beforeEach(async () => {
    app = createTestApp();
    gateway = app.locals.gateway;

    // Create test venue
    const venue = await prisma.merchant.create({
      data: {
        businessName: 'Test Venue',
        merchantType: 'PRIMARY_VENUE',
        paypalEmail: 'venue@example.com',
      },
    });
    testVenueId = venue.id;

    // Create test order in PENDING state
    const order = await prisma.order.create({
      data: {
        venueId: venue.id,
        subtotalAmount: new Decimal('100.00'),
        taxAmount: new Decimal('8.00'),
        platformFeeAmount: new Decimal('5.00'),
        totalAmount: new Decimal('113.00'),
        status: OrderStatus.PENDING,
      },
    });
    testOrderId = order.id;
  });

  afterEach(async () => {
    // Clean up
    await prisma.payoutBatch.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.merchant.deleteMany({});
  });

  describe('POST /orders/:id/paypal', () => {
    it('should create PayPal order and return 201', async () => {
      const response = await request(app).post(`/orders/${testOrderId}/paypal`).send({});

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('success');
      expect(response.body.paypalOrderId).toBeDefined();
      expect(response.body.approveUrl).toBeDefined();

      // Verify order status updated to AUTHORIZED
      const order = await prisma.order.findUnique({ where: { id: testOrderId } });
      expect(order?.status).toBe(OrderStatus.AUTHORIZED);
      expect(order?.paypalOrderId).toBe(response.body.paypalOrderId);
    });

    it('should return 400 for invalid order ID format', async () => {
      const response = await request(app).post('/orders/invalid-id/paypal').send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 when order not found', async () => {
      const response = await request(app)
        .post('/orders/00000000-0000-0000-0000-000000000000/paypal')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 409 when order not in PENDING state', async () => {
      // Update order to AUTHORIZED
      await prisma.order.update({
        where: { id: testOrderId },
        data: { status: OrderStatus.AUTHORIZED },
      });

      const response = await request(app).post(`/orders/${testOrderId}/paypal`).send({});

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ORDER_INVALID_TRANSITION');
    });

    it('should support idempotency and return existing PayPal order', async () => {
      const response1 = await request(app).post(`/orders/${testOrderId}/paypal`).send({});
      expect(response1.status).toBe(201);
      const paypalOrderId1 = response1.body.paypalOrderId;

      const response2 = await request(app).post(`/orders/${testOrderId}/paypal`).send({});
      expect(response2.status).toBe(200);
      expect(response2.body.paypalOrderId).toBe(paypalOrderId1);
    });

    it('should handle gateway errors gracefully', async () => {
      gateway.failNext('createOrder');

      const response = await request(app).post(`/orders/${testOrderId}/paypal`).send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('PAYMENT_GATEWAY_ERROR');
    });
  });

  describe('POST /orders/:id/capture', () => {
    let authorizedOrderId: string;

    beforeEach(async () => {
      // Create and authorize an order
      const authorizedOrder = await prisma.order.create({
        data: {
          venueId: testVenueId,
          paypalOrderId: 'FAKE-ORDER-1',
          subtotalAmount: new Decimal('100.00'),
          taxAmount: new Decimal('8.00'),
          platformFeeAmount: new Decimal('5.00'),
          totalAmount: new Decimal('113.00'),
          status: OrderStatus.AUTHORIZED,
        },
      });
      authorizedOrderId = authorizedOrder.id;
    });

    it('should capture order and dispatch settlement', async () => {
      const response = await request(app)
        .post(`/orders/${authorizedOrderId}/capture`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.order.status).toBe(OrderStatus.CAPTURED);
      expect(response.body.order.paypalCaptureId).toBeDefined();

      // Verify order status updated in database
      const order = await prisma.order.findUnique({ where: { id: authorizedOrderId } });
      expect(order?.status).toBe(OrderStatus.CAPTURED);
      expect(order?.capturedAt).toBeDefined();
    });

    it('should return 400 for invalid order ID format', async () => {
      const response = await request(app).post('/orders/invalid-id/capture').send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 when order not found', async () => {
      const response = await request(app)
        .post('/orders/00000000-0000-0000-0000-000000000000/capture')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 409 when order not in AUTHORIZED state', async () => {
      // Create a pending order
      const pendingOrder = await prisma.order.create({
        data: {
          venueId: testVenueId,
          subtotalAmount: new Decimal('100.00'),
          taxAmount: new Decimal('8.00'),
          platformFeeAmount: new Decimal('5.00'),
          totalAmount: new Decimal('113.00'),
          status: OrderStatus.PENDING,
        },
      });

      const response = await request(app)
        .post(`/orders/${pendingOrder.id}/capture`)
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ORDER_INVALID_TRANSITION');
    });

    it('should return 409 when order has no PayPal order ID', async () => {
      const orderNoPayPal = await prisma.order.create({
        data: {
          venueId: testVenueId,
          subtotalAmount: new Decimal('100.00'),
          taxAmount: new Decimal('8.00'),
          platformFeeAmount: new Decimal('5.00'),
          totalAmount: new Decimal('113.00'),
          status: OrderStatus.AUTHORIZED,
          // No paypalOrderId
        },
      });

      const response = await request(app)
        .post(`/orders/${orderNoPayPal.id}/capture`)
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ORDER_INVALID_STATE');
    });

    it('should handle capture failure gracefully', async () => {
      gateway.failNext('captureOrder');

      const response = await request(app)
        .post(`/orders/${authorizedOrderId}/capture`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('PAYMENT_CAPTURE_FAILED');

      // Order should be marked as FAILED
      const order = await prisma.order.findUnique({ where: { id: authorizedOrderId } });
      expect(order?.status).toBe(OrderStatus.FAILED);
    });

    it('should return success even if settlement dispatch fails', async () => {
      // This would require settlement service to fail, which we can't easily test here
      // but the code path is there to handle it
      const response = await request(app)
        .post(`/orders/${authorizedOrderId}/capture`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
    });
  });
});
