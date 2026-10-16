import { Item, MerchantType } from '@tabhop/database';

/**
 * Database record DTOs for Catalog & PostGIS Spatial Discovery.
 */

export type CatalogItemRecordDto = Item;

export interface VenueLocationRecordDto {
  id: string;
  merchantType: MerchantType;
  latitude: number | null;
  longitude: number | null;
  deliveryRadiusM: number | null;
}

export interface NearbyPartnerRowDto {
  id: string;
}
