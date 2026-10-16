import { describe, it, expect, beforeEach, vi } from 'vitest';
import request, { type Response } from 'supertest';
import { prisma, PayoutStatus } from '@tabhop/database';
import { createApp } from '../../src/app.js';
import { SettlementService } from '../../src/settlements/settlements.service.js';
import { FakePayPalGateway } from '../../src/payments/payments.fake-gateway.js';
import { WebhookService } from '../../src/webhooks/webhooks.service.js';
import { Decimal } from '@prisma/client/runtime/library';
import {
  createTestMerchant,
  createTestItem,
  createTestStaff,
  createTestOrder,
  createTestOrderItem,
  createTestOrderItems,
  createTestPayoutBatch,
  findTestPayoutBatchItemsByBatchId,
  type MerchantTestRecordDto,
  type ItemTestRecordDto,
  type StaffTestRecordDto,
  type OrderTestRecordDto,
  type PayoutBatchItemTestRecordDto,
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

describe('Settlements Routes', () => {
  let app: ReturnType<typeof createApp>;
  let testVenueId: string;

  beforeEach(async () => {
    app = createTestApp();

    // Create test venue
    const venue: MerchantTestRecordDto = await createTestMerchant({
      businessName: 'Test Venue',
      merchantType: 'PRIMARY_VENUE',
      paypalEmail: 'venue@example.com',
    });
    testVenueId = venue.id;
  });

  describe('POST /settlements/:orderId/retry', () => {
    it('should retry a failed settlement batch', async () => {
      // Create order with failed batch
      const order: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        subtotalAmount: new Decimal('100.00'),
        taxAmount: new Decimal('8.00'),
        platformFeeAmount: new Decimal('5.00'),
        totalAmount: new Decimal('113.00'),
        status: 'CAPTURED',
      });

      const item: ItemTestRecordDto = await createTestItem({
        merchantId: testVenueId,
        name: 'Retry Item',
        description: 'Retry item',
        price: new Decimal('100.00'),
        category: 'Food',
        isActive: true,
      });
      await createTestOrderItem({
        orderId: order.id,
        itemId: item.id,
        quantity: 1,
        unitPrice: new Decimal('100.00'),
      });

      await createTestPayoutBatch({
        orderId: order.id,
        status: PayoutStatus.FAILED,
        lastError: 'Previous error',
      });

      const response: Response = await request(app)
        .post(`/settlements/${order.id}/retry`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.payoutBatch).toBeDefined();
    });

    it('should return 400 when settlement retry dispatch fails', async () => {
      const order: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        subtotalAmount: new Decimal('100.00'),
        taxAmount: new Decimal('8.00'),
        platformFeeAmount: new Decimal('5.00'),
        totalAmount: new Decimal('113.00'),
        status: 'CAPTURED',
      });

      const item: ItemTestRecordDto = await createTestItem({
        merchantId: testVenueId,
        name: 'Retry Fail Item',
        description: 'Retry fail item',
        price: new Decimal('100.00'),
        category: 'Food',
        isActive: true,
      });
      await createTestOrderItem({
        orderId: order.id,
        itemId: item.id,
        quantity: 1,
        unitPrice: new Decimal('100.00'),
      });

      await createTestPayoutBatch({
        orderId: order.id,
        status: PayoutStatus.FAILED,
        lastError: 'Previous error',
      });

      app.locals.gateway.failNext('createPayoutBatch');

      const response: Response = await request(app)
        .post(`/settlements/${order.id}/retry`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('SETTLEMENT_DISPATCH_FAILED');
    });

    it('should return 400 for invalid order ID format', async () => {
      const response: Response = await request(app)
        .post('/settlements/invalid-id/retry')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 when order not found', async () => {
      const response: Response = await request(app)
        .post('/settlements/00000000-0000-0000-0000-000000000000/retry')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 404 when batch does not exist', async () => {
      const order: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        subtotalAmount: new Decimal('100.00'),
        taxAmount: new Decimal('8.00'),
        platformFeeAmount: new Decimal('5.00'),
        totalAmount: new Decimal('113.00'),
        status: 'CAPTURED',
      });

      const response: Response = await request(app)
        .post(`/settlements/${order.id}/retry`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 409 when batch not in FAILED state', async () => {
      const order: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        subtotalAmount: new Decimal('100.00'),
        taxAmount: new Decimal('8.00'),
        platformFeeAmount: new Decimal('5.00'),
        totalAmount: new Decimal('113.00'),
        status: 'CAPTURED',
      });

      await createTestPayoutBatch({
        orderId: order.id,
        status: PayoutStatus.PROCESSING,
      });

      const response: Response = await request(app)
        .post(`/settlements/${order.id}/retry`)
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('SETTLEMENT_INVALID_TRANSITION');
    });
  });

  describe('GET /settlements', () => {
    beforeEach(async () => {
      const partner: MerchantTestRecordDto = await createTestMerchant({
        businessName: 'Partner Food Truck',
        merchantType: 'EXTERNAL_PARTNER',
        paypalEmail: 'partner@example.com',
      });
      const partnerItem: ItemTestRecordDto = await createTestItem({
        merchantId: partner.id,
        name: 'Partner Taco',
        description: 'Taco',
        price: new Decimal('10.00'),
        category: 'Food',
        isActive: true,
      });

      // Create test orders and batches
      for (let i: number = 0; i < 15; i++) {
        const order: OrderTestRecordDto = await createTestOrder({
          venueId: testVenueId,
          subtotalAmount: new Decimal('100.00'),
          taxAmount: new Decimal('8.00'),
          platformFeeAmount: new Decimal('5.00'),
          totalAmount: new Decimal('113.00'),
          status: 'CAPTURED',
        });

        if (i === 14) {
          await createTestOrderItem({
            orderId: order.id,
            itemId: partnerItem.id,
            quantity: 1,
            unitPrice: new Decimal('10.00'),
          });
        }

        await createTestPayoutBatch({
          orderId: order.id,
          status: i % 2 === 0 ? PayoutStatus.COMPLETED : PayoutStatus.FAILED,
        });
      }
    });

    it('should return paginated settlements list', async () => {
      const response: Response = await request(app).get('/settlements');

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
      const response: Response = await request(app).get('/settlements?pageSize=5');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(5);
      expect(response.body.pagination.pageSize).toBe(5);
      expect(response.body.pagination.pages).toBe(3);
    });

    it('should support pagination', async () => {
      const response: Response = await request(app).get('/settlements?page=2&pageSize=5');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(5);
      expect(response.body.pagination.page).toBe(2);
    });

    it('should filter by venueId', async () => {
      // Create another venue
      const venue2: MerchantTestRecordDto = await createTestMerchant({
        businessName: 'Test Venue 2',
        merchantType: 'PRIMARY_VENUE',
        paypalEmail: 'venue2@example.com',
      });

      const order: OrderTestRecordDto = await createTestOrder({
        venueId: venue2.id,
        subtotalAmount: new Decimal('100.00'),
        taxAmount: new Decimal('8.00'),
        platformFeeAmount: new Decimal('5.00'),
        totalAmount: new Decimal('113.00'),
        status: 'CAPTURED',
      });

      await createTestPayoutBatch({
        orderId: order.id,
        status: PayoutStatus.COMPLETED,
      });

      const response: Response = await request(app).get(`/settlements?venueId=${testVenueId}`);

      expect(response.status).toBe(200);
      expect(response.body.pagination.total).toBe(15);
    });

    it('should filter by status', async () => {
      const response: Response = await request(app).get(`/settlements?status=COMPLETED`);

      expect(response.status).toBe(200);
      // 15 total, half are COMPLETED (8)
      expect(response.body.pagination.total).toBe(8);
    });

    it('should filter by date range', async () => {
      const now: Date = new Date();
      const past: Date = new Date(now.getTime() - 60 * 60 * 1000);
      const tomorrow: Date = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const response: Response = await request(app).get(
        `/settlements?startDate=${past.toISOString()}&endDate=${tomorrow.toISOString()}`
      );

      expect(response.status).toBe(200);
      // Should include today's batches
      expect(response.body.pagination.total).toBeGreaterThan(0);
    });

    it('should return 400 for invalid query parameters including negative page and pageSize', async () => {
      const invalidPage: Response = await request(app).get('/settlements?page=invalid');
      expect(invalidPage.status).toBe(400);
      expect(invalidPage.body.code).toBe('VALIDATION_ERROR');

      const negativePage: Response = await request(app).get('/settlements?page=-1');
      expect(negativePage.status).toBe(400);
      expect(negativePage.body.code).toBe('VALIDATION_ERROR');

      const zeroPage: Response = await request(app).get('/settlements?page=0');
      expect(zeroPage.status).toBe(400);
      expect(zeroPage.body.code).toBe('VALIDATION_ERROR');

      const negativePageSize: Response = await request(app).get('/settlements?pageSize=-5');
      expect(negativePageSize.status).toBe(400);
      expect(negativePageSize.body.code).toBe('VALIDATION_ERROR');

      const oversizedPageSize: Response = await request(app).get('/settlements?pageSize=101');
      expect(oversizedPageSize.status).toBe(400);
      expect(oversizedPageSize.body.code).toBe('VALIDATION_ERROR');
    });

    it('should include settlement details in response', async () => {
      const response: Response = await request(app).get('/settlements?pageSize=1');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(1);

      const row: { orderId: string; venueName: string; partnerNames: string[]; subtotalCents: number; taxCents: number; tipCents: number; platformFeeCents: number; totalCents: number; status: string; attempts: number; createdAt: string } = response.body.data[0];
      expect(row.orderId).toBeDefined();
      expect(row.venueName).toBe('Test Venue');
      expect(row.partnerNames).toContain('Partner Food Truck');
      expect(row.subtotalCents).toBeDefined();
      expect(row.taxCents).toBeDefined();
      expect(row.tipCents).toBeDefined();
      expect(row.platformFeeCents).toBeDefined();
      expect(row.totalCents).toBeDefined();
      expect(row.status).toBeDefined();
      expect(row.attempts).toBeDefined();
      expect(row.createdAt).toBeDefined();
    });

    it('should return 500 when listing settlements fails unexpectedly', async () => {
      vi.spyOn(app.locals.settlementService, 'listSettlements').mockRejectedValueOnce(
        new Error('Database error')
      );

      const response: Response = await request(app).get('/settlements');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should guarantee non-negative amounts for all stakeholders (venue, partner, staff, platform) on dispatch and ledger', async () => {
      const partner: MerchantTestRecordDto = await createTestMerchant({
        businessName: 'Stakeholder Partner',
        merchantType: 'EXTERNAL_PARTNER',
        paypalEmail: 'stakeholder-partner@example.com',
        commissionRate: new Decimal('0.15'),
      });

      const staff: StaffTestRecordDto = await createTestStaff({
        venueId: testVenueId,
        displayName: 'Stakeholder Server',
        paypalEmail: 'stakeholder-staff@example.com',
        isActive: true,
      });

      const venueItem: ItemTestRecordDto = await createTestItem({
        merchantId: testVenueId,
        name: 'Venue Craft Beer',
        description: 'Draft beer',
        price: new Decimal('10.00'),
        category: 'Drinks',
        isActive: true,
      });

      const partnerItem: ItemTestRecordDto = await createTestItem({
        merchantId: partner.id,
        name: 'Partner Tacos',
        description: 'Street tacos',
        price: new Decimal('20.00'),
        category: 'Food',
        isActive: true,
      });

      // Subtotal = $30.00 (3000c), Tax = $2.40 (240c), Tip = $5.00 (500c), Platform Fee = $1.50 (150c), Total = $38.90 (3890c)
      const order: OrderTestRecordDto = await createTestOrder({
        venueId: testVenueId,
        serverStaffId: staff.id,
        subtotalAmount: new Decimal('30.00'),
        taxAmount: new Decimal('2.40'),
        tipAmount: new Decimal('5.00'),
        platformFeeAmount: new Decimal('1.50'),
        totalAmount: new Decimal('38.90'),
        status: 'CAPTURED',
      });

      await createTestOrderItems([
        { orderId: order.id, itemId: venueItem.id, quantity: 1, unitPrice: new Decimal('10.00') },
        { orderId: order.id, itemId: partnerItem.id, quantity: 1, unitPrice: new Decimal('20.00') },
      ]);

      const dispatchResult: { payoutBatchId: string; status: string } = await app.locals.settlementService.dispatch(order.id);
      expect(dispatchResult.payoutBatchId).toBeDefined();

      const batchItems: PayoutBatchItemTestRecordDto[] =
        await findTestPayoutBatchItemsByBatchId(dispatchResult.payoutBatchId);

      // Verify all 3 payout stakeholders exist and have strictly non-negative (> 0) payouts
      expect(batchItems).toHaveLength(3);
      for (const item of batchItems) {
        expect(Number(item.amount)).toBeGreaterThanOrEqual(0);
      }

      const venuePayout: PayoutBatchItemTestRecordDto | undefined = batchItems.find((i) => i.recipientType === 'PRIMARY_VENUE');
      const partnerPayout: PayoutBatchItemTestRecordDto | undefined = batchItems.find((i) => i.recipientType === 'PARTNER_MERCHANT');
      const staffPayout: PayoutBatchItemTestRecordDto | undefined = batchItems.find((i) => i.recipientType === 'STAFF_TIP');

      expect(Number(venuePayout?.amount)).toBe(15.4); // $10.00 venue + $3.00 commission + $2.40 tax
      expect(Number(partnerPayout?.amount)).toBe(17.0); // $20.00 * (1 - 0.15)
      expect(Number(staffPayout?.amount)).toBe(5.0); // $5.00 tip

      // Verify platform stakeholder cut is also non-negative
      const totalPayoutCents: number = batchItems.reduce(
        (sum, i) => sum + Math.round(Number(i.amount) * 100),
        0
      );
      const platformCutCents: number = Math.round(Number(order.totalAmount) * 100) - totalPayoutCents;
      expect(platformCutCents).toBeGreaterThanOrEqual(0);
      expect(platformCutCents).toBe(150);
    });
  });
});
