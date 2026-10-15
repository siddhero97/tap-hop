import { prisma, Item } from '@tabhop/database';

export class CatalogService {
  /**
   * Get all active menu items for a specific venue (PRIMARY_VENUE).
   */
  async getVenueMenu(venueId: string): Promise<{ venueItems: Item[] }> {
    const venueItems = await prisma.item.findMany({
      where: {
        isActive: true,
        merchant: {
          id: venueId,
          merchantType: 'PRIMARY_VENUE',
        },
      },
    });

    return { venueItems };
  }

  /**
   * Get all active menu items from external partners (EXTERNAL_PARTNER).
   */
  async getPartnerItems(venueId: string): Promise<{ partnerItems: Item[] }> {
    const partnerItems = await prisma.item.findMany({
      where: {
        isActive: true,
        merchant: {
          merchantType: 'EXTERNAL_PARTNER',
        },
      },
    });

    return { partnerItems };
  }

  /**
   * Get combined menu: both venue items and all partner items.
   */
  async getFullMenu(venueId: string): Promise<{ venue: Item[]; partners: Item[] }> {
    const [venueResult, partnerResult] = await Promise.all([
      this.getVenueMenu(venueId),
      this.getPartnerItems(venueId),
    ]);

    return {
      venue: venueResult.venueItems,
      partners: partnerResult.partnerItems,
    };
  }
}

// Export singleton instance
export const catalogService = new CatalogService();
