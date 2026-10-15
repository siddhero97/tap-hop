import { toCents, fromCents } from '../lib/money.js';
import { Decimal } from '@prisma/client';

/**
 * Compute total order amount from items and fees.
 * All intermediate calculations in cents (integers).
 */
export function computeOrderTotal(input: {
  lineItems: Array<{ priceDecimal: Decimal; quantity: number }>;
  taxRateBps: number;
  platformFeeBps: number;
}): {
  subtotalCents: number;
  taxCents: number;
  platformFeeCents: number;
  totalCents: number;
} {
  // Sum line items in cents
  const subtotalCents = input.lineItems.reduce((sum, line) => {
    const lineCents = toCents(line.priceDecimal) * line.quantity;
    return sum + lineCents;
  }, 0);

  // Tax: floor to avoid overcharge
  const taxCents = Math.floor((subtotalCents * input.taxRateBps) / 10000);

  // Platform fee: floor, kept by platform
  const platformFeeCents = Math.floor((subtotalCents * input.platformFeeBps) / 10000);

  const totalCents = subtotalCents + taxCents + platformFeeCents;

  return {
    subtotalCents,
    taxCents,
    platformFeeCents,
    totalCents,
  };
}

/**
 * Convert pricing result to Decimal for database storage.
 */
export function pricingToDecimals(pricing: ReturnType<typeof computeOrderTotal>) {
  return {
    subtotalAmount: fromCents(pricing.subtotalCents),
    taxAmount: fromCents(pricing.taxCents),
    platformFeeAmount: fromCents(pricing.platformFeeCents),
    totalAmount: fromCents(pricing.totalCents),
  };
}
