# ADR 0003: Settlement Split Engine for Multi-Merchant Transactions

**Date:** 2026-10-14

**Status:** Accepted

## Context

A single order at a venue often involves items from multiple merchants (e.g., main kitchen, bar, dessert vendor). When the order is captured and settled:

1. The customer pays the total via PayPal (including tax and platform fees)
2. The total must be split among merchants according to their items
3. Each merchant receives their portion minus platform fees and taxes
4. The platform keeps platform fees
5. Tax goes to the appropriate parties (typically retained for remittance)

The split must be exact (to the cent) and deterministic, so settlements are always reproducible.

## Decision

Implement a **split engine** in `src/settlements/settlements.split.ts` that:

1. Takes an Order with multiple items from different merchants
2. Calculates each merchant's subtotal (sum of their items)
3. Distributes tax and platform fees proportionally
4. Creates a settlement ledger entry for each merchant
5. Batches settlements for PayPal payout API

Algorithm:
```
For each order:
  1. Calculate total: subtotal + tax + platform_fee + tip
  2. For each unique merchant in order items:
     - Sum their items (subtotal share)
     - Allocate platform fee: (subtotal_share / total) * platform_fee
     - Allocate tax: (subtotal_share / total) * tax
     - Settlement amount: subtotal_share - platform_fee - tax
  3. Create PayPal payout batch with all merchant settlements
  4. Tip goes to primary venue (host)
```

## Consequences

**Positive:**
- Exact settlement accounting
- Fair fee distribution to merchants
- Deterministic and reproducible (same order always produces same splits)
- Easy to add new fee types (commission, surcharges, etc.)

**Negative:**
- Complex logic that's easy to get wrong
- Requires thorough testing with multi-merchant scenarios
- Rounding must be handled carefully to avoid cent-level discrepancies

## Verification

Settlement tests include:
- Single merchant orders
- Multi-merchant orders
- Orders with multiple quantities per merchant
- Orders with different tip amounts
- Reconciliation tests (sum of all settlements = captured amount)
