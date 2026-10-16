import { z } from 'zod';

export const VenueIdParamsSchema: z.ZodObject<{ venueId: z.ZodString; }, "strip", z.ZodTypeAny, { venueId: string; }, { venueId: string; }> = z.object({
  venueId: z.string().uuid(),
});

export const CatalogMenuQuerySchema: z.ZodObject<{ radiusMeters: z.ZodOptional<z.ZodNumber>; }, "strip", z.ZodTypeAny, { radiusMeters?: number | undefined; }, { radiusMeters?: number | undefined; }> = z.object({
  radiusMeters: z.coerce
    .number()
    .positive('Radius in meters must be a positive number')
    .max(50000, 'Radius in meters cannot exceed 50000')
    .optional(),
});

export type VenueIdParams = z.infer<typeof VenueIdParamsSchema>;
export type CatalogMenuQuery = z.infer<typeof CatalogMenuQuerySchema>;

