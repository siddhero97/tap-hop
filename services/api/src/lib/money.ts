import { Decimal } from '@prisma/client/runtime/library';

export function toCents(value: string | number | Decimal): number {
  const str: string = typeof value === 'object' ? value.toString() : String(value);
  const match: RegExpMatchArray | null = str.match(/^(-?\d+)\.?(\d{0,2})?$/);
  if (!match) throw new Error(`Invalid money value: ${str}`);
  const dollars: string = match[1];
  const cents: string = (match[2] || '0').padEnd(2, '0');
  const parsed: number = parseInt(dollars + cents, 10);
  return parsed === 0 ? 0 : parsed;
}

export function fromCents(cents: number): Decimal {
  if (!Number.isInteger(cents)) throw new Error(`cents must be integer, got ${cents}`);
  const str: string = Math.abs(cents).toString().padStart(3, '0');
  const dollars: string = str.slice(0, -2) || '0';
  const decimal: string = str.slice(-2);
  const sign: string = cents < 0 ? '-' : '';
  return new Decimal(`${sign}${dollars}.${decimal}`);
}

export function assertCentInvariant(sumCents: number, targetCents: number, context: string): void {
  if (sumCents !== targetCents) {
    throw new Error(`Cent invariant (${context}): sum ${sumCents} !== target ${targetCents}`);
  }
}
