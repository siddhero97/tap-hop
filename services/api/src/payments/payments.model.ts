/**
 * Payment and settlement status enums and constants.
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

export const PAYPAL_STATUS_MAP = {
  CAPTURE_SUCCESS: PayPalCaptureStatus.COMPLETED,
  CAPTURE_PENDING: PayPalCaptureStatus.PENDING,
  CAPTURE_DECLINED: PayPalCaptureStatus.DECLINED,
} as const;
