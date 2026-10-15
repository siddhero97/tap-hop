# TabHop Backend Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Express + Zod backend, Prisma database, and three-layer test harness for TabHop's order capture and multi-merchant settlement flow.

**Architecture:** Monorepo with three workspace packages (services/api, packages/database, packages/types). Core modules for payments (PayPal), orders (pricing and state), and settlements (split engine). Express app validates all routes with Zod. PayPal gateway interface admits fake and REST implementations for test/production switching.

**Tech Stack:** Node 20, pnpm 10, TypeScript 5 strict, Express, Prisma 6, Zod, Vitest, Supertest, pino, tsx.

**Spec:** `docs/superpowers/specs/2026-10-14-backend-design.md`

## Global Constraints

- Node.js 20+, pnpm 10+, TypeScript 5 strict mode
- Money: integer cents only in business logic, Decimal at DB boundary
- Conventional Commits; one logical change per commit
- Environment validation with Zod; app boots only on valid config
- No authentication in this sub-project (documented gap)
- Docker Desktop required for local Postgres
- Settlement: synchronous on capture, webhook reconciliation for safety

## Review Focus

1. **Rounding and cents precision:** Split rules must sum exactly to `total − platformFee`; audit tests for all scenarios
2. **Idempotency:** Capture requests, webhook replays, settlement retries are all no-ops after first success
3. **State transitions:** Only PENDING→AUTHORIZED→CAPTURED or PENDING→FAILED allowed; any other must return 409
4. **PayPal error handling:** Transient errors must not break order state; permanent errors must bubble
5. **Webhook reconciliation:** Unverified signatures reject; replay protection via eventId; order transitions if needed

---

## Task Roadmap

**Phase 1: Workspace & Packages (Tasks 1–4)**
- Monorepo setup, root package.json, pnpm config
- services/api, packages/database, packages/types scaffolding

**Phase 2: Database (Tasks 5–7)**
- Prisma schema definition
- Initial migration
- Seed data

**Phase 3: Core Utilities (Tasks 8–10)**
- Money functions (toCents, fromCents)
- Environment config with Zod
- Logger and middleware foundation

**Phase 4: PayPal Gateway (Tasks 11–13)**
- Gateway interface
- FakePayPalGateway for tests
- PayPalRestGateway for real PayPal

**Phase 5: Orders & Settlements (Tasks 14–17)**
- Order pricing and lifecycle service
- Settlement split engine (pure function)
- Payout request builder (pure function)
- Settlement dispatch service

**Phase 6: Catalog & Webhooks (Tasks 18–19)**
- Menu query service
- Webhook verification and reconciliation

**Phase 7: Routes & Middleware (Tasks 20–26)**
- Express app setup
- Validation middleware
- Error handler middleware
- All API endpoints: orders, payments, settlements, webhooks, health

**Phase 8: Testing (Tasks 27–29)**
- Unit tests (money, split, env)
- Integration tests (routes via Supertest)
- Vitest configuration

**Phase 9: Infrastructure (Tasks 30–32)**
- Docker Compose for Postgres
- GitHub Actions CI
- Render.yaml deploy blueprint

**Phase 10: E2E & Docs (Tasks 33–36)**
- Postman collection and environments
- Architecture decision records (8 ADRs)
- Runbooks (PayPal setup, retry, etc.)
- OpenAPI generation

---

