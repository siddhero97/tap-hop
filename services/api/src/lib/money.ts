import { Decimal } from '@prisma/client';

export function toCents(value: string | number | Decimal): number {
  const str = typeof value === 'object' ? value.toString() : String(value);
  const match = str.match(/^(-?\d+)\.?(\d{0,2})?$/);
  if (!match) throw new Error(`Invalid money value: ${str}`);
  const dollars = match[1];
  const cents = (match[2] || '0').padEnd(2, '0');
  return parseInt(dollars + cents, 10);
}

export function fromCents(cents: number): Decimal {
  if (!Number.isInteger(cents)) throw new Error(`cents must be integer, got ${cents}`);
  const str = Math.abs(cents).toString().padStart(3, '0');
  const dollars = str.slice(0, -2) || '0';
  const decimal = str.slice(-2);
  const sign = cents < 0 ? '-' : '';
  return new Decimal(`${sign}${dollars}.${decimal}`);
}

export function assertCentInvariant(sumCents: number, targetCents: number, context: string): void {
  if (sumCents !== targetCents) {
    throw new Error(`Cent invariant (${context}): sum ${sumCents} !== target ${targetCents}`);
  }
}
