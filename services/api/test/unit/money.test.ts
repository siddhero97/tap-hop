import { describe, it, expect, vi, type MockInstance } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { toCents, fromCents, assertCentInvariant } from '../../src/lib/money';
import {
  Currency,
  DEFAULT_CURRENCY,
  isCurrency,
  toCurrency,
  CurrencySchema,
} from '../../src/lib/currency';

describe('money', () => {
  describe('toCents', () => {
    it('converts decimal to cents', () => {
      expect(toCents('19.99')).toBe(1999);
      expect(toCents('0.01')).toBe(1);
      expect(toCents(100)).toBe(10000);
      expect(toCents('5.5')).toBe(550);
      expect(toCents(new Decimal('19.99'))).toBe(1999);
    });

    it('converts negative decimal values to negative cents and normalizes -0 to 0', () => {
      expect(toCents('-19.99')).toBe(-1999);
      expect(toCents('-0.01')).toBe(-1);
      expect(toCents('-0.5')).toBe(-50);
      expect(toCents(-100)).toBe(-10000);
      expect(toCents(new Decimal('-19.99'))).toBe(-1999);
      expect(Object.is(toCents('-0.00'), 0)).toBe(true);
      expect(Object.is(toCents('-0'), 0)).toBe(true);
    });

    it('throws on invalid or malformed negative strings', () => {
      expect(() => toCents('abc')).toThrow();
      expect(() => toCents('1.999')).toThrow();
      expect(() => toCents('-1.999')).toThrow();
      expect(() => toCents('--10.00')).toThrow();
      expect(() => toCents('-10.-50')).toThrow();
      expect(() => toCents('')).toThrow();
      expect(() => toCents(NaN)).toThrow();
      expect(() => toCents(Infinity)).toThrow();
      expect(() => toCents(-Infinity)).toThrow();
    });
  });

  describe('fromCents', () => {
    it('converts cents to Decimal', () => {
      const result: Decimal = fromCents(1999);
      expect(result.toFixed(2)).toBe('19.99');
    });

    it('converts negative and zero cents to Decimal', () => {
      expect(fromCents(-1999).toFixed(2)).toBe('-19.99');
      expect(fromCents(-5).toFixed(2)).toBe('-0.05');
      expect(fromCents(-1).toFixed(2)).toBe('-0.01');
      expect(fromCents(-100).toFixed(2)).toBe('-1.00');
      expect(fromCents(0).toFixed(2)).toBe('0.00');
    });

    it('falls back to 0 dollars when slice(0, -2) is empty', () => {
      const spy: MockInstance<[maxLength: number, fillString?: string | undefined], string> = vi.spyOn(String.prototype, 'padStart').mockReturnValueOnce('05');
      expect(fromCents(5).toFixed(2)).toBe('0.05');
      spy.mockRestore();
    });

    it('throws on non-integer (positive, negative, NaN, Infinity)', () => {
      expect(() => fromCents(1.5)).toThrow();
      expect(() => fromCents(-1.5)).toThrow();
      expect(() => fromCents(NaN)).toThrow();
      expect(() => fromCents(Infinity)).toThrow();
      expect(() => fromCents(-Infinity)).toThrow();
    });
  });

  describe('assertCentInvariant', () => {
    it('passes when match', () => {
      expect(() => assertCentInvariant(1500, 1500, 'test')).not.toThrow();
      expect(() => assertCentInvariant(0, 0, 'zero')).not.toThrow();
    });

    it('throws on mismatch including negative cent discrepancies', () => {
      expect(() => assertCentInvariant(1500, 1600, 'test')).toThrow(/Cent invariant/);
      expect(() => assertCentInvariant(1500, -1500, 'negative mismatch')).toThrow(/Cent invariant/);
    });
  });

  describe('currency', () => {
    it('exposes DEFAULT_CURRENCY as USD and validates supported currency codes', () => {
      expect(DEFAULT_CURRENCY).toBe(Currency.USD);
      expect(isCurrency('USD')).toBe(true);
      expect(isCurrency('EUR')).toBe(true);
      expect(isCurrency('GBP')).toBe(true);
      expect(isCurrency('CAD')).toBe(true);
      expect(isCurrency('AUD')).toBe(true);
      expect(isCurrency('JPY')).toBe(false);
    });

    it('normalizes currency strings with toCurrency and throws on unsupported codes', () => {
      expect(toCurrency(' usd ')).toBe(Currency.USD);
      expect(toCurrency('eur')).toBe(Currency.EUR);
      expect(() => toCurrency('INVALID')).toThrow('Unsupported currency code: INVALID');
    });

    it('validates Currency enum values via CurrencySchema', () => {
      expect(CurrencySchema.parse(Currency.USD)).toBe(Currency.USD);
      expect(() => CurrencySchema.parse('XYZ')).toThrow();
    });
  });
});

