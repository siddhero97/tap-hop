import { describe, it, expect, beforeEach, vi } from 'vitest';
import request, { type Response } from 'supertest';
import { UserRole } from '@tabhop/database';
import { Decimal } from '@prisma/client/runtime/library';
import { createApp } from '../../src/app.js';
import * as adminService from '../../src/admin/admin.service.js';
import {
  createTestItem,
  createTestMerchant,
  createTestStaff,
  type ItemTestRecordDto,
  type MerchantTestRecordDto,
  type StaffTestRecordDto,
} from '../helpers/test-db.repository.js';

describe('Feature: TabHop Multi-Role Admin Panel & Dynamic Order Pricing (/admin/settings)', () => {
  let app: ReturnType<typeof createApp>;

  // Internal TabHop team tokens (3 distinct internal roles)
  let tabhopExecutiveAdminToken: string;
  let tabhopFinanceAnalystToken: string;
  let tabhopSupportSpecialistToken: string;

  // External venue, partner, staff, and patron tokens
  let copperKettleBreweryOwnerToken: string;
  let bartenderMarcoToken: string;
  let patronElenaToken: string;

  // Venue & Catalog Fixtures
  let copperKettleBreweryId: string;
  let hazyIpaPintItemId: string;

  beforeEach(async () => {
    app = createApp();

    const copperKettleBrewery: MerchantTestRecordDto = await createTestMerchant({
      businessName: 'Copper Kettle Brewery',
      merchantType: 'PRIMARY_VENUE',
      paypalEmail: 'payouts@copperkettle.com',
    });
    copperKettleBreweryId = copperKettleBrewery.id;

    const hazyIpaPintItem: ItemTestRecordDto = await createTestItem({
      merchantId: copperKettleBrewery.id,
      name: 'Hazy IPA Pint',
      description: 'House double dry-hopped IPA',
      price: new Decimal('10.00'),
      category: 'Drinks',
      isActive: true,
    });
    hazyIpaPintItemId = hazyIpaPintItem.id;

    const bartenderMarcoStaff: StaffTestRecordDto = await createTestStaff({
      venueId: copperKettleBrewery.id,
      displayName: 'Marco Bartender',
      paypalEmail: 'marco@copperkettle.com',
    });

    // 1. TabHop Executive Admin (PLATFORM_ADMIN) — full read + write access to fee & tax BPS
    const tabhopExecutiveAdminRegistration: Response = await request(app).post('/auth/register').send({
      email: 'claire.executive@tabhop.io',
      password: 'platformAdminPassword123',
      displayName: 'Claire (TabHop Executive Admin)',
      role: UserRole.PLATFORM_ADMIN,
    });
    tabhopExecutiveAdminToken = tabhopExecutiveAdminRegistration.body.token;

    // 2. TabHop Finance Analyst (PLATFORM_FINANCE) — read settings + write taxRateBps only
    const tabhopFinanceAnalystRegistration: Response = await request(app).post('/auth/register').send({
      email: 'david.finance@tabhop.io',
      password: 'platformFinancePassword123',
      displayName: 'David (TabHop Finance Analyst)',
      role: UserRole.PLATFORM_FINANCE,
    });
    tabhopFinanceAnalystToken = tabhopFinanceAnalystRegistration.body.token;

    // 3. TabHop Support Specialist (PLATFORM_SUPPORT) — read-only access to settings
    const tabhopSupportSpecialistRegistration: Response = await request(app).post('/auth/register').send({
      email: 'maya.support@tabhop.io',
      password: 'platformSupportPassword123',
      displayName: 'Maya (TabHop Support Specialist)',
      role: UserRole.PLATFORM_SUPPORT,
    });
    tabhopSupportSpecialistToken = tabhopSupportSpecialistRegistration.body.token;

    // 4. External Brewery Merchant Admin (MERCHANT_ADMIN)
    const copperKettleOwnerRegistration: Response = await request(app).post('/auth/register').send({
      email: 'owner@copperkettle.com',
      password: 'merchantAdminPassword123',
      displayName: 'Copper Kettle Brewery Owner',
      role: UserRole.MERCHANT_ADMIN,
      merchantId: copperKettleBrewery.id,
    });
    copperKettleBreweryOwnerToken = copperKettleOwnerRegistration.body.token;

    // 5. External Venue Bartender (STAFF)
    const bartenderMarcoRegistration: Response = await request(app).post('/auth/register').send({
      email: 'marco@copperkettle.com',
      password: 'staffPassword123',
      displayName: 'Marco Bartender',
      role: UserRole.STAFF,
      staffId: bartenderMarcoStaff.id,
    });
    bartenderMarcoToken = bartenderMarcoRegistration.body.token;

    // 6. Bar Patron (PATRON)
    const patronElenaRegistration: Response = await request(app).post('/auth/register').send({
      email: 'elena.patron@guest.com',
      password: 'patronPassword123',
      displayName: 'Elena Patron',
      role: UserRole.PATRON,
    });
    patronElenaToken = patronElenaRegistration.body.token;
  });

  describe('Scenario: Rejecting unauthenticated and external users from /admin/settings', () => {
    it('Given an unauthenticated client, When requesting GET or PATCH /admin/settings, Then 401 UNAUTHORIZED is returned', async () => {
      const unauthenticatedGetResponse: Response = await request(app).get('/admin/settings');
      expect(unauthenticatedGetResponse.status).toBe(401);
      expect(unauthenticatedGetResponse.body.code).toBe('UNAUTHORIZED');

      const unauthenticatedPatchResponse: Response = await request(app)
        .patch('/admin/settings')
        .send({ platformFeeBps: 400 });
      expect(unauthenticatedPatchResponse.status).toBe(401);
      expect(unauthenticatedPatchResponse.body.code).toBe('UNAUTHORIZED');
    });

    it('Given external users (patronElena, bartenderMarco, copperKettleBreweryOwner), When they attempt to read or modify /admin/settings, Then 403 FORBIDDEN is returned', async () => {
      const externalUserTokens: string[] = [
        patronElenaToken,
        bartenderMarcoToken,
        copperKettleBreweryOwnerToken,
      ];

      for (const externalToken of externalUserTokens) {
        const forbiddenGetResponse: Response = await request(app)
          .get('/admin/settings')
          .set('Authorization', `Bearer ${externalToken}`);
        expect(forbiddenGetResponse.status).toBe(403);
        expect(forbiddenGetResponse.body.code).toBe('FORBIDDEN');

        const forbiddenPatchResponse: Response = await request(app)
          .patch('/admin/settings')
          .set('Authorization', `Bearer ${externalToken}`)
          .send({ platformFeeBps: 400, taxRateBps: 700 });
        expect(forbiddenPatchResponse.status).toBe(403);
        expect(forbiddenPatchResponse.body.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('Scenario: Differentiated permissions among internal TabHop roles (Support vs Finance vs Executive Admin)', () => {
    it('Given TabHop Support Specialist Maya (PLATFORM_SUPPORT), When she views /admin/settings it succeeds (200), When she attempts to update settings it is rejected (403)', async () => {
      const supportViewSettingsResponse: Response = await request(app)
        .get('/admin/settings')
        .set('Authorization', `Bearer ${tabhopSupportSpecialistToken}`);

      expect(supportViewSettingsResponse.status).toBe(200);
      expect(supportViewSettingsResponse.body.settings.platformFeeBps).toBe(500);
      expect(supportViewSettingsResponse.body.settings.taxRateBps).toBe(800);

      const supportModifyTaxAttempt: Response = await request(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${tabhopSupportSpecialistToken}`)
        .send({ taxRateBps: 825 });

      expect(supportModifyTaxAttempt.status).toBe(403);
      expect(supportModifyTaxAttempt.body.code).toBe('FORBIDDEN');
    });

    it('Given TabHop Finance Analyst David (PLATFORM_FINANCE), When he updates taxRateBps it succeeds (200), When he attempts to modify commercial platformFeeBps it is rejected (403)', async () => {
      const financeUpdateTaxResponse: Response = await request(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${tabhopFinanceAnalystToken}`)
        .send({ taxRateBps: 850 });

      expect(financeUpdateTaxResponse.status).toBe(200);
      expect(financeUpdateTaxResponse.body.settings.taxRateBps).toBe(850);
      expect(financeUpdateTaxResponse.body.settings.platformFeeBps).toBe(500);

      const financeModifyPlatformFeeAttempt: Response = await request(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${tabhopFinanceAnalystToken}`)
        .send({ platformFeeBps: 300 });

      expect(financeModifyPlatformFeeAttempt.status).toBe(403);
      expect(financeModifyPlatformFeeAttempt.body.code).toBe('FORBIDDEN');
    });

    it('Given TabHop Executive Admin Claire (PLATFORM_ADMIN), When she updates both platformFeeBps and taxRateBps, Then both rates are persisted in the database', async () => {
      const executiveUpdateResponse: Response = await request(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${tabhopExecutiveAdminToken}`)
        .send({
          platformFeeBps: 650,
          taxRateBps: 925,
        });

      expect(executiveUpdateResponse.status).toBe(200);
      expect(executiveUpdateResponse.body.settings.platformFeeBps).toBe(650);
      expect(executiveUpdateResponse.body.settings.taxRateBps).toBe(925);
      expect(executiveUpdateResponse.body.settings.updatedByUserId).toBeDefined();

      const verifyPersistedSettingsResponse: Response = await request(app)
        .get('/admin/settings')
        .set('Authorization', `Bearer ${tabhopExecutiveAdminToken}`);
      expect(verifyPersistedSettingsResponse.status).toBe(200);
      expect(verifyPersistedSettingsResponse.body.settings.platformFeeBps).toBe(650);
      expect(verifyPersistedSettingsResponse.body.settings.taxRateBps).toBe(925);
    });
  });

  describe('Scenario: Validating basis-point bounds and applying live rates to new bar orders', () => {
    it('Given invalid basis-point values (negative, > 10000, or empty payload), When PLATFORM_ADMIN submits PATCH /admin/settings, Then 400 VALIDATION_ERROR is returned', async () => {
      const negativeFeeAttempt: Response = await request(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${tabhopExecutiveAdminToken}`)
        .send({ platformFeeBps: -50 });
      expect(negativeFeeAttempt.status).toBe(400);
      expect(negativeFeeAttempt.body.code).toBe('VALIDATION_ERROR');

      const excessiveTaxAttempt: Response = await request(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${tabhopExecutiveAdminToken}`)
        .send({ taxRateBps: 12000 });
      expect(excessiveTaxAttempt.status).toBe(400);
      expect(excessiveTaxAttempt.body.code).toBe('VALIDATION_ERROR');

      const emptyPayloadAttempt: Response = await request(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${tabhopExecutiveAdminToken}`)
        .send({});
      expect(emptyPayloadAttempt.status).toBe(400);
      expect(emptyPayloadAttempt.body.code).toBe('VALIDATION_ERROR');
    });

    it('Given PLATFORM_ADMIN updates platformFeeBps to 1000 (10%) and taxRateBps to 1000 (10%), When patron Elena places a craft IPA order, Then the order totals reflect the updated rates', async () => {
      const adminRateChangeResponse: Response = await request(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${tabhopExecutiveAdminToken}`)
        .send({
          platformFeeBps: 1000,
          taxRateBps: 1000,
        });
      expect(adminRateChangeResponse.status).toBe(200);

      // Patron Elena orders 2 Hazy IPA Pints ($10.00 each = 2000 cents subtotal) at Table 12
      const tableTwelveCraftIpaOrderResponse: Response = await request(app)
        .post('/orders')
        .send({
          venueId: copperKettleBreweryId,
          tableNumber: '12',
          lines: [{ itemId: hazyIpaPintItemId, quantity: 2 }],
        });

      expect(tableTwelveCraftIpaOrderResponse.status).toBe(201);
      expect(tableTwelveCraftIpaOrderResponse.body.order.subtotalCents).toBe(2000);
      expect(tableTwelveCraftIpaOrderResponse.body.order.taxCents).toBe(200); // 10% of 2000
      expect(tableTwelveCraftIpaOrderResponse.body.order.platformFeeCents).toBe(200); // 10% of 2000
      expect(tableTwelveCraftIpaOrderResponse.body.order.totalCents).toBe(2400);
    });

    it('Given unexpected database errors in GET or PATCH /admin/settings, When invoked, Then 500 INTERNAL_ERROR is returned', async () => {
      vi.spyOn(adminService, 'getPlatformSettings').mockRejectedValueOnce(
        new Error('DB connection lost')
      );
      const getErrorResponse: Response = await request(app)
        .get('/admin/settings')
        .set('Authorization', `Bearer ${tabhopExecutiveAdminToken}`);
      expect(getErrorResponse.status).toBe(500);
      expect(getErrorResponse.body.code).toBe('INTERNAL_ERROR');

      vi.spyOn(adminService, 'updatePlatformSettings').mockRejectedValueOnce(
        new Error('DB write failed')
      );
      const patchErrorResponse: Response = await request(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${tabhopExecutiveAdminToken}`)
        .send({ platformFeeBps: 500 });
      expect(patchErrorResponse.status).toBe(500);
      expect(patchErrorResponse.body.code).toBe('INTERNAL_ERROR');
    });
  });
});
