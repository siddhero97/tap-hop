# ADR 0002: PayPal Gateway Interface with Pluggable Implementations

**Date:** 2026-10-14

**Status:** Accepted

## Context

TabHop needs to integrate with PayPal for payment processing, but the platform may eventually support multiple payment gateways (Stripe, Square, etc.). The code must allow for:

1. Easy swapping between real PayPal (API) and fake PayPal (testing)
2. Potential future support for other gateways
3. Isolation of payment logic from business logic
4. Testability without hitting real PayPal APIs in tests

The gateway is selected at runtime based on the `PAYPAL_MODE` environment variable:
- `fake`: Uses a stubbed implementation for development and testing
- `sandbox`: Calls PayPal's sandbox API
- `production`: Calls PayPal's production API

## Decision

Implement a **gateway interface** pattern with pluggable implementations:

```
src/payments/payments.gateway.ts          # Interface definition
src/payments/payments.fake-gateway.ts     # Test/dev implementation
src/payments/payments.rest-gateway.ts     # Real PayPal API implementation
src/payments/payments.controller.ts       # Uses interface, not implementation
```

The controller depends only on the interface and receives the correct implementation via initialization code (not dependency injection, to keep complexity low).

## Consequences

**Positive:**
- Easy to test without hitting PayPal APIs
- `PAYPAL_MODE=fake` works with hardcoded data, perfect for development
- Simple to add new gateways later
- Business logic doesn't care how payments are processed

**Negative:**
- Requires maintaining two implementations
- Must keep interface and implementations in sync

## Verification

- `PAYPAL_MODE=fake` in tests prevents accidental API calls
- Tests pass without network access
- Each gateway implementation has its own test file
