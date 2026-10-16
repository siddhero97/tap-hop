import { z } from 'zod';

/**
 * Compile-time template literal type for normalized email addresses.
 */
export type Email = `${string}@${string}.${string}`;

const EMAIL_PATTERN: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Type guard verifying whether a string conforms to the Email format.
 */
export function isEmail(value: string): value is Email {
  const matches: boolean = EMAIL_PATTERN.test(value);
  return matches;
}

/**
 * Normalize (trim and lowercase) and validate an email string, returning an Email.
 */
export function toEmail(value: string): Email {
  const normalized: string = value.trim().toLowerCase();
  if (!isEmail(normalized)) {
    throw new Error(`Invalid email address: ${value}`);
  }
  return normalized;
}

/**
 * Shared Zod schema that trims, lowercases, validates, and narrows strings to Email.
 */
export const EmailSchema: z.ZodEffects<z.ZodString, Email, string> = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email address')
  .transform((val: string): Email => {
    const email: Email = val as Email;
    return email;
  });
