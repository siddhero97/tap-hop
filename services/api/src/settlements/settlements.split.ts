import { RecipientType, type SplitRow, type OrderWithItems } from '../orders/orders.model.js';
import { MerchantType } from '@tabhop/database';
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
export function computeSplit(order: OrderWithItems, vendorEmails: Map<string, string>): SplitRow[] {
  const rows: Map<string, SplitRow> = new Map();
  const venueEmail = vendorEmails.get(order.venueId) || 'venue@example.com';

  // Process line items
  for (const item of order.items) {
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
      const partnerEmail = vendorEmails.get(item.merchantId) || 'unknown@example.com';
      const partnerCents = Math.floor(item.lineCents * (1 - item.commissionRate));
      const venueCut = item.lineCents - partnerCents;

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
      const staffKey = `staff-${order.serverStaffId}`;
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

  // Verify invariant
  const splitArray = Array.from(rows.values());
  const splitSum = splitArray.reduce((sum, row) => sum + row.amountCents, 0);
  const expectedSum = order.totalCents - order.platformFeeCents;
  assertCentInvariant(splitSum, expectedSum, `order ${order.id}`);

  return splitArray;
}

function addOrAccumulate(rows: Map<string, SplitRow>, key: string, row: SplitRow): void {
  const existing = rows.get(key);
  if (existing) {
    existing.amountCents += row.amountCents;
  } else {
    rows.set(key, { ...row });
  }
}
