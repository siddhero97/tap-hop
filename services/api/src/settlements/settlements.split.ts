import { RecipientType, type SplitRow, type OrderWithItems } from '../orders/orders.model.js';
import { MerchantType } from '@tabhop/database';
import type { Email } from '../lib/email.js';
import { assertCentInvariant } from '../lib/money.js';

/**
 * Compute split of order amount across venue, partners, staff, platform.
 * All calculations in integer cents.
 *
 * Rules:
 * 1. Venue items: 100% to venue
 * 2. Partner items: partner gets floor(amount × (1 - rate)), venue gets remainder
 * 3. Tip: to staff email if present, else to venue
 * 4. Tax: to venue
 * 5. Platform fee: retained (no payout row)
 * Invariant: sum of rows === (totalCents - platformFeeCents)
 */
export function computeSplit(order: OrderWithItems, vendorEmails: Map<string, Email>): SplitRow[] {
  if (
    order.subtotalCents < 0 ||
    order.taxCents < 0 ||
    order.tipCents < 0 ||
    order.platformFeeCents < 0 ||
    order.totalCents < 0
  ) {
    throw new Error(`Order amounts cannot be negative for order ${order.id}`);
  }

  const rows: Map<string, SplitRow> = new Map();
  const venueEmail: Email = vendorEmails.get(order.venueId) || 'venue@example.com';

  // Process line items
  for (const item of order.items) {
    if (item.lineCents < 0) {
      throw new Error(`Item lineCents cannot be negative for order ${order.id}`);
    }
    if (item.commissionRate < 0 || item.commissionRate > 1) {
      throw new Error(`Commission rate must be between 0 and 1 for order ${order.id}`);
    }

    if (item.merchantType === MerchantType.PRIMARY_VENUE) {
      // Venue item: 100% to venue
      addOrAccumulate(rows, `venue-${order.venueId}`, {
        recipientType: RecipientType.PRIMARY_VENUE,
        merchantId: order.venueId,
        receiverEmail: venueEmail,
        amountCents: item.lineCents,
      });
    } else {
      // Partner item: split between partner and venue
      const partnerEmail: Email = vendorEmails.get(item.merchantId) || 'unknown@example.com';
      const partnerCents: number = Math.floor(item.lineCents * (1 - item.commissionRate));
      const venueCut: number = item.lineCents - partnerCents;

      addOrAccumulate(rows, `partner-${item.merchantId}`, {
        recipientType: RecipientType.PARTNER_MERCHANT,
        merchantId: item.merchantId,
        receiverEmail: partnerEmail,
        amountCents: partnerCents,
      });

      addOrAccumulate(rows, `venue-${order.venueId}`, {
        recipientType: RecipientType.PRIMARY_VENUE,
        merchantId: order.venueId,
        receiverEmail: venueEmail,
        amountCents: venueCut,
      });
    }
  }

  // Add tax to venue
  addOrAccumulate(rows, `venue-${order.venueId}`, {
    recipientType: RecipientType.PRIMARY_VENUE,
    merchantId: order.venueId,
    receiverEmail: venueEmail,
    amountCents: order.taxCents,
  });

  // Add tip
  if (order.tipCents > 0) {
    if (order.serverStaffId) {
      const staffKey: string = `staff-${order.serverStaffId}`;
      rows.set(staffKey, {
        recipientType: RecipientType.STAFF_TIP,
        staffId: order.serverStaffId,
        receiverEmail: vendorEmails.get(order.serverStaffId) || 'staff@example.com',
        amountCents: order.tipCents,
      });
    } else {
      addOrAccumulate(rows, `venue-${order.venueId}`, {
        recipientType: RecipientType.PRIMARY_VENUE,
        merchantId: order.venueId,
        receiverEmail: venueEmail,
        amountCents: order.tipCents,
      });
    }
  }

  // Verify no stakeholder (including platform retained share) receives a negative amount
  const splitArray: SplitRow[] = Array.from(rows.values());
  const splitSum: number = splitArray.reduce((sum, row) => sum + row.amountCents, 0);
  const platformShareCents: number = order.totalCents - splitSum;
  if (platformShareCents < 0) {
    throw new Error(
      `Stakeholder share cannot be negative for order ${order.id}: platform share is ${platformShareCents} cents`
    );
  }

  // Verify invariant
  const expectedSum: number = order.totalCents - order.platformFeeCents;
  assertCentInvariant(splitSum, expectedSum, `order ${order.id}`);

  return splitArray;
}

function addOrAccumulate(rows: Map<string, SplitRow>, key: string, row: SplitRow): void {
  const existing: SplitRow | undefined = rows.get(key);
  if (existing) {
    existing.amountCents += row.amountCents;
  } else {
    rows.set(key, { ...row });
  }
}
