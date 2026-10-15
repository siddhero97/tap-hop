import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PayPalRestGateway } from '../../src/payments/payments.rest-gateway';
import { PayPalCaptureStatus, PayPalBatchStatus } from '../../src/payments/payments.model';

describe('PayPalRestGateway (mocked)', () => {
  let gateway: PayPalRestGateway;
  let fetchMock: any;

  beforeEach(() => {
    gateway = new PayPalRestGateway('test-id', 'test-secret', 'test-webhook-id');
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('token caching', () => {
    it('token endpoint returns bearer token', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve' }],
        }),
      });

      const result = await gateway.createOrder({
        referenceId: 'ref-1',
        amountCents: 1000,
        currency: 'USD',
      });

      expect(result.paypalOrderId).toBe('order-123');
      expect(result.approveUrl).toBe('https://paypal.com/approve');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reuses token within expiry time', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve' }],
        }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-456',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve2' }],
        }),
      });

      // First call gets token
      await gateway.createOrder({
        referenceId: 'ref-1',
        amountCents: 1000,
        currency: 'USD',
      });

      // Second call reuses token
      await gateway.createOrder({
        referenceId: 'ref-2',
        amountCents: 2000,
        currency: 'USD',
      });

      // Should only have 3 calls: 1 token + 2 orders (no second token fetch)
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('createOrder', () => {
    it('succeeds with valid response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve' }],
        }),
      });

      const result = await gateway.createOrder({
        referenceId: 'ref-1',
        amountCents: 1000,
        currency: 'USD',
      });

      expect(result.paypalOrderId).toBe('order-123');
      expect(result.approveUrl).toBe('https://paypal.com/approve');
    });

    it('includes request ID for deduplication', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve' }],
        }),
      });

      await gateway.createOrder({
        referenceId: 'ref-1',
        amountCents: 1000,
        currency: 'USD',
      });

      const orderCall = fetchMock.mock.calls[1];
      expect(orderCall[1].headers['PayPal-Request-Id']).toBe('order-ref-1');
    });

    it('converts amount cents to decimal correctly', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve' }],
        }),
      });

      await gateway.createOrder({
        referenceId: 'ref-1',
        amountCents: 1999,
        currency: 'USD',
      });

      const orderCall = fetchMock.mock.calls[1];
      const body = JSON.parse(orderCall[1].body);
      expect(body.purchase_units[0].amount.value).toBe('19.99');
    });

    it('handles PayPal API error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized',
        status: 401,
      });

      await expect(
        gateway.createOrder({
          referenceId: 'ref-1',
          amountCents: 1000,
          currency: 'USD',
        })
      ).rejects.toThrow('PayPal createOrder failed: Unauthorized');
    });

    it('handles missing approve link', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          links: [],
        }),
      });

      const result = await gateway.createOrder({
        referenceId: 'ref-1',
        amountCents: 1000,
        currency: 'USD',
      });

      expect(result.paypalOrderId).toBe('order-123');
      expect(result.approveUrl).toBe('');
    });
  });

  describe('captureOrder', () => {
    it('succeeds with valid response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'capture-456',
                    status: 'COMPLETED',
                    amount: { value: '10.00' },
                  },
                ],
              },
            },
          ],
        }),
      });

      const result = await gateway.captureOrder('order-123');

      expect(result.captureId).toBe('capture-456');
      expect(result.status).toBe(PayPalCaptureStatus.COMPLETED);
      expect(result.amountCents).toBe(1000);
    });

    it('includes request ID for deduplication', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'capture-456',
                    status: 'COMPLETED',
                    amount: { value: '10.00' },
                  },
                ],
              },
            },
          ],
        }),
      });

      await gateway.captureOrder('order-123');

      const captureCall = fetchMock.mock.calls[1];
      expect(captureCall[1].headers['PayPal-Request-Id']).toBe('capture-order-123');
    });

    it('converts amount to cents correctly', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'capture-456',
                    status: 'COMPLETED',
                    amount: { value: '19.99' },
                  },
                ],
              },
            },
          ],
        }),
      });

      const result = await gateway.captureOrder('order-123');

      expect(result.amountCents).toBe(1999);
    });

    it('handles pending status', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'capture-456',
                    status: 'PENDING',
                    amount: { value: '10.00' },
                  },
                ],
              },
            },
          ],
        }),
      });

      const result = await gateway.captureOrder('order-123');

      expect(result.status).toBe(PayPalCaptureStatus.PENDING);
    });

    it('handles PayPal API error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        status: 404,
      });

      await expect(gateway.captureOrder('order-123')).rejects.toThrow(
        'PayPal captureOrder failed: Not Found'
      );
    });

    it('handles missing capture data', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          purchase_units: [{ payments: { captures: [] } }],
        }),
      });

      const result = await gateway.captureOrder('order-123');

      expect(result.captureId).toBe('');
      expect(result.status).toBe(PayPalCaptureStatus.PENDING);
      expect(result.amountCents).toBe(0);
    });
  });

  describe('createPayoutBatch', () => {
    it('succeeds with valid response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          batch_header: {
            payout_batch_id: 'batch-789',
            batch_status: 'PROCESSING',
          },
        }),
      });

      const result = await gateway.createPayoutBatch({
        sender_batch_header: {
          sender_batch_id: 'batch-123',
          email_subject: 'Test Payout',
          email_message: 'Here is your payout',
        },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: { value: '50.00', currency: 'USD' },
            receiver: 'test@example.com',
            note: 'Payment',
            sender_item_id: 'item-1',
          },
        ],
      });

      expect(result.paypalBatchId).toBe('batch-789');
      expect(result.status).toBe(PayPalBatchStatus.PROCESSING);
    });

    it('uses sender_batch_id as request ID', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          batch_header: {
            payout_batch_id: 'batch-789',
            batch_status: 'PROCESSING',
          },
        }),
      });

      await gateway.createPayoutBatch({
        sender_batch_header: {
          sender_batch_id: 'batch-123',
          email_subject: 'Test Payout',
          email_message: 'Here is your payout',
        },
        items: [],
      });

      const payoutCall = fetchMock.mock.calls[1];
      expect(payoutCall[1].headers['PayPal-Request-Id']).toBe('batch-123');
    });

    it('handles PayPal API error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Forbidden',
        status: 403,
      });

      await expect(
        gateway.createPayoutBatch({
          sender_batch_header: {
            sender_batch_id: 'batch-123',
            email_subject: 'Test Payout',
            email_message: 'Here is your payout',
          },
          items: [],
        })
      ).rejects.toThrow('PayPal createPayoutBatch failed: Forbidden');
    });
  });

  describe('verifyWebhook', () => {
    it('returns true when signature is valid', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verification_status: 'SUCCESS' }),
      });

      const result = await gateway.verifyWebhook(
        {
          'paypal-transmission-id': 'trans-123',
          'paypal-transmission-time': '2024-01-01T00:00:00Z',
          'paypal-cert-url': 'https://paypal.com/cert',
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-transmission-sig': 'sig-123',
        },
        '{"event_type":"PAYMENT.SALE.COMPLETED"}'
      );

      expect(result).toBe(true);
    });

    it('returns false when signature is invalid', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verification_status: 'FAILURE' }),
      });

      const result = await gateway.verifyWebhook(
        {
          'paypal-transmission-id': 'trans-123',
          'paypal-transmission-time': '2024-01-01T00:00:00Z',
          'paypal-cert-url': 'https://paypal.com/cert',
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-transmission-sig': 'sig-123',
        },
        '{"event_type":"PAYMENT.SALE.COMPLETED"}'
      );

      expect(result).toBe(false);
    });

    it('sends correct webhook verification headers', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verification_status: 'SUCCESS' }),
      });

      await gateway.verifyWebhook(
        {
          'paypal-transmission-id': 'trans-123',
          'paypal-transmission-time': '2024-01-01T00:00:00Z',
          'paypal-cert-url': 'https://paypal.com/cert',
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-transmission-sig': 'sig-123',
        },
        '{"event_type":"PAYMENT.SALE.COMPLETED"}'
      );

      const verifyCall = fetchMock.mock.calls[1];
      const body = JSON.parse(verifyCall[1].body);
      expect(body.transmission_id).toBe('trans-123');
      expect(body.webhook_id).toBe('test-webhook-id');
    });
  });

  describe('token auth failure', () => {
    it('throws error when token endpoint returns non-ok status', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized',
      });

      await expect(
        gateway.createOrder({
          referenceId: 'ref-1',
          amountCents: 1000,
          currency: 'USD',
        })
      ).rejects.toThrow('PayPal auth failed: Unauthorized');
    });
  });

  describe('integration flow', () => {
    it('token is cached across multiple operations', async () => {
      // Mock token endpoint
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'cached-token', expires_in: 3600 }),
      });

      // Mock createOrder
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve' }],
        }),
      });

      // Mock captureOrder
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'capture-456',
                    status: 'COMPLETED',
                    amount: { value: '10.00' },
                  },
                ],
              },
            },
          ],
        }),
      });

      // First operation
      const orderResult = await gateway.createOrder({
        referenceId: 'ref-1',
        amountCents: 1000,
        currency: 'USD',
      });

      // Second operation should reuse token
      const captureResult = await gateway.captureOrder(orderResult.paypalOrderId);

      expect(captureResult.captureId).toBe('capture-456');
      expect(captureResult.status).toBe(PayPalCaptureStatus.COMPLETED);
      // Only 3 calls total: 1 token + 1 order + 1 capture
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
