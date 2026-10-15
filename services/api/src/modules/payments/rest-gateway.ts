import { PayPalGateway, PayoutBatchRequest } from './gateway.js';
import { PayPalCaptureStatus, PayPalBatchStatus } from './constants.js';
import { logger } from '../../lib/logger.js';

/**
 * PayPal REST gateway for sandbox and production.
 * Uses OAuth bearer token cached for 1 hour.
 * Includes request ID for deduplication.
 */
export class PayPalRestGateway implements PayPalGateway {
  private clientId: string;
  private clientSecret: string;
  private webhookId: string;
  private baseUrl: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(clientId: string, clientSecret: string, webhookId: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.webhookId = webhookId;
    this.baseUrl = 'https://api-m.sandbox.paypal.com';
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
      'base64'
    );
    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      throw new Error(`PayPal auth failed: ${response.statusText}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return this.token.value;
  }

  async createOrder(input: {
    referenceId: string;
    amountCents: number;
    currency: string;
  }): Promise<{ paypalOrderId: string; approveUrl: string }> {
    const token = await this.getToken();
    const response = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `order-${input.referenceId}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: input.referenceId,
            amount: {
              currency_code: input.currency,
              value: (input.amountCents / 100).toFixed(2),
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'PayPal createOrder failed');
      throw new Error(`PayPal createOrder failed: ${response.statusText}`);
    }

    const data = (await response.json()) as { id: string; links: Array<{ rel: string; href: string }> };
    const approveLink = data.links.find((l) => l.rel === 'approve');
    return {
      paypalOrderId: data.id,
      approveUrl: approveLink?.href || '',
    };
  }

  async captureOrder(paypalOrderId: string): Promise<{
    captureId: string;
    status: PayPalCaptureStatus;
    amountCents: number;
  }> {
    const token = await this.getToken();
    const response = await fetch(
      `${this.baseUrl}/v2/checkout/orders/${paypalOrderId}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `capture-${paypalOrderId}`,
        },
        body: '{}',
      }
    );

    if (!response.ok) {
      logger.error({ status: response.status }, 'PayPal captureOrder failed');
      throw new Error(`PayPal captureOrder failed: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      purchase_units: Array<{ payments: { captures: Array<{ id: string; status: string; amount: { value: string } }> } }>;
    };
    const capture = data.purchase_units[0]?.payments?.captures?.[0];
    return {
      captureId: capture?.id || '',
      status: (capture?.status as PayPalCaptureStatus) || PayPalCaptureStatus.PENDING,
      amountCents: Math.round(parseFloat(capture?.amount?.value || '0') * 100),
    };
  }

  async createPayoutBatch(req: PayoutBatchRequest): Promise<{
    paypalBatchId: string;
    status: PayPalBatchStatus;
  }> {
    const token = await this.getToken();
    const response = await fetch(`${this.baseUrl}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': req.sender_batch_header.sender_batch_id,
      },
      body: JSON.stringify(req),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'PayPal createPayoutBatch failed');
      throw new Error(`PayPal createPayoutBatch failed: ${response.statusText}`);
    }

    const data = (await response.json()) as { batch_header: { payout_batch_id: string; batch_status: string } };
    return {
      paypalBatchId: data.batch_header.payout_batch_id,
      status: (data.batch_header.batch_status as PayPalBatchStatus) || PayPalBatchStatus.PENDING,
    };
  }

  async verifyWebhook(
    headers: Record<string, string>,
    rawBody: string
  ): Promise<boolean> {
    const token = await this.getToken();
    const response = await fetch(
      `${this.baseUrl}/v1/notifications/verify-webhook-signature`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transmission_id: headers['paypal-transmission-id'],
          transmission_time: headers['paypal-transmission-time'],
          cert_url: headers['paypal-cert-url'],
          auth_algo: headers['paypal-auth-algo'],
          transmission_sig: headers['paypal-transmission-sig'],
          webhook_id: this.webhookId,
          webhook_event: rawBody,
        }),
      }
    );

    const data = (await response.json()) as { verification_status: string };
    return data.verification_status === 'SUCCESS';
  }
}
