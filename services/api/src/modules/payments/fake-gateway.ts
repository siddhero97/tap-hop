import { PayPalGateway, PayoutBatchRequest } from './gateway.js';
import { PayPalCaptureStatus, PayPalBatchStatus } from './constants.js';

/**
 * In-memory PayPal gateway for testing.
 * Returns deterministic IDs and records all calls for assertions.
 */
export class FakePayPalGateway implements PayPalGateway {
  private orderCounter = 0;
  private captureCounter = 0;
  private batchCounter = 0;
  private callLog: Array<{ method: string; args: any }> = [];
  private failureMode: string | null = null;

  /**
   * Set this gateway to fail on the next call to a specific method.
   */
  failNext(method: string): void {
    this.failureMode = method;
  }

  async createOrder(input: {
    referenceId: string;
    amountCents: number;
    currency: string;
  }): Promise<{ paypalOrderId: string; approveUrl: string }> {
    this.callLog.push({ method: 'createOrder', args: input });
    if (this.failureMode === 'createOrder') {
      this.failureMode = null;
      throw new Error('Simulated PayPal error: invalid request');
    }
    const id = `FAKE-ORDER-${++this.orderCounter}`;
    return {
      paypalOrderId: id,
      approveUrl: `https://sandbox.paypal.com/fake-approve?orderId=${id}`,
    };
  }

  async captureOrder(paypalOrderId: string): Promise<{
    captureId: string;
    status: PayPalCaptureStatus;
    amountCents: number;
  }> {
    this.callLog.push({ method: 'captureOrder', args: { paypalOrderId } });
    if (this.failureMode === 'captureOrder') {
      this.failureMode = null;
      throw new Error('Simulated PayPal error: capture failed');
    }
    return {
      captureId: `FAKE-CAPTURE-${++this.captureCounter}`,
      status: PayPalCaptureStatus.COMPLETED,
      amountCents: 1000,
    };
  }

  async createPayoutBatch(req: PayoutBatchRequest): Promise<{
    paypalBatchId: string;
    status: PayPalBatchStatus;
  }> {
    this.callLog.push({ method: 'createPayoutBatch', args: req });
    if (this.failureMode === 'createPayoutBatch') {
      this.failureMode = null;
      throw new Error('Simulated PayPal error: batch creation failed');
    }
    return {
      paypalBatchId: `FAKE-BATCH-${++this.batchCounter}`,
      status: PayPalBatchStatus.PROCESSING,
    };
  }

  async verifyWebhook(
    headers: Record<string, string>,
    rawBody: string
  ): Promise<boolean> {
    this.callLog.push({ method: 'verifyWebhook', args: { headers, rawBody } });
    return headers['x-fake-signature'] === 'ok';
  }

  /**
   * Get call log for test assertions.
   */
  getCalls(): Array<{ method: string; args: any }> {
    return this.callLog;
  }

  /**
   * Clear call log.
   */
  reset(): void {
    this.callLog = [];
    this.orderCounter = 0;
    this.captureCounter = 0;
    this.batchCounter = 0;
    this.failureMode = null;
  }
}
