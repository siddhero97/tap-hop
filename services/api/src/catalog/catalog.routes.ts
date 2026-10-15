import { Router } from 'express';
import { validateMiddleware } from '../middleware/validate.js';
import { VenueIdParamsSchema } from './catalog.validator.js';
import { getFullMenu, getVenueMenu, getPartnerItems } from './catalog.controller.js';

const router = Router();

/**
 * GET /catalog/venues/:venueId/menu - Retrieve full menu (venue + partner items)
 */
router.get('/venues/:venueId/menu', validateMiddleware(VenueIdParamsSchema, 'params'), getFullMenu);

/**
 * GET /catalog/venues/:venueId/menu/venue - Retrieve venue items only
 */
router.get('/venues/:venueId/menu/venue', validateMiddleware(VenueIdParamsSchema, 'params'), getVenueMenu);

/**
 * GET /catalog/venues/:venueId/menu/partners - Retrieve partner items only
 */
router.get('/venues/:venueId/menu/partners', validateMiddleware(VenueIdParamsSchema, 'params'), getPartnerItems);

export { router as catalogRouter };
