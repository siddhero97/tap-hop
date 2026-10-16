import { z } from 'zod';

/**
 * Validation schema for PayPal webhook payload
 * (minimal validation as structure is determined by PayPal)
 */
export const PayPalWebhookSchema: z.ZodObject<z.ZodRawShape, 'passthrough'> = z.object({}).passthrough();

export type PayPalWebhookPayload = z.infer<typeof PayPalWebhookSchema>;

/**
 * Raw webhook body must be non-empty (needed for signature verification)
 */
export const RawBodySchema: z.ZodString = z.string().min(1);
