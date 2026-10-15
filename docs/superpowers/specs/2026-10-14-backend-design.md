# TabHop Backend Design (Sub-project 1 of 4)

**Date:** 2026-10-14
**Status:** Draft for review
**Scope:** `services/api`, `packages/database`, `packages/types`, repo foundation, CI, Render deploy
**Out of scope:** AI pairing agent (sub-project 2), web dashboard (3), mobile app (4)

---

## 1. Purpose

TabHop lets a patron at a bar or restaurant order drinks, accept a cross-sold item from a
partner merchant (a bakery, an event venue, a ride voucher), and pay once through PayPal.
After capture, the platform splits the money across the host venue, the partner merchant,
and the serving staff member using the PayPal Payouts API, and keeps a platform fee.

This sub-project delivers the backend that every later piece (AI agent, dashboard, mobile)
calls. It must be demonstrable end to end on localhost with no PayPal credentials, and
switchable to the real PayPal sandbox with environment variables only.

### Success criteria

1. `pnpm e2e` boots the API in fake-PayPal mode against Dockerized Postgres and the Postman
   collection passes under Newman, exercising create → PayPal order → capture → settlement
   → webhook replay.
2. The same collection passes against the real PayPal sandbox when `PAYPAL_MODE=sandbox`
   and credentials are present.
3. Every payout batch's item amounts sum exactly to `total − platformFee`, verified by
   unit tests including rounding edge cases.
4. `docs/api/openapi.json` is generated from the Zod schemas, committed, and importable into
   Postman and APIMatic without edits.
5. `git log` reads as an ordered build narrative using Conventional Commits.

### Sponsor tools in scope

| Sponsor | Use |
|---|---|
| PayPal | Orders v2 (create, capture), Payouts v1, webhook signature verification |
| Postman | Collection + environment files committed; Newman is the e2e runner |
| APIMatic | Consumes the generated OpenAPI document (no code in this repo beyond the doc) |
| Render | `render.yaml` blueprint for API web service + managed Postgres |

---

## 2. Repo foundation

`~/tap-hop/` is a pnpm workspace and a git repository.

