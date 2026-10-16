import { UserRole } from '@tabhop/database';
import { ServiceError } from '../lib/service-error.js';
import { logger } from '../lib/logger.js';
import type { UpdatePlatformSettingsRequest } from './admin.validator.js';
import type {
  PlatformSettingsRecordDto,
  PlatformSettingsView,
} from './admin.model.js';
import {
  findPlatformSettingsById,
  upsertPlatformSettings,
} from './admin.repository.js';

export { ServiceError };
export type { PlatformSettingsRecordDto, PlatformSettingsView };

export const DEFAULT_SETTINGS_ID: string = 'default';
export const DEFAULT_PLATFORM_FEE_BPS: number = 500;
export const DEFAULT_TAX_RATE_BPS: number = 800;

/**
 * Retrieve current platform settings (PLATFORM_FEE_BPS and TAX_RATE_BPS),
 * falling back to 500 BPS (5%) and 800 BPS (8%) if not yet configured by an admin.
 */
export async function getPlatformSettings(): Promise<PlatformSettingsView> {
  const record: PlatformSettingsRecordDto | null =
    await findPlatformSettingsById(DEFAULT_SETTINGS_ID);

  const settings: PlatformSettingsView = record
    ? {
        platformFeeBps: record.platformFeeBps,
        taxRateBps: record.taxRateBps,
        updatedByUserId: record.updatedByUserId,
        updatedAt: record.updatedAt,
      }
    : {
        platformFeeBps: DEFAULT_PLATFORM_FEE_BPS,
        taxRateBps: DEFAULT_TAX_RATE_BPS,
        updatedByUserId: null,
        updatedAt: null,
      };

  return settings;
}

/**
 * Update platform fee and/or tax rate basis points in the database.
 * - PLATFORM_ADMIN can update both platformFeeBps and taxRateBps.
 * - PLATFORM_FINANCE can update taxRateBps only (cannot modify platformFeeBps).
 */
export async function updatePlatformSettings(
  input: UpdatePlatformSettingsRequest,
  actorUser: { id: string; role: UserRole }
): Promise<PlatformSettingsView> {
  if (
    (input.platformFeeBps !== undefined &&
      (input.platformFeeBps < 0 || input.platformFeeBps > 10000)) ||
    (input.taxRateBps !== undefined && (input.taxRateBps < 0 || input.taxRateBps > 10000))
  ) {
    throw new ServiceError(
      400,
      'INVALID_SETTINGS',
      'Basis points must be between 0 and 10000'
    );
  }

  if (
    input.platformFeeBps !== undefined &&
    actorUser.role !== UserRole.PLATFORM_ADMIN
  ) {
    logger.warn(
      {
        actorUserId: actorUser.id,
        actorRole: actorUser.role,
        attemptedPlatformFeeBps: input.platformFeeBps,
      },
      'RBAC denied: non-PLATFORM_ADMIN user attempted to modify platformFeeBps'
    );
    throw new ServiceError(
      403,
      'FORBIDDEN',
      'Only PLATFORM_ADMIN users can modify platformFeeBps'
    );
  }

  const current: PlatformSettingsView = await getPlatformSettings();
  const nextPlatformFeeBps: number = input.platformFeeBps ?? current.platformFeeBps;
  const nextTaxRateBps: number = input.taxRateBps ?? current.taxRateBps;

  const updated: PlatformSettingsRecordDto = await upsertPlatformSettings({
    id: DEFAULT_SETTINGS_ID,
    platformFeeBps: nextPlatformFeeBps,
    taxRateBps: nextTaxRateBps,
    updatedByUserId: actorUser.id,
  });

  logger.info(
    {
      actorUserId: actorUser.id,
      actorRole: actorUser.role,
      previousPlatformFeeBps: current.platformFeeBps,
      newPlatformFeeBps: updated.platformFeeBps,
      previousTaxRateBps: current.taxRateBps,
      newTaxRateBps: updated.taxRateBps,
    },
    'Platform settings updated with audit diff'
  );

  return {
    platformFeeBps: updated.platformFeeBps,
    taxRateBps: updated.taxRateBps,
    updatedByUserId: updated.updatedByUserId,
    updatedAt: updated.updatedAt,
  };
}
