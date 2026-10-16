import { describe, it, expect, vi } from 'vitest';

// Mock @tabhop/database before importing modules that use it
vi.mock('@tabhop/database', () => ({
  MerchantType: {
    PRIMARY_VENUE: 'PRIMARY_VENUE',
    EXTERNAL_PARTNER: 'EXTERNAL_PARTNER',
  },
}));

import { computeSplit } from '../../src/settlements/settlements.split';
import { RecipientType, type OrderWithItems, type SplitRow } from '../../src/orders/orders.model';

describe('settlement split', () => {
  describe('computeSplit', () => {
    it('handles venue-only order with tax', () => {
      const order: OrderWithItems = {
        id: 'order-1',
        venueId: 'venue-1',
        subtotalCents: 1000, // $10.00
        taxCents: 80, // $0.80
        tipCents: 0,
        platformFeeCents: 50, // $0.50
        totalCents: 1130,
        items: [
          {
            merchantId: 'venue-1',
            merchantType: 'PRIMARY_VENUE',
            commissionRate: 0,
            lineCents: 1000,
          },
        ],
      };

      const vendorEmails: Map<string, string> = new Map([['venue-1', 'venue@example.com']]);
      const result: SplitRow[] = computeSplit(order, vendorEmails);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        recipientType: RecipientType.PRIMARY_VENUE,
        merchantId: 'venue-1',
        receiverEmail: 'venue@example.com',
        amountCents: 1080, // 1000 + 80 tax
      });

      // Invariant: sum should equal total - platformFee
      const sum: number = result.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(order.totalCents - order.platformFeeCents);
    });

    it('handles venue + partner with commission split', () => {
      const order: OrderWithItems = {
        id: 'order-2',
        venueId: 'venue-1',
        subtotalCents: 2000, // $20.00
        taxCents: 160, // $1.60
        tipCents: 0,
        platformFeeCents: 100, // $1.00
        totalCents: 2260,
        items: [
          {
            merchantId: 'venue-1',
            merchantType: 'PRIMARY_VENUE',
            commissionRate: 0,
            lineCents: 1000, // $10.00
          },
          {
            merchantId: 'partner-1',
            merchantType: 'EXTERNAL_PARTNER',
            commissionRate: 0.1, // 10% commission to venue
            lineCents: 1000, // $10.00
          },
        ],
      };

      const vendorEmails: Map<string, string> = new Map([
        ['venue-1', 'venue@example.com'],
        ['partner-1', 'partner@example.com'],
      ]);
      const result: SplitRow[] = computeSplit(order, vendorEmails);

      // Should have venue and partner rows
      expect(result).toHaveLength(2);

      const venueRow: SplitRow | undefined = result.find(r => r.merchantId === 'venue-1');
      const partnerRow: SplitRow | undefined = result.find(r => r.merchantId === 'partner-1');

      expect(venueRow).toBeDefined();
      expect(partnerRow).toBeDefined();

      // Partner gets 90% of their line: floor(1000 * 0.9) = 900
      expect(partnerRow?.amountCents).toBe(900);
      // Venue gets: their line (1000) + commission from partner (100) + tax (160) = 1260
      expect(venueRow?.amountCents).toBe(1260);

      // Invariant check
      const sum: number = result.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(order.totalCents - order.platformFeeCents);
    });

    it('handles tip with staff assigned', () => {
      const order: OrderWithItems = {
        id: 'order-3',
        venueId: 'venue-1',
        serverStaffId: 'staff-1',
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 200, // $2.00 tip
        platformFeeCents: 50,
        totalCents: 1330,
        items: [
          {
            merchantId: 'venue-1',
            merchantType: 'PRIMARY_VENUE',
            commissionRate: 0,
            lineCents: 1000,
          },
        ],
      };

      const vendorEmails: Map<string, string> = new Map([
        ['venue-1', 'venue@example.com'],
        ['staff-1', 'staff@example.com'],
      ]);
      const result: SplitRow[] = computeSplit(order, vendorEmails);

      // Should have venue and staff rows
      expect(result).toHaveLength(2);

      const staffRow: SplitRow | undefined = result.find(r => r.staffId === 'staff-1');
      const venueRow: SplitRow | undefined = result.find(r => r.merchantId === 'venue-1');

      expect(staffRow).toEqual({
        recipientType: RecipientType.STAFF_TIP,
        staffId: 'staff-1',
        receiverEmail: 'staff@example.com',
        amountCents: 200,
      });

      expect(venueRow?.amountCents).toBe(1080); // 1000 + 80 tax

      // Invariant check
      const sum: number = result.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(order.totalCents - order.platformFeeCents);
    });

    it('handles tip without staff (goes to venue)', () => {
      const order: OrderWithItems = {
        id: 'order-4',
        venueId: 'venue-1',
        // No serverStaffId
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 200,
        platformFeeCents: 50,
        totalCents: 1330,
        items: [
          {
            merchantId: 'venue-1',
            merchantType: 'PRIMARY_VENUE',
            commissionRate: 0,
            lineCents: 1000,
          },
        ],
      };

      const vendorEmails: Map<string, string> = new Map([['venue-1', 'venue@example.com']]);
      const result: SplitRow[] = computeSplit(order, vendorEmails);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        recipientType: RecipientType.PRIMARY_VENUE,
        merchantId: 'venue-1',
        receiverEmail: 'venue@example.com',
        amountCents: 1280, // 1000 + 80 tax + 200 tip
      });

      // Invariant check
      const sum: number = result.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(order.totalCents - order.platformFeeCents);
    });

    it('handles multiple partners', () => {
      const order: OrderWithItems = {
        id: 'order-5',
        venueId: 'venue-1',
        subtotalCents: 3000, // $30.00
        taxCents: 240, // $2.40
        tipCents: 0,
        platformFeeCents: 150, // $1.50
        totalCents: 3390,
        items: [
          {
            merchantId: 'partner-1',
            merchantType: 'EXTERNAL_PARTNER',
            commissionRate: 0.15, // 15% commission
            lineCents: 1500, // $15.00
          },
          {
            merchantId: 'partner-2',
            merchantType: 'EXTERNAL_PARTNER',
            commissionRate: 0.2, // 20% commission
            lineCents: 1500, // $15.00
          },
        ],
      };

      const vendorEmails: Map<string, string> = new Map([
        ['venue-1', 'venue@example.com'],
        ['partner-1', 'partner1@example.com'],
        ['partner-2', 'partner2@example.com'],
      ]);
      const result: SplitRow[] = computeSplit(order, vendorEmails);

      // Should have venue and 2 partners
      expect(result).toHaveLength(3);

      const partner1: SplitRow | undefined = result.find(r => r.merchantId === 'partner-1');
      const partner2: SplitRow | undefined = result.find(r => r.merchantId === 'partner-2');
      const venue: SplitRow | undefined = result.find(r => r.merchantId === 'venue-1');

      // Partner 1: floor(1500 * 0.85) = 1275
      expect(partner1?.amountCents).toBe(1275);
      // Partner 2: floor(1500 * 0.8) = 1200
      expect(partner2?.amountCents).toBe(1200);
      // Venue: (1500 - 1275) + (1500 - 1200) + 240 tax = 225 + 300 + 240 = 765
      expect(venue?.amountCents).toBe(765);

      // Invariant check
      const sum: number = result.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(order.totalCents - order.platformFeeCents);
    });

    it('handles rounding edge case with small commission', () => {
      const order: OrderWithItems = {
        id: 'order-6',
        venueId: 'venue-1',
        subtotalCents: 333, // $3.33 - odd amount
        taxCents: 26, // floor(333 * 0.08)
        tipCents: 0,
        platformFeeCents: 16, // floor(333 * 0.05)
        totalCents: 375,
        items: [
          {
            merchantId: 'partner-1',
            merchantType: 'EXTERNAL_PARTNER',
            commissionRate: 0.33, // 33% commission
            lineCents: 333,
          },
        ],
      };

      const vendorEmails: Map<string, string> = new Map([
        ['venue-1', 'venue@example.com'],
        ['partner-1', 'partner@example.com'],
      ]);
      const result: SplitRow[] = computeSplit(order, vendorEmails);

      expect(result).toHaveLength(2);

      const partner: SplitRow | undefined = result.find(r => r.merchantId === 'partner-1');
      const venue: SplitRow | undefined = result.find(r => r.merchantId === 'venue-1');

      // Partner: floor(333 * 0.67) = floor(223.11) = 223
      expect(partner?.amountCents).toBe(223);
      // Venue: (333 - 223) + 26 tax = 110 + 26 = 136
      expect(venue?.amountCents).toBe(136);

      // Invariant check
      const sum: number = result.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(order.totalCents - order.platformFeeCents);
    });

    it('throws when invariant violated', () => {
      // Manually create a scenario where the invariant would fail
      // (in real usage, this shouldn't happen if input is valid)
      const order: OrderWithItems = {
        id: 'order-bad',
        venueId: 'venue-1',
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 0,
        platformFeeCents: 50,
        totalCents: 1200, // Intentionally wrong: should be 1130
        items: [
          {
            merchantId: 'venue-1',
            merchantType: 'PRIMARY_VENUE',
            commissionRate: 0,
            lineCents: 1000,
          },
        ],
      };

      const vendorEmails: Map<string, string> = new Map([['venue-1', 'venue@example.com']]);

      expect(() => computeSplit(order, vendorEmails)).toThrow(/Cent invariant/);
    });

    it('uses default email for missing vendors', () => {
      const order: OrderWithItems = {
        id: 'order-7',
        venueId: 'venue-1',
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 0,
        platformFeeCents: 50,
        totalCents: 1130,
        items: [
          {
            merchantId: 'venue-1',
            merchantType: 'PRIMARY_VENUE',
            commissionRate: 0,
            lineCents: 1000,
          },
        ],
      };

      // Empty vendor emails map
      const vendorEmails: Map<string, string> = new Map<string, string>();
      const result: SplitRow[] = computeSplit(order, vendorEmails);

      expect(result).toHaveLength(1);
      // Should use default email for missing venue
      expect(result[0].receiverEmail).toBe('venue@example.com');
    });

    it('uses default email for missing partner and staff vendors', () => {
      const order: OrderWithItems = {
        id: 'order-7b',
        venueId: 'venue-1',
        serverStaffId: 'staff-missing',
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 200,
        platformFeeCents: 50,
        totalCents: 1330,
        items: [
          {
            merchantId: 'partner-missing',
            merchantType: 'EXTERNAL_PARTNER',
            commissionRate: 0.1,
            lineCents: 1000,
          },
        ],
      };

      const vendorEmails: Map<string, string> = new Map<string, string>();
      const result: SplitRow[] = computeSplit(order, vendorEmails);

      const partnerRow: SplitRow | undefined = result.find(r => r.merchantId === 'partner-missing');
      const staffRow: SplitRow | undefined = result.find(r => r.staffId === 'staff-missing');
      const venueRow: SplitRow | undefined = result.find(r => r.merchantId === 'venue-1');

      expect(partnerRow?.receiverEmail).toBe('unknown@example.com');
      expect(staffRow?.receiverEmail).toBe('staff@example.com');
      expect(venueRow?.receiverEmail).toBe('venue@example.com');
    });

    it('accumulates splits for same recipient', () => {
      const order: OrderWithItems = {
        id: 'order-8',
        venueId: 'venue-1',
        subtotalCents: 2000,
        taxCents: 160,
        tipCents: 100,
        platformFeeCents: 100,
        totalCents: 2360,
        items: [
          {
            merchantId: 'venue-1',
            merchantType: 'PRIMARY_VENUE',
            commissionRate: 0,
            lineCents: 1000,
          },
          {
            merchantId: 'partner-1',
            merchantType: 'EXTERNAL_PARTNER',
            commissionRate: 0.1,
            lineCents: 1000,
          },
        ],
      };

      const vendorEmails: Map<string, string> = new Map([
        ['venue-1', 'venue@example.com'],
        ['partner-1', 'partner@example.com'],
      ]);
      const result: SplitRow[] = computeSplit(order, vendorEmails);

      // Should have 2 rows (venue accumulated, partner separate)
      expect(result).toHaveLength(2);

      const venue: SplitRow | undefined = result.find(r => r.merchantId === 'venue-1');
      // Venue should receive: 1000 (own item) + 100 (commission) + 160 (tax) + 100 (tip) = 1360
      expect(venue?.amountCents).toBe(1360);

      // Invariant check
      const sum: number = result.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(order.totalCents - order.platformFeeCents);
    });

    it('rejects negative order amounts (subtotal, tax, tip, platformFee, total)', () => {
      const baseOrder: OrderWithItems = {
        id: 'order-neg',
        venueId: 'venue-1',
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 0,
        platformFeeCents: 50,
        totalCents: 1130,
        items: [
          {
            merchantId: 'venue-1',
            merchantType: 'PRIMARY_VENUE',
            commissionRate: 0,
            lineCents: 1000,
          },
        ],
      };
      const vendorEmails: Map<string, string> = new Map([['venue-1', 'venue@example.com']]);

      expect(() =>
        computeSplit({ ...baseOrder, subtotalCents: -1000 }, vendorEmails)
      ).toThrow('Order amounts cannot be negative');

      expect(() =>
        computeSplit({ ...baseOrder, taxCents: -80 }, vendorEmails)
      ).toThrow('Order amounts cannot be negative');

      expect(() =>
        computeSplit({ ...baseOrder, tipCents: -50 }, vendorEmails)
      ).toThrow('Order amounts cannot be negative');

      expect(() =>
        computeSplit({ ...baseOrder, platformFeeCents: -10 }, vendorEmails)
      ).toThrow('Order amounts cannot be negative');

      expect(() =>
        computeSplit({ ...baseOrder, totalCents: -1130 }, vendorEmails)
      ).toThrow('Order amounts cannot be negative');
    });

    it('rejects negative item lineCents', () => {
      const order: OrderWithItems = {
        id: 'order-neg-item',
        venueId: 'venue-1',
        subtotalCents: 500,
        taxCents: 40,
        tipCents: 0,
        platformFeeCents: 25,
        totalCents: 565,
        items: [
          {
            merchantId: 'venue-1',
            merchantType: 'PRIMARY_VENUE',
            commissionRate: 0,
            lineCents: 1000,
          },
          {
            merchantId: 'partner-1',
            merchantType: 'EXTERNAL_PARTNER',
            commissionRate: 0.1,
            lineCents: -500,
          },
        ],
      };
      const vendorEmails: Map<string, string> = new Map([['venue-1', 'venue@example.com']]);

      expect(() => computeSplit(order, vendorEmails)).toThrow(
        'Item lineCents cannot be negative'
      );
    });

    it('rejects negative or >1 commissionRate', () => {
      const baseOrder: OrderWithItems = {
        id: 'order-bad-comm',
        venueId: 'venue-1',
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 0,
        platformFeeCents: 50,
        totalCents: 1130,
        items: [
          {
            merchantId: 'partner-1',
            merchantType: 'EXTERNAL_PARTNER',
            commissionRate: -0.1,
            lineCents: 1000,
          },
        ],
      };
      const vendorEmails: Map<string, string> = new Map([
        ['venue-1', 'venue@example.com'],
        ['partner-1', 'partner@example.com'],
      ]);

      expect(() => computeSplit(baseOrder, vendorEmails)).toThrow(
        'Commission rate must be between 0 and 1'
      );

      expect(() =>
        computeSplit(
          {
            ...baseOrder,
            items: [
              {
                merchantId: 'partner-1',
                merchantType: 'EXTERNAL_PARTNER',
                commissionRate: 1.25,
                lineCents: 1000,
              },
            ],
          },
          vendorEmails
        )
      ).toThrow('Commission rate must be between 0 and 1');
    });

    it('handles boundary commission rates (0% and 100%)', () => {
      const order: OrderWithItems = {
        id: 'order-boundary-comm',
        venueId: 'venue-1',
        subtotalCents: 2000,
        taxCents: 160,
        tipCents: 0,
        platformFeeCents: 100,
        totalCents: 2260,
        items: [
          {
            merchantId: 'partner-zero',
            merchantType: 'EXTERNAL_PARTNER',
            commissionRate: 0,
            lineCents: 1000,
          },
          {
            merchantId: 'partner-full',
            merchantType: 'EXTERNAL_PARTNER',
            commissionRate: 1,
            lineCents: 1000,
          },
        ],
      };
      const vendorEmails: Map<string, string> = new Map([
        ['venue-1', 'venue@example.com'],
        ['partner-zero', 'zero@example.com'],
        ['partner-full', 'full@example.com'],
      ]);

      const result: SplitRow[] = computeSplit(order, vendorEmails);
      const partnerZero: SplitRow | undefined = result.find(r => r.merchantId === 'partner-zero');
      const partnerFull: SplitRow | undefined = result.find(r => r.merchantId === 'partner-full');
      const venue: SplitRow | undefined = result.find(r => r.merchantId === 'venue-1');

      expect(partnerZero?.amountCents).toBe(1000);
      expect(partnerFull?.amountCents).toBe(0);
      expect(venue?.amountCents).toBe(1160); // 1000 commission + 160 tax
    });

    it('rejects order when platform stakeholder share would be negative (totalCents < splitSum)', () => {
      const order: OrderWithItems = {
        id: 'order-neg-platform-share',
        venueId: 'venue-1',
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 200,
        platformFeeCents: 50,
        totalCents: 900, // Less than splitSum (1280), making platform retained share -380 cents
        items: [
          {
            merchantId: 'venue-1',
            merchantType: 'PRIMARY_VENUE',
            commissionRate: 0,
            lineCents: 1000,
          },
        ],
      };
      const vendorEmails: Map<string, string> = new Map([['venue-1', 'venue@example.com']]);

      expect(() => computeSplit(order, vendorEmails)).toThrow(
        'Stakeholder share cannot be negative for order order-neg-platform-share: platform share is -380 cents'
      );
    });

    it('guarantees no stakeholder (venue, partners, staff, or platform) ever receives a negative amount across diverse scenarios', () => {
      const scenarios: OrderWithItems[] = [
        // 1. All 4 stakeholders active (venue + 2 partners + staff tip + platform fee)
        {
          id: 'scenario-all-stakeholders',
          venueId: 'venue-1',
          serverStaffId: 'staff-1',
          subtotalCents: 2501,
          taxCents: 200,
          tipCents: 350,
          platformFeeCents: 125,
          totalCents: 3176,
          items: [
            {
              merchantId: 'venue-1',
              merchantType: 'PRIMARY_VENUE',
              commissionRate: 0,
              lineCents: 1000,
            },
            {
              merchantId: 'partner-1',
              merchantType: 'EXTERNAL_PARTNER',
              commissionRate: 0.15,
              lineCents: 1500,
            },
            {
              merchantId: 'partner-2',
              merchantType: 'EXTERNAL_PARTNER',
              commissionRate: 0.99, // 99% commission on 1 cent item -> floor(1 * 0.01) = 0 partner, 1 venue
              lineCents: 1,
            },
          ],
        },
        // 2. Zero tax, zero tip, zero platform fee, 100% partner commission
        {
          id: 'scenario-zero-edges',
          venueId: 'venue-1',
          subtotalCents: 500,
          taxCents: 0,
          tipCents: 0,
          platformFeeCents: 0,
          totalCents: 500,
          items: [
            {
              merchantId: 'partner-1',
              merchantType: 'EXTERNAL_PARTNER',
              commissionRate: 1,
              lineCents: 500,
            },
          ],
        },
        // 3. Zero commission (0%) partner-only order with no tax/tip (venue gets 0, partner gets 100%)
        {
          id: 'scenario-zero-venue-cut',
          venueId: 'venue-1',
          subtotalCents: 500,
          taxCents: 0,
          tipCents: 0,
          platformFeeCents: 25,
          totalCents: 525,
          items: [
            {
              merchantId: 'partner-1',
              merchantType: 'EXTERNAL_PARTNER',
              commissionRate: 0,
              lineCents: 500,
            },
          ],
        },
      ];

      const vendorEmails: Map<string, string> = new Map([
        ['venue-1', 'venue@example.com'],
        ['partner-1', 'partner1@example.com'],
        ['partner-2', 'partner2@example.com'],
        ['staff-1', 'staff1@example.com'],
      ]);

      for (const order of scenarios) {
        const splitRows: SplitRow[] = computeSplit(order, vendorEmails);

        // Every payout stakeholder (PRIMARY_VENUE, PARTNER_MERCHANT, STAFF_TIP) must be >= 0
        for (const row of splitRows) {
          expect(row.amountCents).toBeGreaterThanOrEqual(0);
        }

        // Retained platform stakeholder share must also be >= 0
        const splitSum: number = splitRows.reduce((sum, r) => sum + r.amountCents, 0);
        const platformShareCents: number = order.totalCents - splitSum;
        expect(platformShareCents).toBeGreaterThanOrEqual(0);
        expect(platformShareCents).toBe(order.platformFeeCents);
      }
    });
  });
});
