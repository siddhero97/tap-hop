import { PayPalCaptureStatus, PayPalBatchStatus } from './payments.model.js';
import type { Email } from '../lib/email.js';

/**
 * PayPal gateway interface for order creation, capture, and payouts.
 * Two implementations: REST for sandbox/production, Fake for testing.
 */
export interface PayPalGateway {
  /**
   * Create a PayPal order for the given amount and reference.
   * Returns the order ID and approval URL for the patron to use.
   */
  createOrder(input: {
    referenceId: string;
    amountCents: number;
    currency: string;
  }): Promise<{ paypalOrderId: string; approveUrl: string }>;

  /**
   * Capture a previously-created order.
   * Returns capture ID and status.
   */
  captureOrder(paypalOrderId: string): Promise<{
    captureId: string;
    status: PayPalCaptureStatus;
    amountCents: number;
  }>;

  /**
   * Create a batch payout to multiple recipients.
   * Returns batch ID and processing status.
   */
  createPayoutBatch(req: PayoutBatchRequest): Promise<{
    paypalBatchId: string;
    status: PayPalBatchStatus;
  }>;

  /**
   * Verify a PayPal webhook signature.
   * Returns true if signature is valid, false otherwise.
   */
  verifyWebhook(headers: Record<string, string>, rawBody: string): Promise<boolean>;
}

export interface PayoutBatchRequest {
  sender_batch_header: {
    sender_batch_id: string;
    email_subject: string;
    email_message: string;
  };
  items: Array<{
    recipient_type: 'EMAIL';
    amount: { value: string; currency: string };
    receiver: Email;
    note: string;
    sender_item_id: string;
  }>;
}
