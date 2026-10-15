# ADR 0004: Feature Directories with Semantic Suffixes

**Date:** 2026-10-14

**Status:** Accepted

## Context

As the TabHop API grows, it will have many features (orders, payments, settlements, refunds, reports, etc.). Code organization is crucial for maintainability. Options considered:

1. **By layer** (controllers/, services/, models/): Requires jumping between directories for a single feature
2. **By feature** (orders/, payments/): Keeps related code together but risks disorganization
3. **By feature with suffixes** (orders/orders.controller.ts, orders/orders.service.ts): Semantic file names that clarify intent

## Decision

Use **feature-based directories with consistent semantic suffixes**:

```
src/
  orders/
    orders.controller.ts         # Express routes and request handling
    orders.service.ts            # Business logic
    orders.model.ts              # TypeScript types and Prisma queries
    orders.validator.ts          # Zod validation schemas
    orders.routes.ts             # Express Router definition
    
  payments/
    payments.gateway.ts          # Interface definition
    payments.fake-gateway.ts     # Fake implementation
    payments.rest-gateway.ts     # Real API implementation
    payments.controller.ts       # Express routes
    payments.validator.ts        # Validation schemas
    payments.routes.ts           # Router definition
    
  settlements/
    settlements.service.ts       # Business logic
    settlements.split.ts         # Split engine (pure function)
    settlements.controller.ts    # Express routes
    settlements.routes.ts        # Router definition
```

**Suffix conventions:**
- `.controller.ts` - Express request handlers
- `.service.ts` - Business logic, orchestration
- `.model.ts` - Domain models, types, database queries
- `.validator.ts` - Zod schemas and validation
- `.routes.ts` - Express Router creation
- `.gateway.ts` - External API interface (payment, etc.)
- `*-gateway.ts` - Specific gateway implementation

## Consequences

**Positive:**
- All code for a feature is in one directory
- File names clearly indicate purpose
- Easy to find related code (all files in feature dir start with feature name)
- Scales well as features grow
- New developers quickly understand the structure

**Negative:**
- Requires discipline to maintain suffix conventions
- Directories can grow large with many files
- Shared utilities must go in separate `lib/` or `common/` directories

## Verification

- Code review checklist includes suffix convention verification
- All files in a feature directory start with the feature name
- Controllers, services, validators are always separated
