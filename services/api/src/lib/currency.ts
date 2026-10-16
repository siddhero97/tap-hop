import { z } from 'zod';

/**
 * Supported ISO 4217 currency codes across orders, payments, and settlements.
 */
export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  CAD = 'CAD',
  AUD = 'AUD',
}

export const DEFAULT_CURRENCY: Currency = Currency.USD;

const SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set<string>(
  Object.values(Currency)
);

/**
 * Type guard verifying whether a string is a supported Currency code.
 */
export function isCurrency(value: string): value is Currency {
  const isSupported: boolean = SUPPORTED_CURRENCIES.has(value);
  return isSupported;
}

/**
 * Normalize (trim and uppercase) and validate a currency code string, returning a Currency.
 */
export function toCurrency(value: string): Currency {
  const normalized: string = value.trim().toUpperCase();
  if (!isCurrency(normalized)) {
    throw new Error(`Unsupported currency code: ${value}`);
  }
  return normalized;
}

/**
 * Shared Zod schema for validating Currency enum values.
 */
export const CurrencySchema: z.ZodNativeEnum<typeof Currency> =
  z.nativeEnum(Currency);
