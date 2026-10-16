import { z } from 'zod';

const envSchema: z.ZodObject<{ NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>; PORT: z.ZodDefault<z.ZodNumber>; DATABASE_URL: z.ZodString; PAYPAL_MODE: z.ZodDefault<z.ZodEnum<["fake", "sandbox"]>>; PAYPAL_CLIENT_ID: z.ZodOptional<z.ZodString>; PAYPAL_CLIENT_SECRET: z.ZodOptional<z.ZodString>; PAYPAL_WEBHOOK_ID: z.ZodOptional<z.ZodString>; PLATFORM_FEE_BPS: z.ZodDefault<z.ZodNumber>; TAX_RATE_BPS: z.ZodDefault<z.ZodNumber>; LOG_LEVEL: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>; }, "strip", z.ZodTypeAny, { NODE_ENV: "development" | "test" | "production"; PORT: number; DATABASE_URL: string; PAYPAL_MODE: "fake" | "sandbox"; PLATFORM_FEE_BPS: number; TAX_RATE_BPS: number; LOG_LEVEL: "debug" | "info" | "warn" | "error"; PAYPAL_CLIENT_ID?: string | undefined; PAYPAL_CLIENT_SECRET?: string | undefined; PAYPAL_WEBHOOK_ID?: string | undefined; }, { DATABASE_URL: string; NODE_ENV?: "development" | "test" | "production" | undefined; PORT?: number | undefined; PAYPAL_MODE?: "fake" | "sandbox" | undefined; PAYPAL_CLIENT_ID?: string | undefined; PAYPAL_CLIENT_SECRET?: string | undefined; PAYPAL_WEBHOOK_ID?: string | undefined; PLATFORM_FEE_BPS?: number | undefined; TAX_RATE_BPS?: number | undefined; LOG_LEVEL?: "debug" | "info" | "warn" | "error" | undefined; }> = z.object({
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

const result: z.SafeParseReturnType<{ DATABASE_URL: string; NODE_ENV?: "development" | "test" | "production" | undefined; PORT?: number | undefined; PAYPAL_MODE?: "fake" | "sandbox" | undefined; PAYPAL_CLIENT_ID?: string | undefined; PAYPAL_CLIENT_SECRET?: string | undefined; PAYPAL_WEBHOOK_ID?: string | undefined; PLATFORM_FEE_BPS?: number | undefined; TAX_RATE_BPS?: number | undefined; LOG_LEVEL?: "debug" | "info" | "warn" | "error" | undefined; }, { NODE_ENV: "development" | "test" | "production"; PORT: number; DATABASE_URL: string; PAYPAL_MODE: "fake" | "sandbox"; PLATFORM_FEE_BPS: number; TAX_RATE_BPS: number; LOG_LEVEL: "debug" | "info" | "warn" | "error"; PAYPAL_CLIENT_ID?: string | undefined; PAYPAL_CLIENT_SECRET?: string | undefined; PAYPAL_WEBHOOK_ID?: string | undefined; }> = envSchema.refine(
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

export const env: { NODE_ENV: "development" | "test" | "production"; PORT: number; DATABASE_URL: string; PAYPAL_MODE: "fake" | "sandbox"; PLATFORM_FEE_BPS: number; TAX_RATE_BPS: number; LOG_LEVEL: "debug" | "info" | "warn" | "error"; PAYPAL_CLIENT_ID?: string | undefined; PAYPAL_CLIENT_SECRET?: string | undefined; PAYPAL_WEBHOOK_ID?: string | undefined; } = result.data;
export type Env = typeof env;
