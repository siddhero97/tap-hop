import { prisma } from '@tabhop/database';

/**
 * Database operations accessed by the Health module:
 * - Raw SQL connectivity check (`SELECT 1`)
 */
export type HealthDatabaseClient = Pick<typeof prisma, '$queryRaw'>;

export interface HealthPingRowDto {
  '?column?'?: number;
}

const db: HealthDatabaseClient = prisma;

export async function pingDatabase(): Promise<HealthPingRowDto[]> {
  const rows: HealthPingRowDto[] =
    await db.$queryRaw<HealthPingRowDto[]>`SELECT 1`;
  return rows;
}