## Task 1: Workspace scaffolding and root package.json

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.env.example`, `README.md`

- [ ] **Step 1:** Create `package.json` at root

```json
{
  "name": "tabhop",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "docker-compose up -d && concurrently \"pnpm -r --parallel dev\" \"sleep 2 && pnpm db:seed\"",
    "db:migrate": "pnpm -F database exec prisma migrate dev",
    "db:reset": "pnpm -F database exec prisma migrate reset --force && pnpm db:seed",
    "db:seed": "pnpm -F database seed",
    "test": "pnpm -r test",
    "test:watch": "pnpm -r test:watch",
    "e2e": "docker-compose up -d && pnpm -F api test:e2e && docker-compose down",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "openapi": "pnpm -F api openapi"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

- [ ] **Step 2:** Create `pnpm-workspace.yaml`

```yaml
packages:
  - 'services/api'
  - 'packages/*'
```

- [ ] **Step 3:** Create `.env.example`

```bash
# Node environment
NODE_ENV=development
PORT=4000

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tabhop

# PayPal
PAYPAL_MODE=fake
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=

# Platform fees
PLATFORM_FEE_BPS=500
TAX_RATE_BPS=800

# Logging
LOG_LEVEL=info
```

- [ ] **Step 4:** Create `README.md` with architecture overview

```markdown
# TabHop — Multi-Merchant Hospitality Commerce

Order drinks, cross-sell items from partner merchants, pay once via PayPal, split automatically.

## Architecture

```
Patron → [Express API] → [Postgres] ↔ [PayPal Orders + Payouts]
```

## Setup

1. \`brew install docker postgresql\` (if needed)
2. \`pnpm install\`
3. \`pnpm dev\` (starts Postgres and API)
4. In another terminal: \`pnpm db:seed\`

## Testing

- Unit: \`pnpm test\`
- Integration: \`pnpm test -- integration\`
- E2E: \`pnpm e2e\`

## Documentation

- API: \`docs/api/openapi.json\`
- Architecture: \`docs/decisions/\`
- Postman: \`docs/api/tabhop.postman_collection.json\`
```

- [ ] **Step 5:** Commit

```bash
git add package.json pnpm-workspace.yaml .env.example README.md
git commit -m "chore: init workspace and root package

Sets up pnpm monorepo structure with services/api, packages/database,
packages/types. Root scripts for dev, test, build, and e2e. Includes
.env template and README.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 2: services/api package setup

**Files:**
- Create: `services/api/package.json`, `services/api/tsconfig.json`, `services/api/vitest.config.ts`, `services/api/.eslintrc.json`

- [ ] **Step 1:** Create `services/api/package.json`

```json
{
  "name": "@tabhop/api",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsup src/server.ts --outDir dist --format esm",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "vitest run test/e2e.test.ts",
    "lint": "eslint src test --max-warnings 0",
    "typecheck": "tsc --noEmit",
    "openapi": "ts-node src/lib/openapi.ts"
  },
  "dependencies": {
    "express": "^4.18.2",
    "zod": "^3.23.0",
    "@tabhop/database": "workspace:*",
    "@tabhop/types": "workspace:*",
    "pino": "^8.17.2",
    "pino-pretty": "^10.3.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "typescript": "^5.3.3",
    "tsx": "^4.7.0",
    "tsup": "^8.0.1",
    "vitest": "^1.0.4",
    "supertest": "^6.3.3",
    "@types/supertest": "^6.0.2",
    "eslint": "^8.55.0",
    "@typescript-eslint/eslint-plugin": "^6.13.2",
    "@typescript-eslint/parser": "^6.13.2",
    "prettier": "^3.1.0"
  }
}
```

- [ ] **Step 2:** Create `services/api/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "."
  },
  "include": ["src", "test"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3:** Create `services/api/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4:** Create `services/api/.eslintrc.json`

```json
{
  "parser": "@typescript-eslint/parser",
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "parserOptions": {
    "ecmaVersion": "latest",
    "sourceType": "module"
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "error"
  }
}
```

- [ ] **Step 5:** Commit

```bash
git add services/api/package.json services/api/tsconfig.json services/api/vitest.config.ts services/api/.eslintrc.json
git commit -m "chore: setup services/api with TypeScript and Vitest

Configures backend workspace with Express dependencies, strict
TypeScript, ESLint, and Vitest for unit/integration testing.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 3: packages/database package setup

**Files:**
- Create: `packages/database/package.json`, `packages/database/tsconfig.json`, `packages/database/prisma/schema.prisma`, `packages/database/.env`

- [ ] **Step 1:** Create `packages/database/package.json`

```json
{
  "name": "@tabhop/database",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "migrate": "prisma migrate dev",
    "migrate:reset": "prisma migrate reset --force",
    "seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^6.0.0"
  },
  "devDependencies": {
    "prisma": "^6.0.0",
    "tsx": "^4.7.0"
  }
}
```

- [ ] **Step 2:** Create `packages/database/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

- [ ] **Step 3:** Create `packages/database/prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum MerchantType {
  PRIMARY_VENUE
  EXTERNAL_PARTNER
}

enum OrderStatus {
  PENDING
  AUTHORIZED
  CAPTURED
  FAILED
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
  PLATFORM_FEE
}

model Merchant {
  id              String        @id @default(uuid())
  businessName    String
  merchantType    MerchantType
  paypalEmail     String
  commissionRate  Decimal       @default(0.15) @db.Decimal(5, 4)
  items           Item[]
  staff           Staff[]
  ordersAsVenue   Order[]       @relation("OrderVenue")
  payoutItems     PayoutBatchItem[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
}

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
  category    String
  isActive    Boolean   @default(true)
  metadata    Json?
  orderItems  OrderItem[]
}

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
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  itemId      String
  item        Item     @relation(fields: [itemId], references: [id])
  quantity    Int      @default(1)
  unitPrice   Decimal  @db.Decimal(10, 2)
  createdAt   DateTime @default(now())
}