```
tap-hop/
├── services/
│   └── api/                    # Express + TypeScript backend
│       ├── src/
│       │   ├── config/         # env.ts (Zod-validated environment)
│       │   ├── modules/
│       │   │   ├── catalog/    # menu queries (venue + partner items)
│       │   │   ├── orders/     # pricing, order lifecycle
│       │   │   ├── payments/   # PayPalGateway interface + REST and Fake impls
│       │   │   ├── settlements/# computeSplit, buildPayoutRequest, SettlementService
│       │   │   └── webhooks/   # PayPal webhook receiver + reconciliation
│       │   ├── middleware/     # requestId, errorHandler, validate(schema)
│       │   ├── lib/            # money.ts (cents helpers), logger.ts (pino)
│       │   ├── app.ts          # builds the Express app (no listen) for tests
│       │   └── server.ts       # listens
│       ├── test/
│       │   ├── unit/
│       │   └── integration/
│       └── README.md
├── packages/
│   ├── database/               # Prisma schema, migrations, seed
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/seed.ts
│   │   └── src/index.ts        # exports PrismaClient singleton
│   └── types/                  # Zod schemas + inferred TS types + OpenAPI registry
│       └── src/
├── docs/
│   ├── api/
│   │   ├── openapi.json                      # generated, committed
│   │   ├── tabhop.postman_collection.json
│   │   ├── tabhop.local.postman_environment.json
│   │   └── tabhop.sandbox.postman_environment.json
│   ├── decisions/              # ADRs, numbered
│   ├── runbooks/
│   └── superpowers/specs/      # this file
├── .github/workflows/ci.yml
├── docker-compose.yml          # postgres:16
├── render.yaml
├── .env.example
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

### Tooling

- Node 20, pnpm 10, TypeScript 5 strict, ESM.
- `tsx` for dev server, `tsup` for build.
- Vitest for unit and integration tests, Supertest for HTTP-level tests.
- Newman (Postman CLI) for e2e.
- ESLint (typescript-eslint) + Prettier.
- Prisma 6 with PostgreSQL 16.
- pino for structured logging.
- Docker Desktop must be running for Postgres locally.

Root scripts:

| Script | Does |
|---|---|
| `pnpm dev` | starts Postgres (compose) and the API with hot reload |
| `pnpm db:migrate` | `prisma migrate dev` |
| `pnpm db:seed` | seeds one venue, two partners, staff, items |
| `pnpm test` | unit + integration |
| `pnpm e2e` | boots API in fake mode, runs Newman, tears down |
| `pnpm openapi` | regenerates `docs/api/openapi.json` |
| `pnpm lint`, `pnpm typecheck` | as named |

---

## 3. Data model

Prisma schema. Differences from the pasted spec are called out as ADRs.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum MerchantType {
  PRIMARY_VENUE
  EXTERNAL_PARTNER
}

enum OrderStatus {
  PENDING      // created, priced, not yet sent to PayPal
  AUTHORIZED   // PayPal order created, awaiting patron approval + capture
  CAPTURED     // funds captured
  FAILED       // capture failed
  REFUNDED     // reserved for later
}

enum PayoutStatus {
  QUEUED
  PROCESSING
  COMPLETED
  FAILED
}

enum RecipientType {
  PRIMARY_VENUE
  PARTNER_MERCHANT
  STAFF_TIP
  PLATFORM_FEE   // reporting only; never produces a payout row
}

model Merchant {
  id              String        @id @default(uuid())
  businessName    String
  merchantType    MerchantType
  paypalEmail     String        // Payouts receiver (sandbox personal/business email)
  commissionRate  Decimal       @default(0.15) @db.Decimal(5, 4) // referral cut kept by host venue on partner items
  items           Item[]
  staff           Staff[]
  ordersAsVenue   Order[]       @relation("OrderVenue")
  payoutItems     PayoutBatchItem[]
  createdAt       DateTime      @default(now())
}

/// ADR-0001: a Staff record is required so tips have a Payouts receiver.
model Staff {
  id          String   @id @default(uuid())
  venueId     String
  venue       Merchant @relation(fields: [venueId], references: [id])
  displayName String
  paypalEmail String
  isActive    Boolean  @default(true)
  orders      Order[]
  payoutItems PayoutBatchItem[]
  createdAt   DateTime @default(now())
}

model Item {
  id          String    @id @default(uuid())
  merchantId  String
  merchant    Merchant  @relation(fields: [merchantId], references: [id])
  name        String
  description String
  price       Decimal   @db.Decimal(10, 2)
  category    String    // "cocktail" | "beer" | "dessert" | "ticket" | "ride"
  isActive    Boolean   @default(true)
  metadata    Json?     // flavour tags, pairing notes for the AI agent (sub-project 2)
  orderItems  OrderItem[]
}

/// ADR-0002: Order.venueId is a real relation; amounts are broken out for auditability.
model Order {
  id                String       @id @default(uuid())
  idempotencyKey    String?      @unique
  tableNumber       String?
  venueId           String
  venue             Merchant     @relation("OrderVenue", fields: [venueId], references: [id])
  serverStaffId     String?
  serverStaff       Staff?       @relation(fields: [serverStaffId], references: [id])
  paypalOrderId     String?      @unique
  paypalCaptureId   String?      @unique
  subtotalAmount    Decimal      @db.Decimal(10, 2)
  taxAmount         Decimal      @db.Decimal(10, 2)
  tipAmount         Decimal      @db.Decimal(10, 2) @default(0)
  platformFeeAmount Decimal      @db.Decimal(10, 2)
  totalAmount       Decimal      @db.Decimal(10, 2)
  currency          String       @default("USD")
  status            OrderStatus  @default(PENDING)
  items             OrderItem[]
  payoutBatch       PayoutBatch?
  capturedAt        DateTime?
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
}

model OrderItem {
  id          String   @id @default(uuid())
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id])
  itemId      String
  item        Item     @relation(fields: [itemId], references: [id])
  quantity    Int      @default(1)
  unitPrice   Decimal  @db.Decimal(10, 2)  // snapshot at order time
}

model PayoutBatch {
  id               String            @id @default(uuid())
  orderId          String            @unique
  order            Order             @relation(fields: [orderId], references: [id])
  paypalBatchId    String?           @unique
  status           PayoutStatus      @default(QUEUED)
  attempts         Int               @default(0)
  lastError        String?
  items            PayoutBatchItem[]
  dispatchedAt     DateTime?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
}

model PayoutBatchItem {
  id              String        @id @default(uuid())
  payoutBatchId   String
  payoutBatch     PayoutBatch   @relation(fields: [payoutBatchId], references: [id])
  merchantId      String?
  merchant        Merchant?     @relation(fields: [merchantId], references: [id])
  staffId         String?
  staff           Staff?        @relation(fields: [staffId], references: [id])
  recipientType   RecipientType
  receiverEmail   String
  amount          Decimal       @db.Decimal(10, 2)
  currency        String        @default("USD")
  senderItemId    String        @unique   // `${orderId}:${recipientType}:${n}` sent to PayPal
  status          PayoutStatus  @default(QUEUED)
}

/// ADR-0003: every inbound PayPal webhook is stored; eventId uniqueness makes replays no-ops.
model WebhookEvent {
  id          String   @id @default(uuid())
  provider    String   @default("paypal")
  eventId     String   @unique
  eventType   String
  payload     Json
  verified    Boolean
  processedAt DateTime?
  receivedAt  DateTime @default(now())
}
```

