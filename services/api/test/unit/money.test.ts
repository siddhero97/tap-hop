import { describe, it, expect } from 'vitest';
import { toCents, fromCents, assertCentInvariant } from '../../src/lib/money';

describe('money', () => {
  describe('toCents', () => {
    it('converts decimal to cents', () => {
      expect(toCents('19.99')).toBe(1999);
      expect(toCents('0.01')).toBe(1);
      expect(toCents(100)).toBe(10000);
    });

    it('throws on invalid', () => {
      expect(() => toCents('abc')).toThrow();
      expect(() => toCents('1.999')).toThrow();
    });
  });

  describe('fromCents', () => {
    it('converts cents to Decimal', () => {
      const result = fromCents(1999);
      expect(result.toFixed(2)).toBe('19.99');
    });

    it('throws on non-integer', () => {
      expect(() => fromCents(1.5)).toThrow();
    });
  });

  describe('assertCentInvariant', () => {
    it('passes when match', () => {
      expect(() => assertCentInvariant(1500, 1500, 'test')).not.toThrow();
    });

    it('throws on mismatch', () => {
      expect(() => assertCentInvariant(1500, 1600, 'test')).toThrow(/Cent invariant/);
    });
  });
});
