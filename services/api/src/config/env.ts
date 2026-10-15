import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  PAYPAL_MODE: z.enum(['fake', 'sandbox']).default('fake'),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PLATFORM_FEE_BPS: z.coerce.number().int().default(500),
  TAX_RATE_BPS: z.coerce.number().int().default(800),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const result = envSchema.refine(
  (c) =>
    c.PAYPAL_MODE === 'fake' ||
    (c.PAYPAL_CLIENT_ID && c.PAYPAL_CLIENT_SECRET && c.PAYPAL_WEBHOOK_ID),
  {
    message:
      'PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID required when PAYPAL_MODE=sandbox',
  }
).safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment config:', result.error.flatten());
  process.exit(1);
}

export const env = result.data;
export type Env = typeof env;
