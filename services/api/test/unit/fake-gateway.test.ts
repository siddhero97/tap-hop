import { describe, it, expect, beforeEach } from 'vitest';
import { FakePayPalGateway } from '../../src/payments/payments.fake-gateway';
import { PayPalCaptureStatus, PayPalBatchStatus } from '../../src/payments/payments.model';

describe('FakePayPalGateway', () => {
  let gateway: FakePayPalGateway;

  beforeEach(() => {
    gateway = new FakePayPalGateway();
  });

  describe('createOrder', () => {
    it('returns order ID and approve URL', async () => {
      const result: { paypalOrderId: string; approveUrl: string } = await gateway.createOrder({
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

    it('rejects zero or negative amountCents', async () => {
      await expect(
        gateway.createOrder({
          referenceId: 'order-zero',
          amountCents: 0,
          currency: 'USD',
        })
      ).rejects.toThrow('Order amountCents must be positive');

      await expect(
        gateway.createOrder({
          referenceId: 'order-neg',
          amountCents: -500,
          currency: 'USD',
        })
      ).rejects.toThrow('Order amountCents must be positive');
    });
  });

  describe('captureOrder', () => {
    it('returns capture ID and status', async () => {
      const result: { captureId: string; status: PayPalCaptureStatus; amountCents: number } = await gateway.captureOrder('FAKE-ORDER-1');
      expect(result.captureId).toMatch(/^FAKE-CAPTURE-/);
      expect(result.status).toBe(PayPalCaptureStatus.COMPLETED);
    });
  });

  describe('createPayoutBatch', () => {
    it('returns batch ID and status', async () => {
      const result: { paypalBatchId: string; status: PayPalBatchStatus } = await gateway.createPayoutBatch({
        sender_batch_header: {
          sender_batch_id: 'batch-1',
          email_subject: 'Test',
          email_message: 'Test',
        },
        items: [],
      });
      expect(result.paypalBatchId).toMatch(/^FAKE-BATCH-/);
      expect(result.status).toBe(PayPalBatchStatus.PROCESSING);
    });

    it('rejects payout items with zero or negative amount', async () => {
      await expect(
        gateway.createPayoutBatch({
          sender_batch_header: {
            sender_batch_id: 'batch-neg',
            email_subject: 'Test',
            email_message: 'Test',
          },
          items: [
            {
              recipient_type: 'EMAIL',
              amount: { value: '-10.00', currency: 'USD' },
              receiver: 'venue@example.com',
              note: 'Negative payout',
              sender_item_id: 'item-neg',
            },
          ],
        })
      ).rejects.toThrow('Payout item amount must be positive');

      await expect(
        gateway.createPayoutBatch({
          sender_batch_header: {
            sender_batch_id: 'batch-zero',
            email_subject: 'Test',
            email_message: 'Test',
          },
          items: [
            {
              recipient_type: 'EMAIL',
              amount: { value: '0.00', currency: 'USD' },
              receiver: 'venue@example.com',
              note: 'Zero payout',
              sender_item_id: 'item-zero',
            },
          ],
        })
      ).rejects.toThrow('Payout item amount must be positive');
    });
  });

  describe('verifyWebhook', () => {
    it('returns true when signature is ok', async () => {
      const result: boolean = await gateway.verifyWebhook(
        { 'x-fake-signature': 'ok' },
        '{}'
      );
      expect(result).toBe(true);
    });

    it('returns false when signature is missing', async () => {
      const result: boolean = await gateway.verifyWebhook({}, '{}');
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
      const calls: ReturnType<FakePayPalGateway['getCalls']> = gateway.getCalls();
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
