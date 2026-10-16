import { z } from 'zod';

export const UpdatePlatformSettingsSchema: z.ZodEffects<z.ZodObject<{ platformFeeBps: z.ZodOptional<z.ZodNumber>; taxRateBps: z.ZodOptional<z.ZodNumber>; }, "strip", z.ZodTypeAny, { platformFeeBps?: number | undefined; taxRateBps?: number | undefined; }, { platformFeeBps?: number | undefined; taxRateBps?: number | undefined; }>, { platformFeeBps?: number | undefined; taxRateBps?: number | undefined; }, { platformFeeBps?: number | undefined; taxRateBps?: number | undefined; }> = z
  .object({
    platformFeeBps: z
      .number()
      .int('Platform fee BPS must be an integer')
      .min(0, 'Platform fee BPS cannot be negative')
      .max(10000, 'Platform fee BPS cannot exceed 10000')
      .optional(),
    taxRateBps: z
      .number()
      .int('Tax rate BPS must be an integer')
      .min(0, 'Tax rate BPS cannot be negative')
      .max(10000, 'Tax rate BPS cannot exceed 10000')
      .optional(),
  })
  .refine(
    (data) => data.platformFeeBps !== undefined || data.taxRateBps !== undefined,
    {
      message: 'At least one of platformFeeBps or taxRateBps must be provided',
    }
  );

export type UpdatePlatformSettingsRequest = z.infer<typeof UpdatePlatformSettingsSchema>;
