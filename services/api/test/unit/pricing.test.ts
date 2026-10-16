import { describe, it, expect } from 'vitest';
import { computeOrderTotal, pricingToDecimals } from '../../src/orders/orders.service';
import { Decimal } from '@prisma/client/runtime/library';

describe('pricing', () => {
  describe('computeOrderTotal', () => {
    it('computes total for simple order', () => {
      const result: { subtotalCents: number; taxCents: number; platformFeeCents: number; totalCents: number; } = computeOrderTotal({
        lineItems: [{ priceDecimal: new Decimal('19.99'), quantity: 1 }],
        taxRateBps: 800, // 8%
        platformFeeBps: 500, // 5%
      });
      expect(result.subtotalCents).toBe(1999);
      expect(result.taxCents).toBe(159); // floor(1999 * 0.08)
      expect(result.platformFeeCents).toBe(99); // floor(1999 * 0.05)
      expect(result.totalCents).toBe(1999 + 159 + 99);
    });

    it('handles multiple line items', () => {
      const result: { subtotalCents: number; taxCents: number; platformFeeCents: number; totalCents: number; } = computeOrderTotal({
        lineItems: [
          { priceDecimal: new Decimal('10.00'), quantity: 2 },
          { priceDecimal: new Decimal('5.50'), quantity: 1 },
        ],
        taxRateBps: 800,
        platformFeeBps: 500,
      });
      expect(result.subtotalCents).toBe(2550); // 2000 + 550
    });

    it('floors tax to avoid overcharge', () => {
      const result: { subtotalCents: number; taxCents: number; platformFeeCents: number; totalCents: number; } = computeOrderTotal({
        lineItems: [{ priceDecimal: new Decimal('0.01'), quantity: 1 }],
        taxRateBps: 800,
        platformFeeBps: 500,
      });
      expect(result.taxCents).toBe(0); // floor(1 * 0.08) = 0
    });

    it('rejects negative taxRateBps or platformFeeBps', () => {
      expect(() =>
        computeOrderTotal({
          lineItems: [{ priceDecimal: new Decimal('10.00'), quantity: 1 }],
          taxRateBps: -100,
          platformFeeBps: 500,
        })
      ).toThrow('Tax rate and platform fee basis points cannot be negative');

      expect(() =>
        computeOrderTotal({
          lineItems: [{ priceDecimal: new Decimal('10.00'), quantity: 1 }],
          taxRateBps: 800,
          platformFeeBps: -50,
        })
      ).toThrow('Tax rate and platform fee basis points cannot be negative');
    });

    it('rejects negative item price', () => {
      expect(() =>
        computeOrderTotal({
          lineItems: [{ priceDecimal: new Decimal('-10.00'), quantity: 1 }],
          taxRateBps: 800,
          platformFeeBps: 500,
        })
      ).toThrow('Line item price cannot be negative');
    });

    it('rejects negative, zero, or fractional quantity', () => {
      expect(() =>
        computeOrderTotal({
          lineItems: [{ priceDecimal: new Decimal('10.00'), quantity: -2 }],
          taxRateBps: 800,
          platformFeeBps: 500,
        })
      ).toThrow('Line item quantity must be a positive integer');

      expect(() =>
        computeOrderTotal({
          lineItems: [{ priceDecimal: new Decimal('10.00'), quantity: 0 }],
          taxRateBps: 800,
          platformFeeBps: 500,
        })
      ).toThrow('Line item quantity must be a positive integer');

      expect(() =>
        computeOrderTotal({
          lineItems: [{ priceDecimal: new Decimal('10.00'), quantity: 1.5 }],
          taxRateBps: 800,
          platformFeeBps: 500,
        })
      ).toThrow('Line item quantity must be a positive integer');
    });
  });

  describe('pricingToDecimals', () => {
    it('converts cents to Decimal', () => {
      const pricing: { subtotalCents: number; taxCents: number; platformFeeCents: number; totalCents: number; } = {
        subtotalCents: 1999,
        taxCents: 159,
        platformFeeCents: 99,
        totalCents: 2257,
      };
      const result: { subtotalAmount: Decimal; taxAmount: Decimal; platformFeeAmount: Decimal; totalAmount: Decimal; } = pricingToDecimals(pricing);
      expect(result.subtotalAmount.toFixed(2)).toBe('19.99');
      expect(result.taxAmount.toFixed(2)).toBe('1.59');
      expect(result.totalAmount.toFixed(2)).toBe('22.57');
    });

    it('rejects negative pricing fields', () => {
      expect(() =>
        pricingToDecimals({
          subtotalCents: -100,
          taxCents: 0,
          platformFeeCents: 0,
          totalCents: 0,
        })
      ).toThrow('Order pricing amounts cannot be negative');

      expect(() =>
        pricingToDecimals({
          subtotalCents: 100,
          taxCents: -10,
          platformFeeCents: 0,
          totalCents: 90,
        })
      ).toThrow('Order pricing amounts cannot be negative');

      expect(() =>
        pricingToDecimals({
          subtotalCents: 100,
          taxCents: 0,
          platformFeeCents: -5,
          totalCents: 95,
        })
      ).toThrow('Order pricing amounts cannot be negative');

      expect(() =>
        pricingToDecimals({
          subtotalCents: 100,
          taxCents: 0,
          platformFeeCents: 0,
          totalCents: -100,
        })
      ).toThrow('Order pricing amounts cannot be negative');
    });
  });
});