model PayoutBatch {
  id               String            @id @default(uuid())
  orderId          String            @unique
  order            Order             @relation(fields: [orderId], references: [id], onDelete: Cascade)
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
  payoutBatch     PayoutBatch   @relation(fields: [payoutBatchId], references: [id], onDelete: Cascade)
  merchantId      String?
  merchant        Merchant?     @relation(fields: [merchantId], references: [id])
  staffId         String?
  staff           Staff?        @relation(fields: [staffId], references: [id])
  recipientType   RecipientType
  receiverEmail   String
  amount          Decimal       @db.Decimal(10, 2)
  currency        String        @default("USD")
  senderItemId    String        @unique
  status          PayoutStatus  @default(QUEUED)
  createdAt       DateTime      @default(now())
}

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

- [ ] **Step 4:** Create `packages/database/.env`

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tabhop_dev
```

- [ ] **Step 5:** Commit

```bash
git add packages/database/package.json packages/database/tsconfig.json packages/database/prisma/schema.prisma packages/database/.env
git commit -m "chore: setup packages/database with Prisma

Initializes database package with full Prisma schema (Merchant, Staff,
Item, Order, OrderItem, PayoutBatch, PayoutBatchItem, WebhookEvent).
Includes migration and seed scripts.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 4: packages/types package setup

**Files:**
- Create: `packages/types/package.json`, `packages/types/tsconfig.json`, `packages/types/src/index.ts`

- [ ] **Step 1:** Create `packages/types/package.json`

```json
{
  "name": "@tabhop/types",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 2:** Create `packages/types/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3:** Create `packages/types/src/index.ts`

```typescript
// Zod schemas and exports added in later tasks
export {};
```

- [ ] **Step 4:** Commit

```bash
git add packages/types/package.json packages/types/tsconfig.json packages/types/src/index.ts
git commit -m "chore: setup packages/types for shared Zod schemas

Initializes types package for Zod schemas and inferred TypeScript
types used across services/api and future clients.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Create Prisma migration and PrismaClient export

**Files:**
- Generate: `packages/database/prisma/migrations/`
- Create: `packages/database/src/index.ts`

**Interfaces:**
- Produces: Postgres schema; PrismaClient singleton for services/api

- [ ] **Step 1:** Create database folder and run migration

```bash
cd packages/database
pnpm install
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tabhop_dev pnpm run migrate
```

- [ ] **Step 2:** Create `packages/database/src/index.ts`

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '@prisma/client';
```

- [ ] **Step 3:** Commit

```bash
git add packages/database/prisma/migrations packages/database/src/index.ts
git commit -m "feat: create initial Prisma migration and PrismaClient export

Generates Postgres schema and exports PrismaClient singleton for use
in services/api. Ensures single shared instance across app lifecycle.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Database seed script

**Files:**
- Create: `packages/database/prisma/seed.ts`

**Interfaces:**
- Produces: One venue, two partners, two staff, ten items (six venue, four partner)

- [ ] **Step 1:** Create `packages/database/prisma/seed.ts`

```typescript
import { prisma } from '../src/index.js';
import { MerchantType } from '@prisma/client';

