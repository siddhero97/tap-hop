import { Request, Response } from 'express';
import { getPlatformSettings, updatePlatformSettings, type PlatformSettingsView } from './admin.service.js';
import { getValidated } from '../middleware/validate.js';
import { sendServiceError } from '../lib/service-error.js';
import { logger } from '../lib/logger.js';
import type { UpdatePlatformSettingsRequest } from './admin.validator.js';

/**
 * GET /admin/settings - Retrieve current platform fee and tax rate basis points
 * Accessible to internal TabHop roles: PLATFORM_SUPPORT, PLATFORM_FINANCE, PLATFORM_ADMIN.
 */
export async function getSettings(_req: Request, res: Response): Promise<void> {
  try {
    const settings: PlatformSettingsView = await getPlatformSettings();
    res.status(200).json({
      status: 'success',
      settings,
    });
  } catch (error) {
    logger.error({ error: String(error) }, 'Error retrieving platform settings');
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve platform settings',
    });
  }
}

/**
 * PATCH /admin/settings - Update platform fee and/or tax rate basis points
 * - PLATFORM_ADMIN: can update both platformFeeBps and taxRateBps
 * - PLATFORM_FINANCE: can update taxRateBps only
 */
export async function updateSettings(req: Request, res: Response): Promise<void> {
  try {
    const body: UpdatePlatformSettingsRequest = getValidated<UpdatePlatformSettingsRequest>(req);
    const settings: PlatformSettingsView = await updatePlatformSettings(body, {
      id: req.user!.id,
      role: req.user!.role,
    });

    logger.info(
      {
        adminUserId: req.user!.id,
        adminRole: req.user!.role,
        platformFeeBps: settings.platformFeeBps,
        taxRateBps: settings.taxRateBps,
      },
      'Platform settings updated by admin'
    );

    res.status(200).json({
      status: 'success',
      settings,
    });
  } catch (error) {
    if (!sendServiceError(res, error)) {
      logger.error({ error: String(error) }, 'Error updating platform settings');
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Failed to update platform settings',
      });
    }
  }
}
