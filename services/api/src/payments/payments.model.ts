import { OrderStatus } from '@tabhop/database';
import { Decimal } from '@prisma/client/runtime/library';
import type { Currency } from '../lib/currency.js';

/**
 * Payment and settlement status enums, constants, and database DTOs.
 */

export enum PayPalOrderStatus {
  CREATED = 'CREATED',
  SAVED = 'SAVED',
  APPROVED = 'APPROVED',
  VOIDED = 'VOIDED',
  COMPLETED = 'COMPLETED',
}

export enum PayPalCaptureStatus {
  COMPLETED = 'COMPLETED',
  DECLINED = 'DECLINED',
  PENDING = 'PENDING',
  REFUNDED = 'REFUNDED',
}

export enum PayPalBatchStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  DENIED = 'DENIED',
  FAILED = 'FAILED',
}

export const PAYPAL_STATUS_MAP: { readonly CAPTURE_SUCCESS: PayPalCaptureStatus.COMPLETED; readonly CAPTURE_PENDING: PayPalCaptureStatus.PENDING; readonly CAPTURE_DECLINED: PayPalCaptureStatus.DECLINED; } = {
  CAPTURE_SUCCESS: PayPalCaptureStatus.COMPLETED,
  CAPTURE_PENDING: PayPalCaptureStatus.PENDING,
  CAPTURE_DECLINED: PayPalCaptureStatus.DECLINED,
} as const;

export interface PaymentOrderRecordDto {
  id: string;
  status: OrderStatus;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  totalAmount: Decimal | { toString(): string };
  currency: Currency;
}

export interface PayPalOAuthTokenResponse {
  access_token: string;
  expires_in: number;
}

export interface PayPalOrderLink {
  rel: string;
  href: string;
}

export interface PayPalCreateOrderResponse {
  id: string;
  links: PayPalOrderLink[];
}

export interface PayPalCaptureRecord {
  id: string;
  status: string;
  amount: {
    value: string;
  };
}

export interface PayPalCaptureOrderResponse {
  purchase_units: Array<{
    payments: {
      captures: PayPalCaptureRecord[];
    };
  }>;
}

export interface PayPalCreatePayoutBatchResponse {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
  };
}

export interface PayPalWebhookVerificationResponse {
  verification_status: string;
}

