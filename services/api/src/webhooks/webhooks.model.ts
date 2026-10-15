/**
 * PayPal webhook event payload structure
 */
export interface WebhookPayload {
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
  [key: string]: any;
}
