import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { prisma } from '@tabhop/database';
import { createApp } from '../../src/app.js';
import { FakePayPalGateway } from '../../src/payments/payments.fake-gateway.js';
import { SettlementService } from '../../src/settlements/settlements.service.js';
import { WebhookService } from '../../src/webhooks/webhooks.service.js';

// Create Express app for testing
function createTestApp(paypalMode = 'sandbox') {
  const app = createApp();

  const gateway = new FakePayPalGateway();
  const settlementService = new SettlementService(gateway);
  const webhookService = new WebhookService();

  app.locals.gateway = gateway;
  app.locals.settlementService = settlementService;
  app.locals.webhookService = webhookService;
  app.locals.paypalMode = paypalMode;

  return app;
}

describe('Health Route', () => {
  describe('GET /health', () => {
    it('should return 200 when database and PayPal are ok', async () => {
      const app = createTestApp('sandbox');
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(['ok', 'fail']).toContain(response.body.status);
      expect(response.body.db).toBe('ok');
      expect(response.body.paypal).toBeDefined();
    });

    it('should check database connectivity', async () => {
      const app = createTestApp('sandbox');
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.db).toBe('ok');
    });

    it('should skip PayPal check in fake mode', async () => {
      const app = createTestApp('fake');
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.paypal).toBe('skipped');
    });

    it('should return 503 when database is down', async () => {
      const app = createTestApp('sandbox');

      vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('fail');
      expect(response.body.db).toBe('fail');
    });

    it('should include all required fields in response', async () => {
      const app = createTestApp();
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('db');
      expect(response.body).toHaveProperty('paypal');
    });

    it('should return status ok when all systems operational', async () => {
      const app = createTestApp('sandbox');
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });

    it('should handle missing gateway gracefully', async () => {
      const app = createApp();
      // No gateway configured

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.paypal).toBe('unknown');
    });

    it('should return appropriate status codes', async () => {
      const app = createTestApp('sandbox');
      const response = await request(app).get('/health');

      // Either 200 (healthy) or 503 (service unavailable)
      expect([200, 503]).toContain(response.status);
    });

    it('should return valid PayPal status values', async () => {
      const app = createTestApp();
      const response = await request(app).get('/health');

      const validStatuses = ['ok', 'fail', 'skipped', 'unknown'];
      expect(validStatuses).toContain(response.body.paypal);
    });
  });
});
