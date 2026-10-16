import { describe, it, expect, beforeEach } from 'vitest';
import request, { type Response } from 'supertest';
import { prisma, OrderStatus, PayoutStatus, MerchantType } from '@tabhop/database';
import { Decimal } from '@prisma/client/runtime/library';
import { createApp } from '../../src/app.js';
import { PayPalRestGateway } from '../../src/payments/payments.rest-gateway.js';
import { SettlementService } from '../../src/settlements/settlements.service.js';
import { WebhookService } from '../../src/webhooks/webhooks.service.js';
import { registerServices } from '../../src/lib/app-services.js';
import { PayPalBatchStatus } from '../../src/payments/payments.model.js';
import {
  createTestMerchant,
  createTestItem,
  createTestStaff,
  createTestOrder,
  findTestOrderById,
  createTestOrderItems,
  findTestPayoutBatchWithItemsById,
  type MerchantTestRecordDto,
  type ItemTestRecordDto,
  type StaffTestRecordDto,
  type OrderTestRecordDto,
  type PayoutBatchWithItemsTestRecordDto,
} from '../helpers/test-db.repository.js';

const clientId: string = process.env.PAYPAL_CLIENT_ID?.trim() ?? '';
const clientSecret: string = process.env.PAYPAL_CLIENT_SECRET?.trim() ?? '';
const webhookId: string = process.env.PAYPAL_WEBHOOK_ID?.trim() || 'SANDBOX_WEBHOOK_ID';
const hasSandboxCredentials: boolean = Boolean(
  clientId &&
    clientSecret &&
    clientId !== 'MISSING_SANDBOX_CLIENT_ID' &&
    clientSecret !== 'MISSING_SANDBOX_CLIENT_SECRET'
);

function createSandboxApp() {
  const app: ReturnType<typeof createApp> = createApp();
  const gateway: PayPalRestGateway = new PayPalRestGateway(clientId, clientSecret, webhookId);
  const settlementService: SettlementService = new SettlementService(gateway);
  const webhookService: WebhookService = new WebhookService(prisma);

  registerServices(app, {
    gateway,
    settlementService,
    webhookService,
    paypalMode: 'sandbox',
  });

  return { app, gateway, settlementService };
}