### Money rule

All arithmetic is done in **integer cents** (`number`, safe well below 2^53). `Decimal`
columns are converted at the database boundary via `lib/money.ts` (`toCents`, `fromCents`).
No `float`, no `parseFloat`, no `Decimal` arithmetic in business logic.

### Seed data

One venue ("The Copper Still", commission 15%), two partners ("Churro & Co." dessert,
"Rideline" ride vouchers), two staff, six venue items, four partner items. Seeded emails are
PayPal sandbox-style addresses so the same seed works against real sandbox once the accounts
exist.

---

## 4. Payments module

### Interface

```ts
export interface PayPalGateway {
  createOrder(input: { referenceId: string; amountCents: number; currency: string }): Promise<{ paypalOrderId: string; approveUrl: string }>;
  captureOrder(paypalOrderId: string): Promise<{ captureId: string; status: 'COMPLETED' | 'PENDING' | 'DECLINED'; amountCents: number }>;
  createPayoutBatch(req: PayoutBatchRequest): Promise<{ paypalBatchId: string; status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'DENIED' }>;
  verifyWebhook(headers: Record<string, string>, rawBody: string): Promise<boolean>;
}
```

### Implementations

- **`PayPalRestGateway`** (`PAYPAL_MODE=sandbox`). Uses `fetch` against
  `https://api-m.sandbox.paypal.com`. OAuth client-credentials token is cached in memory and
  refreshed 60 s before expiry or on a 401. Every mutating call sends
  `PayPal-Request-Id` derived from our ids so PayPal deduplicates retries. Endpoints:
  - `POST /v2/checkout/orders` with `intent: CAPTURE`, one purchase unit, `reference_id = orderId`
  - `POST /v2/checkout/orders/{id}/capture`
  - `POST /v1/payments/payouts` with `sender_batch_id = orderId`
  - `POST /v1/notifications/verify-webhook-signature` using `PAYPAL_WEBHOOK_ID`
- **`FakePayPalGateway`** (`PAYPAL_MODE=fake`). In-memory. Returns deterministic ids
  (`FAKE-ORDER-<n>`, `FAKE-CAPTURE-<n>`, `FAKE-BATCH-<n>`), records every call for
  assertions, and exposes `failNext('captureOrder')` so tests can exercise failure paths.
  `verifyWebhook` returns true when the header `x-fake-signature: ok` is present.

The gateway is constructed once in `app.ts` from env and injected into services. No module
imports a concrete gateway directly.

