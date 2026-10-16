import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import type { Item } from '@tabhop/database';
import type { Mock } from 'vitest';

// Mock Decimal for testing
class MockDecimal {
  constructor(private value: string | number) {}
  toString(): string {
    return String(this.value);
  }
  toFixed(places: number): string {
    return parseFloat(String(this.value)).toFixed(places);
  }
}

export interface MockCatalogItem {
  id: string;
  merchantId: string;
  name: string;
  description: string | null;
  price: MockDecimal;
  category: string;
  isActive: boolean;
  metadata: null;
}

// Mock item factory
const createMockItem = (overrides: Partial<MockCatalogItem> = {}): Item =>
  ({
    id: `item-${Math.random()}`,
    merchantId: 'merchant-1',
    name: 'Test Item',
    description: 'Test description',
    price: new MockDecimal('10.00'),
    category: 'appetizers',
    isActive: true,
    metadata: null,
    ...overrides,
  }) as unknown as Item;

// Mock the database module before importing CatalogService
vi.mock('@tabhop/database', () => {
  const findManyMock: ReturnType<typeof vi.fn> = vi.fn();
  const findUniqueMerchantMock: ReturnType<typeof vi.fn> = vi.fn();
  const queryRawMock: ReturnType<typeof vi.fn> = vi.fn();
  return {
    MerchantType: {
      PRIMARY_VENUE: 'PRIMARY_VENUE',
      EXTERNAL_PARTNER: 'EXTERNAL_PARTNER',
    },
    prisma: {
      item: {
        findMany: findManyMock,
      },
      merchant: {
        findUnique: findUniqueMerchantMock,
      },
      $queryRaw: queryRawMock,
    },
  };
});

// Import after mocking
import { CatalogService } from '../../src/catalog/catalog.service';

