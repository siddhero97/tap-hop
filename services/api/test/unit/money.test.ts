import { describe, it, expect, vi } from 'vitest';
import { Decimal } from '@prisma/client';
import { toCents, fromCents, assertCentInvariant } from '../../src/lib/money';

describe('money', () => {
  describe('toCents', () => {
    it('converts decimal to cents', () => {
      expect(toCents('19.99')).toBe(1999);
      expect(toCents('0.01')).toBe(1);
      expect(toCents(100)).toBe(10000);
      expect(toCents('5.5')).toBe(550);
      expect(toCents(new Decimal('19.99'))).toBe(1999);
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

    it('converts negative and zero cents to Decimal', () => {
      expect(fromCents(-1999).toFixed(2)).toBe('-19.99');
      expect(fromCents(-5).toFixed(2)).toBe('-0.05');
      expect(fromCents(0).toFixed(2)).toBe('0.00');
    });

    it('falls back to 0 dollars when slice(0, -2) is empty', () => {
      const spy = vi.spyOn(String.prototype, 'padStart').mockReturnValueOnce('05');
      expect(fromCents(5).toFixed(2)).toBe('0.05');
      spy.mockRestore();
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
