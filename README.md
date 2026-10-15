# TabHop — Multi-Merchant Hospitality Commerce

Order drinks, cross-sell items from partner merchants, pay once via PayPal, split automatically.

## Architecture

Patron → [Express API] → [Postgres] ↔ [PayPal Orders + Payouts]

## Setup

1. brew install docker postgresql (if needed)
2. pnpm install
3. pnpm dev (starts Postgres and API)
4. In another terminal: pnpm db:seed

## Testing

- Unit: pnpm test
- Integration: pnpm test -- integration
- E2E: pnpm e2e

## Documentation

- API: docs/api/openapi.json
- Architecture: docs/decisions/
- Postman: docs/api/tabhop.postman_collection.json
