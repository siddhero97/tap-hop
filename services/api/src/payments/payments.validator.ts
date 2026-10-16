import { z } from 'zod';

/**
 * Zod schema for creating PayPal order
 */
export const CreatePayPalOrderSchema: z.ZodObject<z.ZodRawShape> = z.object({
  // No additional fields required - order ID comes from URL
});

export type CreatePayPalOrderRequest = z.infer<typeof CreatePayPalOrderSchema>;

/**
 * Zod schema for capturing PayPal order
 */
export const CapturePayPalOrderSchema: z.ZodObject<z.ZodRawShape> = z.object({
  // No additional fields required - order ID comes from URL
});

export type CapturePayPalOrderRequest = z.infer<typeof CapturePayPalOrderSchema>;

/**
 * Validation schema for order ID (UUID format)
 */
export const OrderIdSchema: z.ZodString = z.string().uuid('Invalid order ID format');

export const OrderIdParamsSchema: z.ZodObject<{ id: z.ZodString; }, "strip", z.ZodTypeAny, { id: string; }, { id: string; }> = z.object({ id: OrderIdSchema });
