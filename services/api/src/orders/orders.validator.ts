import { z } from 'zod';

/**
 * Validation schema for creating an order
 */
export const CreateOrderSchema = z.object({
  venueId: z.string().uuid('Invalid venue ID format'),
  tableNumber: z.string().optional(),
  serverStaffId: z.string().uuid('Invalid server staff ID format').optional(),
  lines: z.array(
    z.object({
      itemId: z.string().uuid('Invalid item ID format'),
      quantity: z.number().int('Quantity must be integer').positive('Quantity must be positive'),
    })
  ),
  tipAmount: z.number().nonnegative('Tip amount cannot be negative').optional().default(0),
  idempotencyKey: z.string().optional(),
});

export type CreateOrderRequest = z.infer<typeof CreateOrderSchema>;

/**
 * Validation schema for order ID (UUID format)
 */
export const OrderIdSchema = z.string().uuid('Invalid order ID format');

export const OrderIdParamsSchema = z.object({ id: OrderIdSchema });
