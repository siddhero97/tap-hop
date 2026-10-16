import { Item } from '@tabhop/database';
import { logger } from '../lib/logger.js';
import type {
  CatalogItemRecordDto,
  NearbyPartnerRowDto,
  VenueLocationRecordDto,
} from './catalog.model.js';
import {
  findActivePartnerItemsByMerchantIds,
  findActiveVenueItems,
  findAllActivePartnerItems,
  findNearbyPartnerIds,
  findVenueLocationById,
} from './catalog.repository.js';

export type { CatalogItemRecordDto };

const DEFAULT_DELIVERY_RADIUS_METERS: number = 500;

export class CatalogService {
  /**
   * Get all active menu items for a specific venue (PRIMARY_VENUE).
   */
  async getVenueMenu(venueId: string): Promise<{ venueItems: Item[] }> {
    const venueItems: CatalogItemRecordDto[] = await findActiveVenueItems(venueId);

    return { venueItems };
  }

  /**
   * Get active menu items from external partners (EXTERNAL_PARTNER).
   * When the primary venue has latitude & longitude coordinates, uses PostGIS
   * ST_DWithin (geography, meters) backed by Merchant_location_gist_idx to
   * discover nearby partners within the venue's delivery radius (or radiusMeters override).
   */
  async getPartnerItems(
    venueId: string,
    radiusMeters?: number
  ): Promise<{ partnerItems: Item[] }> {
    if (radiusMeters !== undefined && radiusMeters <= 0) {
      throw new Error('Radius in meters must be a positive number');
    }

    const venue: VenueLocationRecordDto | null =
      await findVenueLocationById(venueId);

    let partnerItems: CatalogItemRecordDto[];
    if (venue && venue.latitude !== null && venue.longitude !== null) {
      const effectiveRadiusM: number =
        radiusMeters ?? venue.deliveryRadiusM ?? DEFAULT_DELIVERY_RADIUS_METERS;

      const nearbyPartners: NearbyPartnerRowDto[] = await findNearbyPartnerIds(
        venue.longitude,
        venue.latitude,
        effectiveRadiusM
      );

      const partnerIds: string[] = nearbyPartners.map((p) => p.id);
      if (partnerIds.length === 0) {
        logger.info(
          { venueId, effectiveRadiusM, nearbyPartnerCount: 0 },
          'No nearby external partners found within PostGIS radius'
        );
        partnerItems = [];
      } else {
        const nearbyPartnerItems: CatalogItemRecordDto[] =
          await findActivePartnerItemsByMerchantIds(partnerIds);

        logger.info(
          {
            venueId,
            effectiveRadiusM,
            nearbyPartnerCount: partnerIds.length,
            partnerItemCount: nearbyPartnerItems.length,
          },
          'Retrieved nearby partner items via PostGIS ST_DWithin'
        );

        partnerItems = nearbyPartnerItems;
      }
    } else {
      const allPartnerItems: CatalogItemRecordDto[] =
        await findAllActivePartnerItems();
      partnerItems = allPartnerItems;
    }

    return { partnerItems };
  }

  /**
   * Get combined menu: both venue items and nearby partner items.
   */
  async getFullMenu(
    venueId: string,
    radiusMeters?: number
  ): Promise<{ venue: Item[]; partners: Item[] }> {
    const [venueResult, partnerResult]: [{ venueItems: Item[] }, { partnerItems: Item[] }] = await Promise.all([
      this.getVenueMenu(venueId),
      this.getPartnerItems(venueId, radiusMeters),
    ]);

    return {
      venue: venueResult.venueItems,
      partners: partnerResult.partnerItems,
    };
  }
}

// Export singleton instance
export const catalogService: CatalogService = new CatalogService();

