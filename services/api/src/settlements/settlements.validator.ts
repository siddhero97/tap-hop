import { z } from 'zod';
import { PayoutStatus } from '@tabhop/database';

/**
 * Zod schema for retry request
 */
export const RetrySettlementSchema = z.object({
  // No additional fields required
});

export type RetrySettlementRequest = z.infer<typeof RetrySettlementSchema>;

/**
 * Zod schema for GET settlements query params
 */
export const GetSettlementsSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().optional().default(10),
  venueId: z.string().uuid().optional(),
  status: z.enum([
    PayoutStatus.QUEUED,
    PayoutStatus.PROCESSING,
    PayoutStatus.COMPLETED,
    PayoutStatus.FAILED,
  ]).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export type GetSettlementsQuery = z.infer<typeof GetSettlementsSchema>;

/**
 * Validation schema for order ID (UUID format)
 */
export const OrderIdSchema = z.string().uuid('Invalid order ID format');
