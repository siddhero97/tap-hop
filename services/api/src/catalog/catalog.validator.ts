import { z } from 'zod';

export const VenueIdParamsSchema = z.object({
  venueId: z.string().uuid(),
});

export type VenueIdParams = z.infer<typeof VenueIdParamsSchema>;