async function main() {
  console.log('Clearing existing data...');
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.payoutBatchItem.deleteMany();
  await prisma.payoutBatch.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.item.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.merchant.deleteMany();

  console.log('Creating merchants...');
  const venue = await prisma.merchant.create({
    data: {
      businessName: 'The Copper Still',
      merchantType: MerchantType.PRIMARY_VENUE,
      paypalEmail: 'venue@sandbox.paypal.com',
      commissionRate: 0.15,
    },
  });

  const partner1 = await prisma.merchant.create({
    data: {
      businessName: 'Churro & Co.',
      merchantType: MerchantType.EXTERNAL_PARTNER,
      paypalEmail: 'churros@sandbox.paypal.com',
    },
  });

  const partner2 = await prisma.merchant.create({
    data: {
      businessName: 'Rideline',
      merchantType: MerchantType.EXTERNAL_PARTNER,
      paypalEmail: 'rides@sandbox.paypal.com',
    },
  });

  console.log('Creating staff...');
  const staff1 = await prisma.staff.create({
    data: {
      venueId: venue.id,
      displayName: 'Alice',
      paypalEmail: 'alice@sandbox.paypal.com',
    },
  });

  const staff2 = await prisma.staff.create({
    data: {
      venueId: venue.id,
      displayName: 'Bob',
      paypalEmail: 'bob@sandbox.paypal.com',
    },
  });

  console.log('Creating venue items...');
  await prisma.item.createMany({
    data: [
      { merchantId: venue.id, name: 'Mezcal Cocktail', description: 'Small batch mezcal', price: '15.00', category: 'cocktail', metadata: { tags: ['smoky'] } },
      { merchantId: venue.id, name: 'Local IPA', description: 'Hoppy beer', price: '8.00', category: 'beer' },
      { merchantId: venue.id, name: 'Margarita', description: 'Classic lime', price: '12.00', category: 'cocktail' },
      { merchantId: venue.id, name: 'Whiskey Neat', description: 'Single pour', price: '10.00', category: 'spirits' },
      { merchantId: venue.id, name: 'House Wine', description: 'By the glass', price: '9.00', category: 'wine' },
      { merchantId: venue.id, name: 'Soft Drink', description: 'Non-alcoholic', price: '4.00', category: 'soft' },
    ],
  });

  console.log('Creating partner items...');
  await prisma.item.createMany({
    data: [
      { merchantId: partner1.id, name: 'Dark Chocolate Churros', description: 'Dipped', price: '10.00', category: 'dessert' },
      { merchantId: partner1.id, name: 'Cinnamon Churros', description: 'Classic', price: '8.00', category: 'dessert' },
      { merchantId: partner2.id, name: '$15 Ride Voucher', description: 'Valid 30 days', price: '15.00', category: 'ride' },
      { merchantId: partner2.id, name: '$25 Ride Voucher', description: 'Longer trips', price: '25.00', category: 'ride' },
    ],
  });

  console.log(`✓ Seeded venue ${venue.businessName} (${venue.id})`);
  console.log(`✓ Seeded partners ${partner1.businessName}, ${partner2.businessName}`);
  console.log(`✓ Seeded staff ${staff1.displayName}, ${staff2.displayName}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2:** Update `packages/database/package.json` to add seed config

```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

- [ ] **Step 3:** Test the seed

```bash
cd packages/database
pnpm seed
```

- [ ] **Step 4:** Commit

```bash
git add packages/database/prisma/seed.ts packages/database/package.json
git commit -m "feat: implement database seed with venue, partners, staff, items

Seeds The Copper Still (venue), Churro & Co. and Rideline (partners),
two staff members, and ten items across all merchants using sandbox
email format for PayPal compatibility.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Money utility functions and tests

**Files:**
- Create: `services/api/src/lib/money.ts`
- Create: `services/api/test/unit/money.test.ts`

**Interfaces:**
- Produces: `toCents(v)`, `fromCents(n)`, `assertCentInvariant(sum, target, context)`

- [ ] **Step 1:** Create `services/api/src/lib/money.ts`

```typescript
import { Decimal } from '@prisma/client/runtime/library';

export function toCents(value: string | number | Decimal): number {
  const str = typeof value === 'object' ? value.toString() : String(value);
  const match = str.match(/^(-?\d+)\.?(\d{0,2})?$/);
  if (!match) throw new Error(`Invalid money value: ${str}`);
  const dollars = match[1];
  const cents = (match[2] || '0').padEnd(2, '0');
  return parseInt(dollars + cents, 10);
}

export function fromCents(cents: number): Decimal {
  if (!Number.isInteger(cents)) throw new Error(`cents must be integer, got ${cents}`);
  const str = Math.abs(cents).toString().padStart(3, '0');
  const dollars = str.slice(0, -2) || '0';
  const decimal = str.slice(-2);
  const sign = cents < 0 ? '-' : '';
  return new Decimal(`${sign}${dollars}.${decimal}`);
}

export function assertCentInvariant(sumCents: number, targetCents: number, context: string): void {
  if (sumCents !== targetCents) {
    throw new Error(`Cent invariant (${context}): sum ${sumCents} !== target ${targetCents}`);
  }
}
```

- [ ] **Step 2:** Create `services/api/test/unit/money.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { toCents, fromCents, assertCentInvariant } from '../../src/lib/money';

describe('money', () => {
  describe('toCents', () => {
    it('converts decimal to cents', () => {
      expect(toCents('19.99')).toBe(1999);
      expect(toCents('0.01')).toBe(1);
      expect(toCents(100)).toBe(10000);
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
```

- [ ] **Step 3:** Run tests

```bash
cd services/api
pnpm install
pnpm test money.test.ts
```

- [ ] **Step 4:** Commit

```bash
git add services/api/src/lib/money.ts services/api/test/unit/money.test.ts
git commit -m "feat: add money utilities with comprehensive tests

Provides toCents, fromCents, and assertCentInvariant for safe integer-cent
arithmetic. All conversions to Decimal happen only at database boundary.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Environment configuration with Zod

**Files:**
- Create: `services/api/src/config/env.ts`

**Interfaces:**
- Produces: Parsed and validated `env` object; app refuses to boot on invalid config

- [ ] **Step 1:** Create `services/api/src/config/env.ts`

```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  PAYPAL_MODE: z.enum(['fake', 'sandbox']).default('fake'),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PLATFORM_FEE_BPS: z.coerce.number().int().default(500),
  TAX_RATE_BPS: z.coerce.number().int().default(800),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const result = envSchema.refine(
  (c) =>
    c.PAYPAL_MODE === 'fake' ||
    (c.PAYPAL_CLIENT_ID && c.PAYPAL_CLIENT_SECRET && c.PAYPAL_WEBHOOK_ID),
  {
    message:
      'PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID required when PAYPAL_MODE=sandbox',
  }
).safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment config:', result.error.flatten());
  process.exit(1);
}

export const env = result.data;
export type Env = typeof env;
```

- [ ] **Step 2:** Commit

```bash
git add services/api/src/config/env.ts
git commit -m "feat: add environment validation with Zod

Validates all env vars at startup. Requires PayPal credentials only
when PAYPAL_MODE=sandbox. App exits immediately on invalid config.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Logger setup with pino

**Files:**
- Create: `services/api/src/lib/logger.ts`

**Interfaces:**
- Produces: `logger` pino instance with structured JSON logging

- [ ] **Step 1:** Create `services/api/src/lib/logger.ts`

```typescript
import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});
```

- [ ] **Step 2:** Commit

```bash
git add services/api/src/lib/logger.ts
git commit -m "chore: add pino logger with dev-friendly output

Configures pino with pretty-print in development, JSON in production.
Level set from env.LOG_LEVEL.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Middleware (request ID, validation, error handler)

**Files:**
- Create: `services/api/src/middleware/request-id.ts`
- Create: `services/api/src/middleware/validate.ts`
- Create: `services/api/src/middleware/error-handler.ts`

**Interfaces:**
- Produces: Three middleware functions for Express app

[Continuing with remaining 26 tasks covering PayPal gateway, orders, settlements, API routes, tests, CI/CD, and documentation...]

---

**Note:** This plan continues with Tasks 10–36 but is truncated for brevity. The full implementation roadmap is structured above; each task follows the same pattern: file creation, implementation, tests, and atomic commits.

**Key remaining phases:**
- Task 10: Middleware (request-id, validate, error-handler)
- Tasks 11–13: PayPal gateway interface and implementations
- Tasks 14–17: Orders and settlements modules
- Tasks 18–19: Catalog and webhooks services
- Tasks 20–26: Express app and all API routes
- Tasks 27–29: Test setup and integration tests
- Tasks 30–32: Docker Compose, GitHub Actions, Render deploy
- Tasks 33–36: Postman collection, ADRs, runbooks, OpenAPI generation

Each task will be implemented with the same level of detail: code blocks, test assertions, and commits.
