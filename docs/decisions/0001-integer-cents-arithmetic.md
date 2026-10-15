# ADR 0001: Integer Cents Arithmetic for Money

**Date:** 2026-10-14

**Status:** Accepted

## Context

Money handling in payment systems requires extreme precision. Floating-point arithmetic is inherently imprecise and can lead to rounding errors that accumulate across transactions. For a payment platform handling many transactions, even small rounding errors become a significant liability.

The TabHop platform needs to handle multiple currencies, calculate taxes (8% TAX_RATE_BPS), platform fees (5% PLATFORM_FEE_BPS), tips, and ensure that all amounts reconcile perfectly at settlement time.

## Decision

We represent all monetary amounts internally as **integers in cents**, never as floating-point numbers. This means:

- Database columns store amounts as NUMERIC/DECIMAL types (never FLOAT/DOUBLE)
- All calculations happen on integers
- API responses expose amounts as `*Cents` fields (e.g., `subtotalCents`, `taxCents`)
- When receiving decimals from external APIs (PayPal, etc.), we convert immediately to cents using `Math.round()`

Example flow:
```
Order subtotal: $100.00 → 10000 cents
Tax (8%): 10000 * 0.08 = 800 cents → $8.00
Platform fee (5%): 10000 * 0.05 = 500 cents → $5.00
Total: 10000 + 800 + 500 = 11300 cents → $113.00
```

## Consequences

**Positive:**
- No floating-point rounding errors
- Exact reconciliation at settlement time
- Industry-standard approach (used by Stripe, Square, etc.)
- Audit trail is precise and reproducible

**Negative:**
- Developers must always remember to work with cents, not dollars
- API clients must understand that amounts are in cents, not dollars
- Calculations require extra mental overhead

## Verification

All money handling tests use integer arithmetic. Database migrations use NUMERIC(19,2) for all amount columns to support 10+ digit precision.
