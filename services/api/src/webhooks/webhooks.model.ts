import { OrderStatus, PayoutStatus } from '@tabhop/database';

/**
 * PayPal webhook event payload structure and database record DTOs.
 */
export type WebhookPayload = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    status?: string;
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
  };
};

export interface WebhookEventRecordDto {
  id?: string;
  eventId: string;
  eventType?: string;
  verified?: boolean;
  processedAt?: Date | null;
}

export interface WebhookOrderRecordDto {
  id: string;
  status: OrderStatus | string;
  paypalOrderId?: string | null;
}

export interface WebhookPayoutBatchRecordDto {
  id: string;
  paypalBatchId?: string | null;
  status?: PayoutStatus | string;
}
