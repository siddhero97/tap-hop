import { z } from 'zod';
import { PayoutStatus } from '@tabhop/database';

/**
 * Zod schema for retry request
 */
export const RetrySettlementSchema: z.ZodObject<z.ZodRawShape> = z.object({
  // No additional fields required
});

export type RetrySettlementRequest = z.infer<typeof RetrySettlementSchema>;

/**
 * Zod schema for GET settlements query params
 */
export const GetSettlementsSchema: z.ZodObject<{ page: z.ZodDefault<z.ZodOptional<z.ZodNumber>>; pageSize: z.ZodDefault<z.ZodOptional<z.ZodNumber>>; venueId: z.ZodOptional<z.ZodString>; status: z.ZodOptional<z.ZodEnum<["QUEUED", "PROCESSING", "COMPLETED", "FAILED"]>>; startDate: z.ZodOptional<z.ZodDate>; endDate: z.ZodOptional<z.ZodDate>; }, "strip", z.ZodTypeAny, { page: number; pageSize: number; status?: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | undefined; venueId?: string | undefined; startDate?: Date | undefined; endDate?: Date | undefined; }, { status?: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | undefined; venueId?: string | undefined; page?: number | undefined; pageSize?: number | undefined; startDate?: Date | undefined; endDate?: Date | undefined; }> = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
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
export const OrderIdSchema: z.ZodString = z.string().uuid('Invalid order ID format');

export const SettlementOrderParamsSchema: z.ZodObject<{ orderId: z.ZodString; }, "strip", z.ZodTypeAny, { orderId: string; }, { orderId: string; }> = z.object({ orderId: OrderIdSchema });
