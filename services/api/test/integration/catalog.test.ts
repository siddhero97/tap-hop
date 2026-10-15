import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { prisma, MerchantType } from '@tabhop/database';
import { createApp } from '../../src/app.js';
import { Decimal } from '@prisma/client/runtime/library';
import { catalogService } from '../../src/catalog/catalog.service.js';
import { ServiceError } from '../../src/lib/service-error.js';

function createTestApp() {
  return createApp();
}

describe('Catalog Routes (Integration)', () => {
  let app: ReturnType<typeof createApp>;
  let primaryVenueId: string;
  let partnerMerchantId: string;
  let venueActiveItemId: string;
  let partnerActiveItemId: string;

  beforeEach(async () => {
    app = createTestApp();

    // 1. Create a primary venue merchant
    const venue = await prisma.merchant.create({
      data: {
        businessName: 'Main Beer Garden',
        merchantType: MerchantType.PRIMARY_VENUE,
        paypalEmail: 'venue@example.com',
      },
    });
    primaryVenueId = venue.id;

    // 2. Create an external partner merchant
    const partner = await prisma.merchant.create({
      data: {
        businessName: 'Taco Food Truck',
        merchantType: MerchantType.EXTERNAL_PARTNER,
        paypalEmail: 'tacos@example.com',
      },
    });
    partnerMerchantId = partner.id;

    // 3. Create active and inactive items for the venue
    const venueActiveItem = await prisma.item.create({
      data: {
        merchantId: primaryVenueId,
        name: 'IPA Draft',
        description: 'Freshly poured craft IPA',
        price: new Decimal('7.50'),
        category: 'Drinks',
        isActive: true,
      },
    });
    venueActiveItemId = venueActiveItem.id;

    await prisma.item.create({
      data: {
        merchantId: primaryVenueId,
        name: 'Seasonal Stout',
        description: 'Out of season stout',
        price: new Decimal('8.00'),
        category: 'Drinks',
        isActive: false, // Inactive
      },
    });

    // 4. Create active and inactive items for the partner
    const partnerActiveItem = await prisma.item.create({
      data: {
        merchantId: partnerMerchantId,
        name: 'Carne Asada Taco',
        description: 'Grilled steak taco',
        price: new Decimal('4.50'),
        category: 'Food',
        isActive: true,
      },
    });
    partnerActiveItemId = partnerActiveItem.id;

    await prisma.item.create({
      data: {
        merchantId: partnerMerchantId,
        name: 'Churros',
        description: 'Cinnamon sugar pastry',
        price: new Decimal('3.50'),
        category: 'Food',
        isActive: false, // Inactive
      },
    });
  });

  describe('GET /catalog/venues/:venueId/menu', () => {
    it('should return 200 with full combined menu (venue items + partner items)', async () => {
      const response = await request(app)
        .get(`/catalog/venues/${primaryVenueId}/menu`)
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data).toBeDefined();

      const { venue, partners } = response.body.data;
      expect(venue).toHaveLength(1);
      expect(venue[0].id).toBe(venueActiveItemId);
      expect(venue[0].name).toBe('IPA Draft');

      expect(partners).toHaveLength(1);
      expect(partners[0].id).toBe(partnerActiveItemId);
      expect(partners[0].name).toBe('Carne Asada Taco');
    });

    it('should return empty lists for a venue with no items', async () => {
      const emptyVenue = await prisma.merchant.create({
        data: {
          businessName: 'Empty Venue',
          merchantType: MerchantType.PRIMARY_VENUE,
          paypalEmail: 'empty@example.com',
        },
      });

      const response = await request(app)
        .get(`/catalog/venues/${emptyVenue.id}/menu`)
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.venue).toEqual([]);
      expect(response.body.data.partners).toHaveLength(1); // partner items still returned
    });

    it('should return 400 validation error if venueId is not a valid UUID', async () => {
      const response = await request(app)
        .get('/catalog/venues/invalid-uuid/menu')
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors).toBeDefined();
    });

    it('should handle ServiceError in getFullMenu', async () => {
      vi.spyOn(catalogService, 'getFullMenu').mockRejectedValueOnce(
        new ServiceError(404, 'NOT_FOUND', 'Venue not found')
      );

      const response = await request(app)
        .get(`/catalog/venues/${primaryVenueId}/menu`)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 500 on unexpected error in getFullMenu', async () => {
      vi.spyOn(catalogService, 'getFullMenu').mockRejectedValueOnce(
        new Error('Unexpected DB error')
      );

      const response = await request(app)
        .get(`/catalog/venues/${primaryVenueId}/menu`)
        .expect(500);

      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /catalog/venues/:venueId/menu/venue', () => {
    it('should return 200 with only active venue items', async () => {
      const response = await request(app)
        .get(`/catalog/venues/${primaryVenueId}/menu/venue`)
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.venueItems).toHaveLength(1);
      expect(response.body.data.venueItems[0].id).toBe(venueActiveItemId);
      expect(response.body.data.venueItems[0].name).toBe('IPA Draft');
      expect(response.body.data.partnerItems).toBeUndefined();
    });

    it('should return 400 if venueId is not a valid UUID', async () => {
      const response = await request(app)
        .get('/catalog/venues/not-a-uuid/menu/venue')
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should handle ServiceError in getVenueMenu', async () => {
      vi.spyOn(catalogService, 'getVenueMenu').mockRejectedValueOnce(
        new ServiceError(404, 'NOT_FOUND', 'Venue not found')
      );

      const response = await request(app)
        .get(`/catalog/venues/${primaryVenueId}/menu/venue`)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 500 on unexpected error in getVenueMenu', async () => {
      vi.spyOn(catalogService, 'getVenueMenu').mockRejectedValueOnce(
        new Error('Unexpected DB error')
      );

      const response = await request(app)
        .get(`/catalog/venues/${primaryVenueId}/menu/venue`)
        .expect(500);

      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /catalog/venues/:venueId/menu/partners', () => {
    it('should return 200 with only active partner items', async () => {
      const response = await request(app)
        .get(`/catalog/venues/${primaryVenueId}/menu/partners`)
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.partnerItems).toHaveLength(1);
      expect(response.body.data.partnerItems[0].id).toBe(partnerActiveItemId);
      expect(response.body.data.partnerItems[0].name).toBe('Carne Asada Taco');
      expect(response.body.data.venueItems).toBeUndefined();
    });

    it('should return 400 if venueId is not a valid UUID', async () => {
      const response = await request(app)
        .get('/catalog/venues/123-bad/menu/partners')
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should handle ServiceError in getPartnerItems', async () => {
      vi.spyOn(catalogService, 'getPartnerItems').mockRejectedValueOnce(
        new ServiceError(404, 'NOT_FOUND', 'Partners not found')
      );

      const response = await request(app)
        .get(`/catalog/venues/${primaryVenueId}/menu/partners`)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 500 on unexpected error in getPartnerItems', async () => {
      vi.spyOn(catalogService, 'getPartnerItems').mockRejectedValueOnce(
        new Error('Unexpected DB error')
      );

      const response = await request(app)
        .get(`/catalog/venues/${primaryVenueId}/menu/partners`)
        .expect(500);

      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
});
