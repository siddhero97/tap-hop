# ADR 0005: Prisma ORM for Type-Safe Data Access

**Date:** 2026-10-14

**Status:** Accepted

## Context

The application needs reliable, type-safe access to PostgreSQL with:
- Strong typing throughout the stack
- Easy migrations for schema changes
- Protection against SQL injection
- Query building that's intuitive for Node.js developers
- Good support for transactions (critical for settlement atomicity)

Options considered:
1. Raw SQL with parameterized queries - Low-level control but error-prone
2. TypeORM - Full-featured but heavy, steep learning curve
3. Sequelize - Older, less TypeScript-first
4. Prisma - Modern, TypeScript-first, excellent DX

## Decision

Use **Prisma ORM** as the single source of truth for data access:

1. Single `schema.prisma` file defines all tables, relationships, and constraints
2. `pnpm db:migrate` generates and applies SQL migrations
3. Prisma Client provides auto-generated, type-safe query methods
4. All data access goes through Prisma (no raw SQL except in migrations)

## Consequences

**Positive:**
- Type-safe queries with IDE autocomplete
- Zero SQL injection vulnerabilities
- Migrations are version-controlled
- Schema and application code stay in sync
- Built-in support for transactions
- Excellent Node.js ecosystem fit

**Negative:**
- Adds a dependency (though small)
- Requires learning Prisma query syntax
- Complex queries sometimes need `$queryRaw` (tempered with types)
- Prisma Client must be re-generated after schema changes

## Verification

- All queries use Prisma Client, no raw SQL in application code
- `pnpm db:migrate` is part of deployment pre-deploy hook
- Migration tests ensure schema changes are backward compatible