describe('PayPal Sandbox Live Integration', () => {
  it('requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to be set in .env or environment', () => {
    if (!hasSandboxCredentials) {
      throw new Error(
        'Missing PayPal Sandbox credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env before running `pnpm test:sandbox`.'
      );
    }
    expect(clientId.length).toBeGreaterThan(10);
    expect(clientSecret.length).toBeGreaterThan(10);
  });

  describe('Live PayPal Sandbox API Flows', () => {
    let app: ReturnType<typeof createApp>;
    let gateway: PayPalRestGateway;
    let settlementService: SettlementService;
    let primaryVenueId: string;
    let partnerMerchantId: string;
    let venueItemId: string;
    let partnerItemId: string;
    let staffId: string;

    beforeEach(async () => {
      const setup: { app: ReturnType<typeof createApp>; gateway: PayPalRestGateway; settlementService: SettlementService; } = createSandboxApp();
      app = setup.app;
      gateway = setup.gateway;
      settlementService = setup.settlementService;

      const venue: MerchantTestRecordDto = await createTestMerchant({
        businessName: 'Sandbox Beer Garden',
        merchantType: MerchantType.PRIMARY_VENUE,
        paypalEmail: 'sb-venue@personal.example.com',
      });
      primaryVenueId = venue.id;

      const partner: MerchantTestRecordDto = await createTestMerchant({
        businessName: 'Sandbox Taco Truck',
        merchantType: MerchantType.EXTERNAL_PARTNER,
        paypalEmail: 'sb-partner@personal.example.com',
        commissionRate: new Decimal('0.15'),
      });
      partnerMerchantId = partner.id;

      const venueItem: ItemTestRecordDto = await createTestItem({
        merchantId: primaryVenueId,
        name: 'Sandbox Craft IPA',
        description: 'Pint of house IPA',
        price: new Decimal('8.00'),
        category: 'Drinks',
        isActive: true,
      });
      venueItemId = venueItem.id;

      const partnerItem: ItemTestRecordDto = await createTestItem({
        merchantId: partnerMerchantId,
        name: 'Sandbox Street Tacos',
        description: 'Two carne asada tacos',
        price: new Decimal('12.00'),
        category: 'Food',
        isActive: true,
      });
      partnerItemId = partnerItem.id;

      const staff: StaffTestRecordDto = await createTestStaff({
        venueId: primaryVenueId,
        displayName: 'Alex Bartender',
        paypalEmail: 'sb-staff@personal.example.com',
        isActive: true,
      });
      staffId = staff.id;
    });

    it('GET /health and PayPalRestGateway authenticate with PayPal Sandbox OAuth2', async () => {
      const response: Response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'ok',
        db: 'ok',
        paypal: 'ok',
      });

      const verified: boolean = await gateway.verifyWebhook({}, '{}');
      expect(verified).toBe(false);
    });

    it('POST /orders and POST /orders/:id/paypal creates a real PayPal Sandbox order with approveUrl', async () => {
      const createRes: Response = await request(app)
        .post('/orders')
        .send({
          venueId: primaryVenueId,
          serverStaffId: staffId,
          tipAmount: 3.0,
          lines: [
            { itemId: venueItemId, quantity: 2 },
            { itemId: partnerItemId, quantity: 1 },
          ],
        });

      expect(createRes.status).toBe(201);
      const orderId: string = createRes.body.order.id;

      const paypalRes: Response = await request(app).post(`/orders/${orderId}/paypal`).send({});

      expect(paypalRes.status).toBe(200);
      expect(paypalRes.body.paypalOrderId).toMatch(/^[A-Z0-9]+$/);
      expect(paypalRes.body.approveUrl).toContain('sandbox.paypal.com');

      const updatedOrder: OrderTestRecordDto | null = await findTestOrderById(orderId);
      expect(updatedOrder?.status).toBe(OrderStatus.AUTHORIZED);
      expect(updatedOrder?.paypalOrderId).toBe(paypalRes.body.paypalOrderId);
    });

    it('POST /orders/:id/capture returns 400 PAYMENT_CAPTURE_FAILED when buyer has not approved order in PayPal Sandbox', async () => {
      const createRes: Response = await request(app)
        .post('/orders')
        .send({
          venueId: primaryVenueId,
          lines: [{ itemId: venueItemId, quantity: 1 }],
        });
      const orderId: string = createRes.body.order.id;

      await request(app).post(`/orders/${orderId}/paypal`).send({}).expect(200);

      const captureRes: Response = await request(app).post(`/orders/${orderId}/capture`).send({});

      expect(captureRes.status).toBe(400);
      expect(captureRes.body.code).toBe('PAYMENT_CAPTURE_FAILED');

      const failedOrder: OrderTestRecordDto | null = await findTestOrderById(orderId);
      expect(failedOrder?.status).toBe(OrderStatus.FAILED);
    });

    it('SettlementService.dispatch dispatches a real PayoutBatch to PayPal Sandbox', async () => {
      // Subtotal: $8.00 + $12.00 = $20.00, Tax (8%): $1.60, Platform Fee (5%): $1.00, Tip: $3.00 -> Total: $25.60
      const order: OrderTestRecordDto = await createTestOrder({
        venueId: primaryVenueId,
        serverStaffId: staffId,
        subtotalAmount: new Decimal('20.00'),
        taxAmount: new Decimal('1.60'),
        platformFeeAmount: new Decimal('1.00'),
        tipAmount: new Decimal('3.00'),
        totalAmount: new Decimal('25.60'),
        status: OrderStatus.CAPTURED,
        paypalOrderId: `SANDBOX-ORDER-${Date.now()}`,
        paypalCaptureId: `SANDBOX-CAPTURE-${Date.now()}`,
      });

      await createTestOrderItems([
        {
          orderId: order.id,
          itemId: venueItemId,
          quantity: 1,
          unitPrice: new Decimal('8.00'),
        },
        {
          orderId: order.id,
          itemId: partnerItemId,
          quantity: 1,
          unitPrice: new Decimal('12.00'),
        },
      ]);

      const result: { payoutBatchId: string; status: PayPalBatchStatus } = await settlementService.dispatch(order.id);

      expect(result.payoutBatchId).toBeDefined();
      expect([
        PayPalBatchStatus.PENDING,
        PayPalBatchStatus.PROCESSING,
        PayPalBatchStatus.SUCCESS,
      ]).toContain(result.status);

      const batch: PayoutBatchWithItemsTestRecordDto | null =
        await findTestPayoutBatchWithItemsById(result.payoutBatchId);

      expect(batch).not.toBeNull();
      expect(batch?.paypalBatchId).toBeTruthy();
      expect([PayoutStatus.PROCESSING, PayoutStatus.COMPLETED]).toContain(batch?.status);
      expect(batch?.items).toHaveLength(4);
    });

    it('POST /webhooks/paypal rejects forged webhook signatures via PayPal Sandbox verification API', async () => {
      const payload: { id: string; event_type: string; resource: { id: string; }; } = {
        id: `WH-SANDBOX-${Date.now()}`,
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-SANDBOX-1',
        },
      };

      const response: Response = await request(app)
        .post('/webhooks/paypal')
        .set('paypal-transmission-id', '00000000-0000-0000-0000-000000000000')
        .set('paypal-transmission-time', new Date().toISOString())
        .set(
          'paypal-cert-url',
          'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270'
        )
        .set('paypal-auth-algo', 'SHA256withRSA')
        .set('paypal-transmission-sig', 'forged-signature')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(payload));

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_SIGNATURE');
    });
  });
});