### Environment (validated at boot with Zod; boot fails fast on any error)

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | development / test / production |
| `PORT` | no | default 4000 |
| `DATABASE_URL` | yes | Postgres connection string |
| `PAYPAL_MODE` | yes | `fake` or `sandbox` |
| `PAYPAL_CLIENT_ID` | if sandbox | |
| `PAYPAL_CLIENT_SECRET` | if sandbox | |
| `PAYPAL_WEBHOOK_ID` | if sandbox | from developer dashboard after registering the URL |
| `PLATFORM_FEE_BPS` | no | basis points, default 500 (5%) |
| `TAX_RATE_BPS` | no | basis points, default 800 (8%) |
| `LOG_LEVEL` | no | default info |

---

## 5. Order and payment flow

```
Client                         API                                  PayPal
  │  POST /orders                │                                     │
  │─────────────────────────────▶│ price lines from DB, compute        │
  │  201 {order, status:PENDING} │ tax/fee/total in cents, persist     │
  │◀─────────────────────────────│                                     │
  │  POST /orders/:id/paypal     │                                     │
  │─────────────────────────────▶│  POST /v2/checkout/orders ─────────▶│
  │  200 {paypalOrderId,approveUrl}  status → AUTHORIZED               │
  │◀─────────────────────────────│◀────────────────────────────────────│
  │  (patron approves in PayPal sheet)                                 │
  │  POST /orders/:id/capture    │                                     │
  │─────────────────────────────▶│  POST /v2/.../capture ─────────────▶│
  │                              │  status → CAPTURED, capturedAt      │
  │                              │  SettlementService.dispatch(id)     │
  │                              │  POST /v1/payments/payouts ────────▶│
  │  200 {order, payoutBatch}    │                                     │
  │◀─────────────────────────────│                                     │
  │                              │◀── POST /webhooks/paypal ───────────│
  │                              │  verify, store WebhookEvent,        │
  │                              │  reconcile (idempotent)             │
```

### State transitions (enforced in `orders/service.ts`)

| From | Action | To |
|---|---|---|
| PENDING | create PayPal order | AUTHORIZED |
| AUTHORIZED | capture succeeds | CAPTURED |
| AUTHORIZED | capture declined | FAILED |
| CAPTURED | (terminal for this sub-project) | |

Any other transition returns `409 ORDER_INVALID_TRANSITION`.

### Settlement on capture

Settlement is dispatched synchronously inside the capture request. If dispatch throws, the
order remains `CAPTURED`, the batch is stored with `status = FAILED` and `lastError`, and the
capture response still returns 200 with the batch status visible. Operators retry with
`POST /settlements/:orderId/retry`. Captured funds are never lost by a settlement failure.

### Webhook reconciliation

Handler for `POST /webhooks/paypal`:
1. Read raw body (needed for signature verification). Verify via gateway. Unverified → 400,
   stored with `verified = false`.
2. Insert `WebhookEvent` with PayPal's `id` as `eventId`. Unique violation → 200 (replay).
3. On `PAYMENT.CAPTURE.COMPLETED`: look up order by `paypalOrderId` from
   `resource.supplementary_data.related_ids.order_id`. If not `CAPTURED`, mark captured and
   dispatch settlement. If already `CAPTURED` with a batch, no-op.
4. On `PAYMENT.PAYOUTSBATCH.SUCCESS` / `.DENIED`: update `PayoutBatch.status`.
5. Mark `processedAt`. Always return 200 after step 2 so PayPal stops retrying.

---

## 6. Settlement split engine

### `computeSplit(order): SplitLine[]` (pure)

Input: order with lines, each line carrying `merchantId`, `merchantType`, `commissionRate`,
`unitPriceCents`, `quantity`; plus `tipCents`, `taxCents`, `platformFeeCents`, venue
`paypalEmail`, optional staff `paypalEmail`.

Rules (all cents, integer math):

1. **Venue items** → 100% to `PRIMARY_VENUE`.
2. **Partner items** → `partnerCents = floor(lineCents × (1 − commissionRate))` to
   `PARTNER_MERCHANT`; `lineCents − partnerCents` to `PRIMARY_VENUE`. One row per partner
   merchant, summed across its lines.
3. **Tip** → `STAFF_TIP` to the assigned staff's email. No staff → added to the venue row.
4. **Tax** → added to the venue row (venue remits).
5. **Platform fee** → no row. `platformFeeCents = floor(subtotalCents × PLATFORM_FEE_BPS / 10000)`,
   computed at order creation and stored on the order.
