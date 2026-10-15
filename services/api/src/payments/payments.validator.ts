import { z } from 'zod';

/**
 * Zod schema for creating PayPal order
 */
export const CreatePayPalOrderSchema = z.object({
  // No additional fields required - order ID comes from URL
});

export type CreatePayPalOrderRequest = z.infer<typeof CreatePayPalOrderSchema>;

/**
 * Zod schema for capturing PayPal order
 */
export const CapturePayPalOrderSchema = z.object({
  // No additional fields required - order ID comes from URL
});

export type CapturePayPalOrderRequest = z.infer<typeof CapturePayPalOrderSchema>;

/**
 * Validation schema for order ID (UUID format)
 */
export const OrderIdSchema = z.string().uuid('Invalid order ID format');

export const OrderIdParamsSchema = z.object({ id: OrderIdSchema });