describe('CatalogService', () => {
  let service: CatalogService;
  let mockPrismaItem: { findMany: Mock };
  let mockPrismaMerchant: { findUnique: Mock };
  let mockQueryRaw: Mock;

  beforeEach(async () => {
    const module: typeof import('@tabhop/database') = await import('@tabhop/database');
    mockPrismaItem = module.prisma.item as unknown as { findMany: Mock };
    mockPrismaMerchant = module.prisma.merchant as unknown as { findUnique: Mock };
    mockQueryRaw = module.prisma.$queryRaw as unknown as Mock;
    service = new CatalogService();
    vi.clearAllMocks();
    // Default: venue has no coordinates (fallback mode)
    mockPrismaMerchant.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getVenueMenu', () => {
    it('returns venue items for a specific venue', async () => {
      const venueId: string = 'venue-123';
      const mockVenueItems: Item[] = [
        createMockItem({ id: 'item-1', name: 'Burger', merchantId: venueId }),
        createMockItem({ id: 'item-2', name: 'Fries', merchantId: venueId }),
        createMockItem({ id: 'item-3', name: 'Salad', merchantId: venueId }),
        createMockItem({ id: 'item-4', name: 'Soup', merchantId: venueId }),
        createMockItem({ id: 'item-5', name: 'Dessert', merchantId: venueId }),
        createMockItem({ id: 'item-6', name: 'Drink', merchantId: venueId }),
      ];

      mockPrismaItem.findMany.mockResolvedValueOnce(mockVenueItems);

      const result: { venueItems: Item[] } = await service.getVenueMenu(venueId);

      expect(result.venueItems).toHaveLength(6);
      expect(result.venueItems[0].name).toBe('Burger');
      expect(mockPrismaItem.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          merchant: {
            id: venueId,
            merchantType: 'PRIMARY_VENUE',
          },
        },
      });
    });

    it('returns empty array for unknown venue', async () => {
      const unknownVenueId: string = 'unknown-venue-999';
      mockPrismaItem.findMany.mockResolvedValueOnce([]);

      const result: { venueItems: Item[] } = await service.getVenueMenu(unknownVenueId);

      expect(result.venueItems).toHaveLength(0);
      expect(mockPrismaItem.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          merchant: {
            id: unknownVenueId,
            merchantType: 'PRIMARY_VENUE',
          },
        },
      });
    });

    it('excludes inactive items', async () => {
      const venueId: string = 'venue-456';
      const mockItems: Item[] = [
        createMockItem({ id: 'item-1', isActive: true, merchantId: venueId }),
        createMockItem({ id: 'item-2', isActive: true, merchantId: venueId }),
      ];

      mockPrismaItem.findMany.mockResolvedValueOnce(mockItems);

      const result: { venueItems: Item[] } = await service.getVenueMenu(venueId);

      // Verify the query filters by isActive: true
      expect(mockPrismaItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
          }),
        })
      );
      expect(result.venueItems).toEqual(mockItems);
    });
  });

  describe('getPartnerItems', () => {
    it('returns all active partner items', async () => {
      const mockPartnerItems: Item[] = [
        createMockItem({
          id: 'partner-item-1',
          name: 'Partner Dish 1',
          merchantId: 'partner-merchant-1',
        }),
        createMockItem({
          id: 'partner-item-2',
          name: 'Partner Dish 2',
          merchantId: 'partner-merchant-1',
        }),
        createMockItem({
          id: 'partner-item-3',
          name: 'Partner Dish 3',
          merchantId: 'partner-merchant-2',
        }),
        createMockItem({
          id: 'partner-item-4',
          name: 'Partner Dish 4',
          merchantId: 'partner-merchant-2',
        }),
      ];

      mockPrismaItem.findMany.mockResolvedValueOnce(mockPartnerItems);

      const result: { partnerItems: Item[] } = await service.getPartnerItems('any-venue');

      expect(result.partnerItems).toHaveLength(4);
      expect(result.partnerItems[0].name).toBe('Partner Dish 1');
      expect(mockPrismaItem.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          merchant: {
            merchantType: 'EXTERNAL_PARTNER',
          },
        },
      });
    });

    it('returns empty array when no partner items exist', async () => {
      mockPrismaItem.findMany.mockResolvedValueOnce([]);

      const result: { partnerItems: Item[] } = await service.getPartnerItems('venue-123');

      expect(result.partnerItems).toHaveLength(0);
      expect(mockPrismaItem.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          merchant: {
            merchantType: 'EXTERNAL_PARTNER',
          },
        },
      });
    });

    it('excludes inactive partner items', async () => {
      const mockItems: Item[] = [
        createMockItem({
          id: 'partner-item-1',
          isActive: true,
          merchantId: 'partner-merchant-1',
        }),
      ];

      mockPrismaItem.findMany.mockResolvedValueOnce(mockItems);

      const result: { partnerItems: Item[] } = await service.getPartnerItems('venue-123');

      // Verify the query filters by isActive: true
      expect(mockPrismaItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
          }),
        })
      );
      expect(result.partnerItems).toEqual(mockItems);
    });
  });

  describe('getFullMenu', () => {
    it('returns combined venue and partner items', async () => {
      const venueId: string = 'venue-789';
      const mockVenueItems: Item[] = [
        createMockItem({ id: 'venue-1', name: 'Venue Item 1', merchantId: venueId }),
        createMockItem({ id: 'venue-2', name: 'Venue Item 2', merchantId: venueId }),
      ];
      const mockPartnerItems: Item[] = [
        createMockItem({
          id: 'partner-1',
          name: 'Partner Item 1',
          merchantId: 'partner-1',
        }),
        createMockItem({
          id: 'partner-2',
          name: 'Partner Item 2',
          merchantId: 'partner-2',
        }),
      ];

      mockPrismaItem.findMany
        .mockResolvedValueOnce(mockVenueItems)
        .mockResolvedValueOnce(mockPartnerItems);

      const result: { venue: Item[]; partners: Item[] } = await service.getFullMenu(venueId);

      expect(result.venue).toHaveLength(2);
      expect(result.partners).toHaveLength(2);
      expect(result.venue[0].name).toBe('Venue Item 1');
      expect(result.partners[0].name).toBe('Partner Item 1');

      // Verify that findMany was called twice
      expect(mockPrismaItem.findMany).toHaveBeenCalledTimes(2);
    });

    it('handles empty venue and partner items', async () => {
      const venueId: string = 'venue-empty';
      mockPrismaItem.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result: { venue: Item[]; partners: Item[] } = await service.getFullMenu(venueId);

      expect(result.venue).toHaveLength(0);
      expect(result.partners).toHaveLength(0);
    });

    it('returns full menu with 6 venue and 4 partner items', async () => {
      const venueId: string = 'venue-full';
      const mockVenueItems: Item[] = Array.from({ length: 6 }, (_, i) =>
        createMockItem({ id: `venue-${i}`, name: `Venue Item ${i + 1}`, merchantId: venueId })
      );
      const mockPartnerItems: Item[] = Array.from({ length: 4 }, (_, i) =>
        createMockItem({
          id: `partner-${i}`,
          name: `Partner Item ${i + 1}`,
          merchantId: `partner-${i}`,
        })
      );

      mockPrismaItem.findMany
        .mockResolvedValueOnce(mockVenueItems)
        .mockResolvedValueOnce(mockPartnerItems);

      const result: { venue: Item[]; partners: Item[] } = await service.getFullMenu(venueId);

      expect(result.venue).toHaveLength(6);
      expect(result.partners).toHaveLength(4);
    });
  });

  describe('query filters', () => {
    it('filters venue menu by merchant type and venue ID', async () => {
      const venueId: string = 'venue-filter-test';
      mockPrismaItem.findMany.mockResolvedValueOnce([]);

      await service.getVenueMenu(venueId);

      expect(mockPrismaItem.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          merchant: {
            id: venueId,
            merchantType: 'PRIMARY_VENUE',
          },
        },
      });
    });

    it('filters partner items by merchant type only', async () => {
      mockPrismaItem.findMany.mockResolvedValueOnce([]);

      await service.getPartnerItems('any-venue');

      expect(mockPrismaItem.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          merchant: {
            merchantType: 'EXTERNAL_PARTNER',
          },
        },
      });
    });

    it('only returns active items', async () => {
      mockPrismaItem.findMany.mockResolvedValueOnce([]);

      // All queries should check isActive: true
      await service.getVenueMenu('venue-1');
      await service.getPartnerItems('venue-1');

      const calls: Array<[{ where: { isActive: boolean } }]> = mockPrismaItem.findMany.mock.calls as Array<[{ where: { isActive: boolean } }]>;
      calls.forEach((call) => {
        expect(call[0].where.isActive).toBe(true);
      });
    });

    it('Given a geolocated taproom venue, When getPartnerItems is called, Then PostGIS ST_DWithin filters nearby EXTERNAL_PARTNER items', async () => {
      const austinTaproomVenueId: string = 'austin-taproom-venue';
      mockPrismaMerchant.findUnique.mockResolvedValueOnce({
        id: austinTaproomVenueId,
        latitude: 30.2672,
        longitude: -97.7431,
        deliveryRadiusM: 500,
      });
      mockQueryRaw.mockResolvedValueOnce([{ id: 'fuego-tacos-truck' }]);
      const fuegoStreetTacoItems: Item[] = [
        createMockItem({
          id: 'al-pastor-taco-item',
          merchantId: 'fuego-tacos-truck',
          name: 'Al Pastor Street Taco',
        }),
      ];
      mockPrismaItem.findMany.mockResolvedValueOnce(fuegoStreetTacoItems);

      const partnerCatalogResult: { partnerItems: Item[] } = await service.getPartnerItems(austinTaproomVenueId, 600);

      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      expect(mockPrismaItem.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          merchantId: { in: ['fuego-tacos-truck'] },
          merchant: {
            merchantType: 'EXTERNAL_PARTNER',
          },
        },
      });
      expect(partnerCatalogResult.partnerItems).toEqual(fuegoStreetTacoItems);
    });

    it('Given an isolated taproom venue with no partners in range, When PostGIS returns zero merchants, Then getPartnerItems returns empty partnerItems without querying Item', async () => {
      const hilltopTaproomVenueId: string = 'hilltop-isolated-taproom';
      mockPrismaMerchant.findUnique.mockResolvedValueOnce({
        id: hilltopTaproomVenueId,
        latitude: 30.2672,
        longitude: -97.7431,
        deliveryRadiusM: null,
      });
      mockQueryRaw.mockResolvedValueOnce([]);

      const emptyPartnerCatalogResult: { partnerItems: Item[] } = await service.getPartnerItems(hilltopTaproomVenueId);

      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      expect(mockPrismaItem.findMany).not.toHaveBeenCalled();
      expect(emptyPartnerCatalogResult.partnerItems).toEqual([]);
    });

    it('Given a zero or negative radiusMeters override, When getPartnerItems is called, Then it rejects with an error', async () => {
      await expect(service.getPartnerItems('austin-taproom-venue', 0)).rejects.toThrow(
        'Radius in meters must be a positive number'
      );
      await expect(service.getPartnerItems('austin-taproom-venue', -100)).rejects.toThrow(
        'Radius in meters must be a positive number'
      );
    });
  });
});

