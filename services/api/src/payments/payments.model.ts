import { OrderStatus } from '@tabhop/database';
import { Decimal } from '@prisma/client/runtime/library';

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
  currency: string;
}
