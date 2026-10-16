import { z } from 'zod';

/**
 * Validation schema for creating an order
 */
export const CreateOrderSchema: z.ZodObject<{ venueId: z.ZodString; tableNumber: z.ZodOptional<z.ZodString>; serverStaffId: z.ZodOptional<z.ZodString>; lines: z.ZodArray<z.ZodObject<{ itemId: z.ZodString; quantity: z.ZodNumber; }, "strip", z.ZodTypeAny, { itemId: string; quantity: number; }, { itemId: string; quantity: number; }>, "many">; tipAmount: z.ZodDefault<z.ZodOptional<z.ZodNumber>>; idempotencyKey: z.ZodOptional<z.ZodString>; }, "strip", z.ZodTypeAny, { venueId: string; lines: { itemId: string; quantity: number; }[]; tipAmount: number; tableNumber?: string | undefined; serverStaffId?: string | undefined; idempotencyKey?: string | undefined; }, { venueId: string; lines: { itemId: string; quantity: number; }[]; tableNumber?: string | undefined; serverStaffId?: string | undefined; tipAmount?: number | undefined; idempotencyKey?: string | undefined; }> = z.object({
  venueId: z.string().uuid('Invalid venue ID format'),
  tableNumber: z.string().optional(),
  serverStaffId: z.string().uuid('Invalid server staff ID format').optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid('Invalid item ID format'),
        quantity: z.number().int('Quantity must be integer').positive('Quantity must be positive'),
      })
    )
    .min(1, 'Order must contain at least one item'),
  tipAmount: z.number().finite().nonnegative('Tip amount cannot be negative').optional().default(0),
  idempotencyKey: z.string().optional(),
});

export type CreateOrderRequest = z.infer<typeof CreateOrderSchema>;

/**
 * Validation schema for order ID (UUID format)
 */
export const OrderIdSchema: z.ZodString = z.string().uuid('Invalid order ID format');

export const OrderIdParamsSchema: z.ZodObject<{ id: z.ZodString; }, "strip", z.ZodTypeAny, { id: string; }, { id: string; }> = z.object({ id: OrderIdSchema });
