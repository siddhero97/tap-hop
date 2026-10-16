import { Router } from 'express';
import { UserRole } from '@tabhop/database';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateMiddleware } from '../middleware/validate.js';
import { UpdatePlatformSettingsSchema } from './admin.validator.js';
import { getSettings, updateSettings } from './admin.controller.js';

const router: Router = Router();

// GET /admin/settings is accessible to all internal TabHop roles (Support, Finance, Admin)
router.get(
  '/settings',
  requireAuth,
  requireRole(
    UserRole.PLATFORM_SUPPORT,
    UserRole.PLATFORM_FINANCE,
    UserRole.PLATFORM_ADMIN
  ),
  getSettings
);

// PATCH /admin/settings is accessible to TabHop Finance (taxRateBps only) and Admin (both)
router.patch(
  '/settings',
  requireAuth,
  requireRole(UserRole.PLATFORM_FINANCE, UserRole.PLATFORM_ADMIN),
  validateMiddleware(UpdatePlatformSettingsSchema, 'body'),
  updateSettings
);

export { router as adminRouter };
