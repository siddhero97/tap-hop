import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock Decimal for testing
class MockDecimal {
  constructor(private value: string | number) {}
  toString() {
    return String(this.value);
  }
  toFixed(places: number) {
    return parseFloat(String(this.value)).toFixed(places);
  }
}

// Mock item factory
const createMockItem = (overrides: any = {}): any => ({
  id: `item-${Math.random()}`,
  merchantId: 'merchant-1',
  name: 'Test Item',
  description: 'Test description',
  price: new MockDecimal('10.00'),
  category: 'appetizers',
  isActive: true,
  metadata: null,
  ...overrides,
});

// Mock the database module before importing CatalogService
vi.mock('@tabhop/database', () => {
  const findManyMock = vi.fn();
  return {
    prisma: {
      item: {
        findMany: findManyMock,
      },
    },
  };
});

// Import after mocking
import { CatalogService } from '../../src/modules/catalog/service';

describe('CatalogService', () => {
  let service: CatalogService;
  let mockPrismaItem: any;

  beforeEach(async () => {
    const module = await import('@tabhop/database');
    mockPrismaItem = module.prisma.item;
    service = new CatalogService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getVenueMenu', () => {
    it('returns venue items for a specific venue', async () => {
      const venueId = 'venue-123';
      const mockVenueItems = [
        createMockItem({ id: 'item-1', name: 'Burger', merchantId: venueId }),
        createMockItem({ id: 'item-2', name: 'Fries', merchantId: venueId }),
        createMockItem({ id: 'item-3', name: 'Salad', merchantId: venueId }),
        createMockItem({ id: 'item-4', name: 'Soup', merchantId: venueId }),
        createMockItem({ id: 'item-5', name: 'Dessert', merchantId: venueId }),
        createMockItem({ id: 'item-6', name: 'Drink', merchantId: venueId }),
      ];

      mockPrismaItem.findMany.mockResolvedValueOnce(mockVenueItems);

      const result = await service.getVenueMenu(venueId);

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
      const unknownVenueId = 'unknown-venue-999';
      mockPrismaItem.findMany.mockResolvedValueOnce([]);

      const result = await service.getVenueMenu(unknownVenueId);

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
      const venueId = 'venue-456';
      const mockItems = [
        createMockItem({ id: 'item-1', isActive: true, merchantId: venueId }),
        createMockItem({ id: 'item-2', isActive: true, merchantId: venueId }),
      ];

      mockPrismaItem.findMany.mockResolvedValueOnce(mockItems);

      const result = await service.getVenueMenu(venueId);

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
      const mockPartnerItems = [
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

      const result = await service.getPartnerItems('any-venue');

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

      const result = await service.getPartnerItems('venue-123');

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
      const mockItems = [
        createMockItem({
          id: 'partner-item-1',
          isActive: true,
          merchantId: 'partner-merchant-1',
        }),
      ];

      mockPrismaItem.findMany.mockResolvedValueOnce(mockItems);

      const result = await service.getPartnerItems('venue-123');

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
      const venueId = 'venue-789';
      const mockVenueItems = [
        createMockItem({ id: 'venue-1', name: 'Venue Item 1', merchantId: venueId }),
        createMockItem({ id: 'venue-2', name: 'Venue Item 2', merchantId: venueId }),
      ];
      const mockPartnerItems = [
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

      const result = await service.getFullMenu(venueId);

      expect(result.venue).toHaveLength(2);
      expect(result.partners).toHaveLength(2);
      expect(result.venue[0].name).toBe('Venue Item 1');
      expect(result.partners[0].name).toBe('Partner Item 1');

      // Verify that findMany was called twice
      expect(mockPrismaItem.findMany).toHaveBeenCalledTimes(2);
    });

    it('handles empty venue and partner items', async () => {
      const venueId = 'venue-empty';
      mockPrismaItem.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getFullMenu(venueId);

      expect(result.venue).toHaveLength(0);
      expect(result.partners).toHaveLength(0);
    });

    it('returns full menu with 6 venue and 4 partner items', async () => {
      const venueId = 'venue-full';
      const mockVenueItems = Array.from({ length: 6 }, (_, i) =>
        createMockItem({ id: `venue-${i}`, name: `Venue Item ${i + 1}`, merchantId: venueId })
      );
      const mockPartnerItems = Array.from({ length: 4 }, (_, i) =>
        createMockItem({
          id: `partner-${i}`,
          name: `Partner Item ${i + 1}`,
          merchantId: `partner-${i}`,
        })
      );

      mockPrismaItem.findMany
        .mockResolvedValueOnce(mockVenueItems)
        .mockResolvedValueOnce(mockPartnerItems);

      const result = await service.getFullMenu(venueId);

      expect(result.venue).toHaveLength(6);
      expect(result.partners).toHaveLength(4);
    });
  });

  describe('query filters', () => {
    it('filters venue menu by merchant type and venue ID', async () => {
      const venueId = 'venue-filter-test';
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

      const calls = mockPrismaItem.findMany.mock.calls;
      calls.forEach((call: any) => {
        expect(call[0].where.isActive).toBe(true);
      });
    });
  });
});