6. **Invariant:** `sum(rows) === totalCents − platformFeeCents`. Any rounding drift (only
   possible from step 2's floor) is already absorbed into the venue row by construction.
   The function asserts the invariant and throws if violated.

Rows with `amountCents === 0` are dropped (PayPal rejects zero-value items).

### Worked example

Order: Mezcal cocktail $15.00 (venue), churros $10.00 (partner, 15%), tip $4.00, tax 8%
on $25.00 subtotal = $2.00, platform fee 5% of $25.00 = $1.25, total $32.25.

| Recipient | Cents | Source |
|---|---|---|
| Venue | 1500 + 150 + 200 = 1850 | cocktail + referral cut + tax |
| Partner (Churro & Co.) | 850 | 1000 × 0.85 |
| Staff tip | 400 | |
| **Sum** | **3100** | = 3225 − 125 ✓ |

### `buildPayoutRequest(split, order): PayoutBatchRequest` (pure)

Maps rows to PayPal Payouts JSON: `sender_batch_header.sender_batch_id = order.id`,
`items[].recipient_type = "EMAIL"`, `items[].sender_item_id = senderItemId`,
`items[].amount = { value: fromCents(n), currency_code }`, `items[].note` human-readable.

### `SettlementService.dispatch(orderId)`

1. Load order (must be `CAPTURED`, else `409 ORDER_NOT_SETTLEABLE`).
2. If a `PayoutBatch` exists with status not `FAILED` → return it (idempotent).
3. In a transaction: upsert `PayoutBatch` (status `PROCESSING`, `attempts + 1`) and its items.
4. Call `gateway.createPayoutBatch`. On success store `paypalBatchId`, status per PayPal's
   response, `dispatchedAt`. On error store `FAILED` + `lastError` and rethrow a typed error.

---

## 7. API surface

Base path `/api/v1`. JSON only. All request bodies validated by Zod schemas from
`packages/types`; validation failures return `400 VALIDATION_ERROR` with per-field details.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/health` | | `{ status, db: ok/fail, paypal: ok/fail/skipped }` |
| GET | `/venues/:venueId/menu` | | `{ venue, items: Item[], partnerItems: Item[] }` |
| POST | `/orders` | `{ venueId, tableNumber?, serverStaffId?, lines: [{itemId, quantity}], tipAmount?, idempotencyKey? }` | `201 Order` |
| GET | `/orders/:id` | | `Order` incl. lines, amounts, status, payoutBatch? |
| POST | `/orders/:id/paypal` | | `{ paypalOrderId, approveUrl }` |
| POST | `/orders/:id/capture` | | `{ order, payoutBatch }` |
| POST | `/settlements/:orderId/retry` | | `PayoutBatch` |
| GET | `/settlements` | query: `venueId?, status?, from?, to?, page?, pageSize?` | `{ rows: LedgerRow[], total }` |
| POST | `/webhooks/paypal` | raw PayPal event | `200 {}` |
| GET | `/openapi.json` | | OpenAPI 3.1 document |

`LedgerRow` is shaped for the AG Grid dashboard: `orderId, createdAt, venueName,
partnerNames[], totalAmount, venueAmount, partnerAmount, staffTipAmount, platformFeeAmount,
paypalBatchId, payoutStatus`.

Reserved for sub-project 2, present in OpenAPI as a stub: `POST /recommendations/pairings`.

### Error shape

```json
{ "code": "ORDER_INVALID_TRANSITION", "message": "Order is CAPTURED; cannot create PayPal order", "details": {} }
```

Codes: `VALIDATION_ERROR`, `NOT_FOUND`, `ORDER_INVALID_TRANSITION`, `ORDER_NOT_SETTLEABLE`,
`ITEM_INACTIVE`, `ITEM_WRONG_VENUE`, `PAYPAL_ERROR`, `WEBHOOK_UNVERIFIED`, `INTERNAL`.

Every response carries `x-request-id`. Logs are pino JSON with `requestId`, `orderId` where
known.

### Security posture for this sub-project

No authentication. Documented explicitly in the README as a known gap; auth is a cross-cutting
concern to design once the dashboard and mobile clients exist. Webhook endpoint is protected
by PayPal signature verification. Rate limiting is not included.

---

## 8. Testing

| Layer | Tool | Runs against | Covers |
|---|---|---|---|
| Unit | Vitest | nothing external | `computeSplit` (incl. rounding, zero tip, no staff, multiple partners), `buildPayoutRequest`, `money.ts`, env validation, OAuth token cache (mocked fetch) |
| Integration | Vitest + Supertest | real Postgres (Docker), `FakePayPalGateway` | every route: happy path, validation errors, state transitions, idempotency key, settlement retry, webhook replay, webhook unverified |
| E2E | Postman + Newman | API process in fake mode + Postgres | full story in one collection run with assertions on amounts and statuses |

Integration tests truncate tables between tests and run serially. CI provides Postgres as a
GitHub Actions service container.

The Postman collection has two environment files. `local` targets `http://localhost:4000` with
fake mode. `sandbox` targets the Render URL and expects real PayPal; the capture step in
sandbox mode requires a manually approved PayPal order, so that request carries a
pre-request script that pauses with instructions when `PAYPAL_MODE=sandbox`.

---

## 9. Documentation and commit conventions

- **Root `README.md`:** one-paragraph pitch, architecture diagram (ASCII), 5-minute setup,
  test commands, link map to all docs.
- **`services/api/README.md`:** module map, request lifecycle, env table, error codes, how to
  add a route.
- **`docs/decisions/NNNN-title.md`** (ADR format: Context, Decision, Consequences):
  - 0001 Staff model for tip payouts
  - 0002 Venue relation and broken-out order amounts
  - 0003 Store every webhook event
  - 0004 Integer cents everywhere
  - 0005 Synchronous settlement on capture with webhook fallback
  - 0006 Gateway interface with fake implementation
  - 0007 Express + Zod over Fastify
  - 0008 Platform fee retained, not paid out
- **`docs/runbooks/`:** `paypal-sandbox-setup.md`, `enable-payouts-sandbox.md`,
  `retry-failed-settlement.md`, `register-webhook.md`, `rotate-credentials.md`.
- Doc comments on every exported function, every Prisma model, every Zod schema.
- **Commits:** Conventional Commits (`feat:`, `test:`, `docs:`, `chore:`, `ci:`), one logical
  change each, in plan order, never squashed. Each commit message body says *why*.

---

## 10. CI and deploy

**`.github/workflows/ci.yml`** on push and PR: install → lint → typecheck → unit →
integration (Postgres service) → build → e2e (boot API in fake mode, Newman) → verify
`docs/api/openapi.json` is up to date (regenerate and `git diff --exit-code`).

**`render.yaml`:** one web service (`services/api`, Node 20, build `pnpm install && pnpm
build`, pre-deploy `pnpm db:migrate:deploy`, start `pnpm start`), one managed Postgres,
env vars declared with `sync: false` for secrets. Health check path `/api/v1/health`.

The Render URL becomes the PayPal webhook endpoint registered in the developer dashboard;
the resulting webhook id goes into `PAYPAL_WEBHOOK_ID`.

---

## 11. Risks and known constraints

- **Payouts in sandbox** requires the sandbox business account to have Payouts enabled and
  a funded balance. Covered in the runbook; the fake gateway keeps development unblocked.
- **PayPal approval step** can't be automated in Newman against real sandbox. The local
  collection run is the CI gate; the sandbox run is a manual pre-demo check.
- **No auth** in this sub-project. Called out in README.
- **Docker required** locally. Documented in setup.
- **Deprecated SDK:** `@paypal/checkout-server-sdk` from the pasted spec is not used.
  Direct REST keeps Orders and Payouts in one small client we fully control.

---

## 12. Out of scope (later sub-projects)

- AI pairing agent, Channel3 / Elastic catalog search (sub-project 2)
- AG Grid dashboard, Bryntum shift timeline, Zapier notifications (sub-project 3)
- Expo mobile app, PayPal native checkout sheet (sub-project 4)
- Refunds, partial captures, multi-currency, authentication, rate limiting
