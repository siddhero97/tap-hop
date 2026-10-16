import { z } from 'zod';

/**
 * Health check endpoint (no validation needed, GET request with no body)
 */
export const HealthCheckSchema: z.ZodObject<z.ZodRawShape> = z.object({});

export type HealthCheckRequest = z.infer<typeof HealthCheckSchema>;
