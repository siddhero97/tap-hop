import { z } from 'zod';
import { UserRole } from '@tabhop/database';
import { EmailSchema, type Email } from '../lib/email.js';

export const RegisterSchema: z.ZodObject<{ email: typeof EmailSchema; password: z.ZodString; displayName: z.ZodString; role: z.ZodDefault<z.ZodOptional<z.ZodNativeEnum<{ PATRON: "PATRON"; STAFF: "STAFF"; MERCHANT_ADMIN: "MERCHANT_ADMIN"; PLATFORM_SUPPORT: "PLATFORM_SUPPORT"; PLATFORM_FINANCE: "PLATFORM_FINANCE"; PLATFORM_ADMIN: "PLATFORM_ADMIN"; }>>>; merchantId: z.ZodOptional<z.ZodString>; staffId: z.ZodOptional<z.ZodString>; }, "strip", z.ZodTypeAny, { email: Email; password: string; displayName: string; role: "PATRON" | "STAFF" | "MERCHANT_ADMIN" | "PLATFORM_SUPPORT" | "PLATFORM_FINANCE" | "PLATFORM_ADMIN"; merchantId?: string | undefined; staffId?: string | undefined; }, { email: string; password: string; displayName: string; role?: "PATRON" | "STAFF" | "MERCHANT_ADMIN" | "PLATFORM_SUPPORT" | "PLATFORM_FINANCE" | "PLATFORM_ADMIN" | undefined; merchantId?: string | undefined; staffId?: string | undefined; }> = z.object({
  email: EmailSchema,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password cannot exceed 128 characters'),
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name cannot exceed 100 characters'),
  role: z.nativeEnum(UserRole).optional().default(UserRole.PATRON),
  merchantId: z.string().uuid('Invalid merchantId UUID').optional(),
  staffId: z.string().uuid('Invalid staffId UUID').optional(),
});

export const LoginSchema: z.ZodObject<{ email: typeof EmailSchema; password: z.ZodString; }, "strip", z.ZodTypeAny, { email: Email; password: string; }, { email: string; password: string; }> = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Password is required'),
});

export type RegisterRequest = z.infer<typeof RegisterSchema>;
export type LoginRequest = z.infer<typeof LoginSchema>;
