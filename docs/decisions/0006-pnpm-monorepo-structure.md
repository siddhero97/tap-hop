# ADR 0006: pnpm Monorepo Structure with Workspaces

**Date:** 2026-10-14

**Status:** Accepted

## Context

TabHop has multiple packages that share types and database definitions:
- `services/api` - Express API server
- `packages/database` - Prisma schema, migrations, seeding
- `packages/types` - Shared TypeScript types and types

Managing dependencies across these packages requires:
- Shared types without circular dependencies
- Shared database client
- Efficient installation and linking
- Clear dependency relationships

## Decision

Use **pnpm workspaces** with:

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/**'
  - 'services/**'
```

**Structure:**
```
root package.json
  - Defines workspace scripts: dev, test, build, lint, typecheck
  - Scripts use pnpm filters: pnpm -r test, pnpm -F @tabhop/api build
  
packages/database/
  - Defines Prisma schema and migrations
  - Exports database client and types
  - Root script: pnpm db:seed, pnpm db:migrate
  
packages/types/
  - Shared TypeScript types
  - Zod validation schemas shared across packages
  
services/api/
  - Depends on @tabhop/database and @tabhop/types
  - Main API server
  - Uses workspace:* for local dependencies
```

**Dependency declaration:**
```json
{
  "dependencies": {
    "@tabhop/database": "workspace:*",
    "@tabhop/types": "workspace:*"
  }
}
```

## Consequences

**Positive:**
- All packages share same dependency versions
- Local imports use TypeScript without compilation barriers
- Single pnpm-lock.yaml for reproducible builds
- Root scripts orchestrate all packages
- Clear separation of concerns

**Negative:**
- Requires understanding pnpm-specific commands (--filter, -F, -r)
- All packages must follow semantic versioning (workspace:*)
- Local development requires running root install, not individual packages

## Verification

- `pnpm install` installs all workspaces
- `pnpm -r lint` lints all packages
- `pnpm -F @tabhop/api test` tests only the API
- Circular dependencies are caught at build time
