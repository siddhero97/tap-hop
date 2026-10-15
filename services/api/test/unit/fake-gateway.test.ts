import { describe, it, expect, beforeEach } from 'vitest';
import { FakePayPalGateway } from '../../src/modules/payments/fake-gateway';

describe('FakePayPalGateway', () => {
  let gateway: FakePayPalGateway;

  beforeEach(() => {
    gateway = new FakePayPalGateway();
  });

  describe('createOrder', () => {
    it('returns order ID and approve URL', async () => {
      const result = await gateway.createOrder({
        referenceId: 'order-1',
        amountCents: 1999,
        currency: 'USD',
      });
      expect(result.paypalOrderId).toMatch(/^FAKE-ORDER-/);
      expect(result.approveUrl).toContain('sandbox.paypal.com');
    });

    it('fails when failNext is set', async () => {
      gateway.failNext('createOrder');
      await expect(
        gateway.createOrder({
          referenceId: 'order-1',
          amountCents: 1999,
          currency: 'USD',
        })
      ).rejects.toThrow('Simulated PayPal error');
    });
  });

  describe('captureOrder', () => {
    it('returns capture ID and status', async () => {
      const result = await gateway.captureOrder('FAKE-ORDER-1');
      expect(result.captureId).toMatch(/^FAKE-CAPTURE-/);
      expect(result.status).toBe('COMPLETED');
    });
  });

  describe('createPayoutBatch', () => {
    it('returns batch ID and status', async () => {
      const result = await gateway.createPayoutBatch({
        sender_batch_header: {
          sender_batch_id: 'batch-1',
          email_subject: 'Test',
          email_message: 'Test',
        },
        items: [],
      });
      expect(result.paypalBatchId).toMatch(/^FAKE-BATCH-/);
      expect(result.status).toBe('PROCESSING');
    });
  });

  describe('verifyWebhook', () => {
    it('returns true when signature is ok', async () => {
      const result = await gateway.verifyWebhook(
        { 'x-fake-signature': 'ok' },
        '{}'
      );
      expect(result).toBe(true);
    });

    it('returns false when signature is missing', async () => {
      const result = await gateway.verifyWebhook({}, '{}');
      expect(result).toBe(false);
    });
  });

  describe('call tracking', () => {
    it('records all method calls', async () => {
      await gateway.createOrder({
        referenceId: 'order-1',
        amountCents: 1999,
        currency: 'USD',
      });
      const calls = gateway.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('createOrder');
    });

    it('resets on reset()', async () => {
      await gateway.createOrder({
        referenceId: 'order-1',
        amountCents: 1999,
        currency: 'USD',
      });
      gateway.reset();
      expect(gateway.getCalls()).toHaveLength(0);
    });
  });
});
