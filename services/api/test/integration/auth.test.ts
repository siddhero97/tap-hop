import { describe, it, expect, beforeEach, vi } from 'vitest';
import request, { type Response } from 'supertest';
import { UserRole } from '@tabhop/database';
import { createApp } from '../../src/app.js';
import * as authService from '../../src/auth/auth.service.js';
import {
  createTestMerchant,
  createTestStaff,
  type MerchantTestRecordDto,
  type StaffTestRecordDto,
} from '../helpers/test-db.repository.js';

describe('Feature: User Registration, Session Login, and Logout (/auth)', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  describe('Scenario: Registering external and internal TabHop users via POST /auth/register', () => {
    it('Given a bar guest Elena, When she registers without specifying a role, Then she receives a PATRON account and an HttpOnly session cookie', async () => {
      const patronRegistrationResponse: Response = await request(app).post('/auth/register').send({
        email: 'Elena.Guest@Example.com',
        password: 'securePassword123',
        displayName: 'Elena Guest',
      });

      expect(patronRegistrationResponse.status).toBe(201);
      expect(patronRegistrationResponse.body.status).toBe('success');
      expect(patronRegistrationResponse.body.user.email).toBe('elena.guest@example.com');
      expect(patronRegistrationResponse.body.user.role).toBe(UserRole.PATRON);
      expect(patronRegistrationResponse.body.token).toBeDefined();
      expect(patronRegistrationResponse.headers['set-cookie']).toBeDefined();
    });

    it('Given a brewery taproom and a food truck partner, When their owners register as MERCHANT_ADMIN, Then each account is linked to its respective Merchant', async () => {
      const copperKettleBrewery: MerchantTestRecordDto = await createTestMerchant({
        businessName: 'Copper Kettle Brewery',
        merchantType: 'PRIMARY_VENUE',
        paypalEmail: 'payouts@copperkettle.com',
      });

      const fuegoTacoTruck: MerchantTestRecordDto = await createTestMerchant({
        businessName: 'Fuego Street Tacos',
        merchantType: 'EXTERNAL_PARTNER',
        paypalEmail: 'payouts@fuegotacos.com',
      });

      const breweryOwnerRegistration: Response = await request(app).post('/auth/register').send({
        email: 'owner@copperkettle.com',
        password: 'securePassword123',
        displayName: 'Copper Kettle Owner',
        role: UserRole.MERCHANT_ADMIN,
        merchantId: copperKettleBrewery.id,
      });

      const tacoTruckOwnerRegistration: Response = await request(app).post('/auth/register').send({
        email: 'owner@fuegotacos.com',
        password: 'securePassword123',
        displayName: 'Fuego Tacos Owner',
        role: UserRole.MERCHANT_ADMIN,
        merchantId: fuegoTacoTruck.id,
      });

      expect(breweryOwnerRegistration.status).toBe(201);
      expect(breweryOwnerRegistration.body.user.role).toBe(UserRole.MERCHANT_ADMIN);
      expect(breweryOwnerRegistration.body.user.merchantId).toBe(copperKettleBrewery.id);

      expect(tacoTruckOwnerRegistration.status).toBe(201);
      expect(tacoTruckOwnerRegistration.body.user.role).toBe(UserRole.MERCHANT_ADMIN);
      expect(tacoTruckOwnerRegistration.body.user.merchantId).toBe(fuegoTacoTruck.id);
    });

    it('Given a bartender Marco at Copper Kettle Brewery, When he registers as STAFF with his staffId, Then his account is linked to both his Staff record and the venue', async () => {
      const copperKettleBrewery: MerchantTestRecordDto = await createTestMerchant({
        businessName: 'Copper Kettle Brewery',
        merchantType: 'PRIMARY_VENUE',
        paypalEmail: 'payouts@copperkettle.com',
      });
      const bartenderMarcoRecord: StaffTestRecordDto = await createTestStaff({
        venueId: copperKettleBrewery.id,
        displayName: 'Marco Bartender',
        paypalEmail: 'marco.tips@copperkettle.com',
      });

      const bartenderMarcoRegistration: Response = await request(app).post('/auth/register').send({
        email: 'marco@copperkettle.com',
        password: 'securePassword123',
        displayName: 'Marco Bartender',
        role: UserRole.STAFF,
        staffId: bartenderMarcoRecord.id,
      });

      expect(bartenderMarcoRegistration.status).toBe(201);
      expect(bartenderMarcoRegistration.body.user.role).toBe(UserRole.STAFF);
      expect(bartenderMarcoRegistration.body.user.staffId).toBe(bartenderMarcoRecord.id);
      expect(bartenderMarcoRegistration.body.user.merchantId).toBe(copperKettleBrewery.id);
    });

    it('Given internal TabHop team members across Support, Finance, and Executive Admin, When they register, Then each holds their distinct TabHop role', async () => {
      const tabhopSupportRegistration: Response = await request(app).post('/auth/register').send({
        email: 'maya.support@tabhop.io',
        password: 'securePassword123',
        displayName: 'Maya (TabHop Support)',
        role: UserRole.PLATFORM_SUPPORT,
      });
      const tabhopFinanceRegistration: Response = await request(app).post('/auth/register').send({
        email: 'david.finance@tabhop.io',
        password: 'securePassword123',
        displayName: 'David (TabHop Finance)',
        role: UserRole.PLATFORM_FINANCE,
      });
      const tabhopExecutiveRegistration: Response = await request(app).post('/auth/register').send({
        email: 'claire.exec@tabhop.io',
        password: 'securePassword123',
        displayName: 'Claire (TabHop Executive Admin)',
        role: UserRole.PLATFORM_ADMIN,
      });

      expect(tabhopSupportRegistration.body.user.role).toBe(UserRole.PLATFORM_SUPPORT);
      expect(tabhopFinanceRegistration.body.user.role).toBe(UserRole.PLATFORM_FINANCE);
      expect(tabhopExecutiveRegistration.body.user.role).toBe(UserRole.PLATFORM_ADMIN);
    });

    it('Given an email already registered, When a second registration uses the same email, Then it returns 409 EMAIL_EXISTS', async () => {
      await request(app).post('/auth/register').send({
        email: 'elena.guest@example.com',
        password: 'securePassword123',
        displayName: 'Elena First Account',
      });

      const duplicateEmailRegistration: Response = await request(app).post('/auth/register').send({
        email: 'ELENA.GUEST@example.com',
        password: 'securePassword123',
        displayName: 'Elena Duplicate Account',
      });

      expect(duplicateEmailRegistration.status).toBe(409);
      expect(duplicateEmailRegistration.body.code).toBe('EMAIL_EXISTS');
    });

    it('Given an invalid email or short password, When POST /auth/register is called, Then it returns 400 VALIDATION_ERROR', async () => {
      const invalidRegistrationResponse: Response = await request(app).post('/auth/register').send({
        email: 'not-an-email',
        password: '123',
        displayName: '',
      });

      expect(invalidRegistrationResponse.status).toBe(400);
      expect(invalidRegistrationResponse.body.code).toBe('VALIDATION_ERROR');
    });

    it('Given an unexpected database error during registration, When POST /auth/register is called, Then it returns 500 INTERNAL_ERROR', async () => {
      vi.spyOn(authService, 'registerUser').mockRejectedValueOnce(new Error('DB crash'));

      const crashedRegistrationResponse: Response = await request(app).post('/auth/register').send({
        email: 'crash@example.com',
        password: 'securePassword123',
        displayName: 'Crash Test',
      });

      expect(crashedRegistrationResponse.status).toBe(500);
      expect(crashedRegistrationResponse.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Scenario: Logging in, inspecting profile (/auth/me), and logging out (/auth/logout)', () => {
    it('Given a registered patron Liam, When he logs in, accesses /auth/me via Bearer or Cookie, and logs out, Then his session is revoked afterward', async () => {
      await request(app).post('/auth/register').send({
        email: 'liam.patron@example.com',
        password: 'mySecretPassword99',
        displayName: 'Liam Patron',
      });

      const liamLoginResponse: Response = await request(app).post('/auth/login').send({
        email: 'liam.patron@example.com',
        password: 'mySecretPassword99',
      });

      expect(liamLoginResponse.status).toBe(200);
      expect(liamLoginResponse.body.token).toBeDefined();
      const liamSessionToken: string = liamLoginResponse.body.token as string;
      const liamSessionCookies: string = liamLoginResponse.headers['set-cookie'];

      // Access /auth/me using Bearer token
      const profileViaBearerResponse: Response = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${liamSessionToken}`);
      expect(profileViaBearerResponse.status).toBe(200);
      expect(profileViaBearerResponse.body.user.email).toBe('liam.patron@example.com');

      // Access /auth/me using session cookie
      const profileViaCookieResponse: Response = await request(app)
        .get('/auth/me')
        .set('Cookie', liamSessionCookies);
      expect(profileViaCookieResponse.status).toBe(200);
      expect(profileViaCookieResponse.body.user.email).toBe('liam.patron@example.com');

      // Logout
      const logoutResponse: Response = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${liamSessionToken}`);
      expect(logoutResponse.status).toBe(200);

      // Token should no longer be valid after logout
      const profileAfterLogoutResponse: Response = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${liamSessionToken}`);
      expect(profileAfterLogoutResponse.status).toBe(401);
      expect(profileAfterLogoutResponse.body.code).toBe('UNAUTHORIZED');
    });

    it('Given a registered user, When login is attempted with a wrong password or malformed body, Then it returns 401 or 400', async () => {
      await request(app).post('/auth/register').send({
        email: 'wrongpass@example.com',
        password: 'correctPassword123',
        displayName: 'Patron User',
      });

      const wrongPasswordLoginResponse: Response = await request(app).post('/auth/login').send({
        email: 'wrongpass@example.com',
        password: 'wrongPassword999',
      });
      expect(wrongPasswordLoginResponse.status).toBe(401);
      expect(wrongPasswordLoginResponse.body.code).toBe('INVALID_CREDENTIALS');

      const malformedLoginResponse: Response = await request(app).post('/auth/login').send({
        email: 'not-an-email',
        password: '',
      });
      expect(malformedLoginResponse.status).toBe(400);
      expect(malformedLoginResponse.body.code).toBe('VALIDATION_ERROR');
    });

    it('Given an unauthenticated client, When calling /auth/me or /auth/logout, Then it returns 401 UNAUTHORIZED', async () => {
      const unauthenticatedProfileResponse: Response = await request(app).get('/auth/me');
      expect(unauthenticatedProfileResponse.status).toBe(401);

      const unauthenticatedLogoutResponse: Response = await request(app).post('/auth/logout');
      expect(unauthenticatedLogoutResponse.status).toBe(401);
    });

    it('Given unexpected service failures in POST /auth/login or POST /auth/logout, When called, Then 500 INTERNAL_ERROR is returned', async () => {
      const patronRegistration: Response = await request(app).post('/auth/register').send({
        email: 'errtest@example.com',
        password: 'correctPassword123',
        displayName: 'Error Test Patron',
      });
      const patronSessionToken: string = patronRegistration.body.token as string;

      vi.spyOn(authService, 'loginUser').mockRejectedValueOnce(new Error('Unexpected login error'));
      const failedLoginResponse: Response = await request(app).post('/auth/login').send({
        email: 'errtest@example.com',
        password: 'correctPassword123',
      });
      expect(failedLoginResponse.status).toBe(500);

      vi.spyOn(authService, 'logoutSession').mockRejectedValueOnce(
        new Error('Unexpected logout error')
      );
      const failedLogoutResponse: Response = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${patronSessionToken}`);
      expect(failedLogoutResponse.status).toBe(500);
    });
  });
});
