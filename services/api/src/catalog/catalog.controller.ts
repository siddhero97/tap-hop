import { Request, Response } from 'express';
import { catalogService, type CatalogItemRecordDto } from './catalog.service.js';
import { sendServiceError } from '../lib/service-error.js';
import { getValidated } from '../middleware/validate.js';
import { logger } from '../lib/logger.js';
import type { CatalogMenuQuery } from './catalog.validator.js';

/**
 * GET /catalog/venues/:venueId/menu - Retrieve full menu (venue items + partner items)
 */
export async function getFullMenu(req: Request, res: Response): Promise<void> {
  try {
    const { venueId } = req.params;
    const query: CatalogMenuQuery | undefined = getValidated<CatalogMenuQuery | undefined>(req);
    const menu: { venue: CatalogItemRecordDto[]; partners: CatalogItemRecordDto[] } = await catalogService.getFullMenu(venueId, query?.radiusMeters);
    res.status(200).json({ status: 'success', data: menu });
  } catch (error) {
    if (!sendServiceError(res, error)) {
      logger.error({ error: String(error), venueId: req.params.venueId }, 'Error retrieving full menu');
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve menu',
      });
    }
  }
}

/**
 * GET /catalog/venues/:venueId/menu/venue - Retrieve only venue items
 */
export async function getVenueMenu(req: Request, res: Response): Promise<void> {
  try {
    const { venueId } = req.params;
    const menu: { venueItems: CatalogItemRecordDto[] } = await catalogService.getVenueMenu(venueId);
    res.status(200).json({ status: 'success', data: menu });
  } catch (error) {
    if (!sendServiceError(res, error)) {
      logger.error({ error: String(error), venueId: req.params.venueId }, 'Error retrieving venue menu');
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve venue menu',
      });
    }
  }
}

/**
 * GET /catalog/venues/:venueId/menu/partners - Retrieve only partner items
 */
export async function getPartnerItems(req: Request, res: Response): Promise<void> {
  try {
    const { venueId } = req.params;
    const query: CatalogMenuQuery | undefined = getValidated<CatalogMenuQuery | undefined>(req);
    const menu: { partnerItems: CatalogItemRecordDto[] } = await catalogService.getPartnerItems(venueId, query?.radiusMeters);
    res.status(200).json({ status: 'success', data: menu });
  } catch (error) {
    if (!sendServiceError(res, error)) {
      logger.error({ error: String(error), venueId: req.params.venueId }, 'Error retrieving partner items');
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve partner items',
      });
    }
  }
}

