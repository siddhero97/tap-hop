# Database Migrations

This runbook explains how to create and apply database migrations using Prisma.

## Overview

Database migrations in TabHop:

1. **Schema changes**: Edit `packages/database/prisma/schema.prisma`
2. **Create migration**: `pnpm db:migrate` generates migration SQL
3. **Apply migration**: Automatically applied when database starts
4. **Deployment**: `pnpm db:migrate:deploy` applies pending migrations to production

## Creating a Migration

### Step 1: Update Schema

Edit `packages/database/prisma/schema.prisma`:

```prisma
model Order {
  id            String    @id @default(cuid())
  venueId       String
  // NEW FIELD:
  notes         String?   @db.Text
  status        OrderStatus
  totalAmount   Decimal   @db.Decimal(19, 2)
  
  @@index([venueId])
}
```

### Step 2: Generate Migration

```bash
pnpm db:migrate

# This will:
# 1. Show the SQL that will be created
# 2. Ask for a migration name (e.g., "add_order_notes")
# 3. Create migration file: packages/database/prisma/migrations/xxx_add_order_notes/
# 4. Apply migration to development database
# 5. Regenerate Prisma Client
```

### Step 3: Test Migration

```bash
# Run tests to ensure no data is lost
pnpm test

# Test manually:
pnpm dev
# Create an order and verify notes field works
```

### Step 4: Commit Migration

```bash
git add packages/database/prisma/
git commit -m "feat: add notes field to orders

- Add optional text column to Order model
- Generated migration: add_order_notes"
```

## Migration Best Practices

### Safe Migrations

**Always use reversible migrations:**

✅ SAFE:
- Adding nullable columns
- Creating new tables
- Adding indices
- Renaming columns (Prisma handles this)

❌ RISKY (plan carefully):
- Dropping columns (adds data loss risk)
- Making nullable columns NOT NULL (requires backfill)
- Changing column types (requires casting)
- Renaming tables

### Backfill Data

When adding a NOT NULL column, you must backfill existing rows:

```prisma
// 1. Create nullable column first
model Order {
  status String?  // nullable
}

// 2. Generate and apply migration
// 3. Backfill in code or SQL:
/*
  UPDATE "Order" SET status = 'PENDING' WHERE status IS NULL;
*/

// 4. Create second migration to make NOT NULL
model Order {
  status String  @db.VarChar(50)
}

// 5. Generate and apply second migration
```

### Reversing a Migration

If a migration has an issue, revert it:

```bash
# Check migration history
ls packages/database/prisma/migrations/

# Revert the most recent migration manually:
# 1. Delete the migration directory
# 2. Restore the previous schema.prisma
# 3. Regenerate Prisma Client: pnpm db:migrate
```

**Note:** In production, reversions require careful coordination. Coordinate with ops team and have a rollback plan.

## Applying Migrations to Production

### During Deployment

Render automatically runs pre-deploy command:

```yaml
# render.yaml
preDeployCommand: 'cd packages/database && pnpm prisma migrate deploy'
```

This ensures migrations are applied before the new API version starts.

### Manual Application (if needed)

```bash
# Connect to production database
# (assuming you have DB credentials)

# Apply all pending migrations
pnpm prisma migrate deploy --skip-generate

# Check status
pnpm prisma migrate status
```

### Verification

After migrations are applied:

```bash
# Verify schema matches expectations
pnpm prisma db push --skip-generate

# Check for unexpected differences
pnpm prisma db pull
```

## Emergency: Migration Rollback

If a migration causes data loss or breaks production:

1. **Revert to previous API version** (via Render/deployment platform)
2. **Manually reverse migration** in database:
   ```sql
   -- Example: reverse migration that dropped a column
   ALTER TABLE "Order" ADD COLUMN "notes" TEXT;
   ```
3. **Test rollback** in staging
4. **Post-mortem**: Understand what went wrong
5. **Deploy fix** for next version

## Monitoring Migrations

Check migration status:

```bash
# Local development
pnpm prisma migrate status

# Show all migrations
pnpm prisma migrate resolve --help
```

View migration SQL:

```bash
# See what the next migration will do
cat packages/database/prisma/migrations/xxx_migration_name/migration.sql
```

## Common Issues

### "Cannot find migration file"
- Ensure migration was created: `ls packages/database/prisma/migrations/`
- Ensure `.prisma` extension, not `.sql`

### "Foreign key constraint violation"
- Migration is deleting/modifying referenced data
- Coordinate with data team
- May need to modify data before applying migration

### "Prisma Client out of sync"
- Run `pnpm db:migrate` to regenerate
- Clear Prisma cache: `rm node_modules/.prisma`
- Reinstall: `pnpm install`
