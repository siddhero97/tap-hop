import { z } from 'zod';

/**
 * Validation schema for PayPal webhook payload
 * (minimal validation as structure is determined by PayPal)
 */
export const PayPalWebhookSchema = z.object({}).passthrough();

export type PayPalWebhookPayload = z.infer<typeof PayPalWebhookSchema>;
