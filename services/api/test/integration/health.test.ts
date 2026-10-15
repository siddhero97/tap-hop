import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { prisma } from '@tabhop/database';
import { createApp } from '../../src/app.js';
import { FakePayPalGateway } from '../../src/payments/payments.fake-gateway.js';
import { SettlementService } from '../../src/settlements/settlements.service.js';
import { WebhookService } from '../../src/webhooks/webhooks.service.js';
import * as healthService from '../../src/health/health.service.js';
import { HealthCheckSchema } from '../../src/health/health.validator.js';
import { registerServices } from '../../src/lib/app-services.js';
import { errorHandlerMiddleware } from '../../src/middleware/error-handler.js';

// Create Express app for testing
function createTestApp(paypalMode = 'sandbox') {
  const app = createApp();

  const gateway = new FakePayPalGateway();
  const settlementService = new SettlementService(gateway);
  const webhookService = new WebhookService();

  registerServices(app, {
    gateway,
    settlementService,
    webhookService,
    paypalMode,
  });

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

    it('should return 500 when getHealthReport throws unexpectedly', async () => {
      const app = createTestApp('sandbox');
      vi.spyOn(healthService, 'getHealthReport').mockRejectedValueOnce(
        new Error('Unexpected failure')
      );

      const response = await request(app).get('/health');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        status: 'fail',
        db: 'unknown',
        paypal: 'unknown',
      });
    });

    it('validates empty object with HealthCheckSchema', () => {
      expect(HealthCheckSchema.parse({})).toEqual({});
    });

    it('throws when registerServices receives a missing service', () => {
      const app = createApp();
      expect(() =>
        registerServices(app, {
          gateway: undefined as any,
          settlementService: {} as any,
          webhookService: {} as any,
          paypalMode: 'fake',
        })
      ).toThrow('Required app service not configured: gateway');
    });

    it('handles unhandled errors via errorHandlerMiddleware', () => {
      const req: any = { requestId: 'req-123', path: '/boom', method: 'GET' };
      const json = vi.fn();
      const status = vi.fn().mockReturnValue({ json });
      const res: any = { status };
      const next = vi.fn();

      errorHandlerMiddleware(new Error('Unhandled boom'), req, res, next);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId: 'req-123',
      });
    });
  });
});
