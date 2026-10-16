import { prisma, MerchantType } from '@tabhop/database';
import type {
  CatalogItemRecordDto,
  NearbyPartnerRowDto,
  VenueLocationRecordDto,
} from './catalog.model.js';

/**
 * Database models accessed by the Catalog module:
 * - Item
 * - Merchant (including PostGIS ST_DWithin spatial queries on Merchant coordinates)
 */
export type CatalogDatabaseClient = Pick<
  typeof prisma,
  'item' | 'merchant' | '$queryRaw'
>;

const db: CatalogDatabaseClient = prisma;

export async function findActiveVenueItems(
  venueId: string
): Promise<CatalogItemRecordDto[]> {
  const venueItems: CatalogItemRecordDto[] = await db.item.findMany({
    where: {
      isActive: true,
      merchant: {
        id: venueId,
        merchantType: MerchantType.PRIMARY_VENUE,
      },
    },
  });
  return venueItems;
}

export async function findVenueLocationById(
  venueId: string
): Promise<VenueLocationRecordDto | null> {
  const venue: VenueLocationRecordDto | null = await db.merchant.findUnique({
    where: { id: venueId },
  });
  return venue;
}

export async function findNearbyPartnerIds(
  longitude: number,
  latitude: number,
  effectiveRadiusM: number
): Promise<NearbyPartnerRowDto[]> {
  const nearbyPartners: NearbyPartnerRowDto[] =
    await db.$queryRaw<NearbyPartnerRowDto[]>`
      SELECT m."id"
      FROM "Merchant" m
      WHERE m."merchantType" = 'EXTERNAL_PARTNER'::"MerchantType"
        AND m."latitude" IS NOT NULL
        AND m."longitude" IS NOT NULL
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(m."longitude", m."latitude"), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
          ${effectiveRadiusM}
        )
    `;
  return nearbyPartners;
}

export async function findActivePartnerItemsByMerchantIds(
  partnerIds: string[]
): Promise<CatalogItemRecordDto[]> {
  const partnerItems: CatalogItemRecordDto[] = await db.item.findMany({
    where: {
      isActive: true,
      merchantId: { in: partnerIds },
      merchant: {
        merchantType: MerchantType.EXTERNAL_PARTNER,
      },
    },
  });
  return partnerItems;
}

export async function findAllActivePartnerItems(): Promise<
  CatalogItemRecordDto[]
> {
  const partnerItems: CatalogItemRecordDto[] = await db.item.findMany({
    where: {
      isActive: true,
      merchant: {
        merchantType: MerchantType.EXTERNAL_PARTNER,
      },
    },
  });
  return partnerItems;
}
