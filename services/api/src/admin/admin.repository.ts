import { prisma } from '@tabhop/database';
import type { PlatformSettingsRecordDto } from './admin.model.js';

/**
 * Database models accessed by the Admin module:
 * - PlatformSettings
 */
export type AdminDatabaseClient = Pick<typeof prisma, 'platformSettings'>;

const db: AdminDatabaseClient = prisma;

/**
 * Find a platform settings record by its primary key ID.
 */
export async function findPlatformSettingsById(
  id: string
): Promise<PlatformSettingsRecordDto | null> {
  const record: PlatformSettingsRecordDto | null =
    await db.platformSettings.findUnique({
      where: { id },
    });
  return record;
}

/**
 * Upsert the platform settings record with updated basis points and audit actor.
 */
export async function upsertPlatformSettings(params: {
  id: string;
  platformFeeBps: number;
  taxRateBps: number;
  updatedByUserId: string;
}): Promise<PlatformSettingsRecordDto> {
  const updated: PlatformSettingsRecordDto = await db.platformSettings.upsert({
    where: { id: params.id },
    create: {
      id: params.id,
      platformFeeBps: params.platformFeeBps,
      taxRateBps: params.taxRateBps,
      updatedByUserId: params.updatedByUserId,
    },
    update: {
      platformFeeBps: params.platformFeeBps,
      taxRateBps: params.taxRateBps,
      updatedByUserId: params.updatedByUserId,
    },
  });
  return updated;
}
