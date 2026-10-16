import { PayPalGateway, PayoutBatchRequest } from './payments.gateway.js';
import {
  PayPalCaptureStatus,
  PayPalBatchStatus,
  type PayPalOAuthTokenResponse,
  type PayPalOrderLink,
  type PayPalCreateOrderResponse,
  type PayPalCaptureRecord,
  type PayPalCaptureOrderResponse,
  type PayPalCreatePayoutBatchResponse,
  type PayPalWebhookVerificationResponse,
} from './payments.model.js';
import type { Currency } from '../lib/currency.js';
import { logger } from '../lib/logger.js';

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
    if (!this.token || this.token.expiresAt <= Date.now()) {
      const basicAuthCredentials: string = Buffer.from(
        `${this.clientId}:${this.clientSecret}`
      ).toString('base64');
      const oauthTokenResponse: Response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuthCredentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });

      if (!oauthTokenResponse.ok) {
        throw new Error(`PayPal auth failed: ${oauthTokenResponse.statusText}`);
      }

      const oauthTokenPayload: PayPalOAuthTokenResponse =
        (await oauthTokenResponse.json()) as PayPalOAuthTokenResponse;
      this.token = {
        value: oauthTokenPayload.access_token,
        expiresAt: Date.now() + (oauthTokenPayload.expires_in - 60) * 1000,
      };
    }

    return this.token.value;
  }

  async createOrder(input: {
    referenceId: string;
    amountCents: number;
    currency: Currency;
  }): Promise<{ paypalOrderId: string; approveUrl: string }> {
    if (input.amountCents <= 0) {
      throw new Error('Order amountCents must be positive');
    }
    const bearerToken: string = await this.getToken();
    const createOrderResponse: Response = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
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

    if (!createOrderResponse.ok) {
      logger.error({ status: createOrderResponse.status }, 'PayPal createOrder failed');
      throw new Error(`PayPal createOrder failed: ${createOrderResponse.statusText}`);
    }

    const createdOrderPayload: PayPalCreateOrderResponse =
      (await createOrderResponse.json()) as PayPalCreateOrderResponse;
    const approveLink: PayPalOrderLink | undefined = createdOrderPayload.links.find(
      (link: PayPalOrderLink) => link.rel === 'approve'
    );
    return {
      paypalOrderId: createdOrderPayload.id,
      approveUrl: approveLink?.href || '',
    };
  }

  async captureOrder(paypalOrderId: string): Promise<{
    captureId: string;
    status: PayPalCaptureStatus;
    amountCents: number;
  }> {
    const bearerToken: string = await this.getToken();
    const captureOrderResponse: Response = await fetch(
      `${this.baseUrl}/v2/checkout/orders/${paypalOrderId}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `capture-${paypalOrderId}`,
        },
        body: '{}',
      }
    );

    if (!captureOrderResponse.ok) {
      logger.error({ status: captureOrderResponse.status }, 'PayPal captureOrder failed');
      throw new Error(`PayPal captureOrder failed: ${captureOrderResponse.statusText}`);
    }

    const capturedOrderPayload: PayPalCaptureOrderResponse =
      (await captureOrderResponse.json()) as PayPalCaptureOrderResponse;
    const primaryCaptureRecord: PayPalCaptureRecord | undefined =
      capturedOrderPayload.purchase_units[0]?.payments?.captures?.[0];
    return {
      captureId: primaryCaptureRecord?.id || '',
      status:
        (primaryCaptureRecord?.status as PayPalCaptureStatus) || PayPalCaptureStatus.PENDING,
      amountCents: Math.round(parseFloat(primaryCaptureRecord?.amount?.value || '0') * 100),
    };
  }

  async createPayoutBatch(req: PayoutBatchRequest): Promise<{
    paypalBatchId: string;
    status: PayPalBatchStatus;
  }> {
    if (req.items.some((item) => !(parseFloat(item.amount.value) > 0))) {
      throw new Error('Payout item amount must be positive');
    }
    const bearerToken: string = await this.getToken();
    const payoutBatchResponse: Response = await fetch(`${this.baseUrl}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': req.sender_batch_header.sender_batch_id,
      },
      body: JSON.stringify(req),
    });

    if (!payoutBatchResponse.ok) {
      logger.error({ status: payoutBatchResponse.status }, 'PayPal createPayoutBatch failed');
      throw new Error(`PayPal createPayoutBatch failed: ${payoutBatchResponse.statusText}`);
    }

    const payoutBatchPayload: PayPalCreatePayoutBatchResponse =
      (await payoutBatchResponse.json()) as PayPalCreatePayoutBatchResponse;
    return {
      paypalBatchId: payoutBatchPayload.batch_header.payout_batch_id,
      status:
        (payoutBatchPayload.batch_header.batch_status as PayPalBatchStatus) ||
        PayPalBatchStatus.PENDING,
    };
  }

  async verifyWebhook(
    headers: Record<string, string>,
    rawBody: string
  ): Promise<boolean> {
    const bearerToken: string = await this.getToken();
    const webhookVerificationResponse: Response = await fetch(
      `${this.baseUrl}/v1/notifications/verify-webhook-signature`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
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

    const webhookVerificationPayload: PayPalWebhookVerificationResponse =
      (await webhookVerificationResponse.json()) as PayPalWebhookVerificationResponse;
    return webhookVerificationPayload.verification_status === 'SUCCESS';
  }
}
