import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import type { PrismaClient as MockPrismaClient } from '../setup.js';
import {
  getPlatformSettings,
  updatePlatformSettings,
  DEFAULT_PLATFORM_FEE_BPS,
  DEFAULT_TAX_RATE_BPS,
  type PlatformSettingsView,
} from '../../src/admin/admin.service.js';
import { UpdatePlatformSettingsSchema } from '../../src/admin/admin.validator.js';

vi.mock('@tabhop/database', async () => {
  const { PrismaClient, UserRole: MockUserRole }: typeof import('../setup.js') = await import('../setup.js');
  return {
    prisma: new PrismaClient(),
    UserRole: MockUserRole,
  };
});

describe('Feature: TabHop Admin Settings & Internal Role Hierarchy (Unit)', () => {
  let mockPrisma: MockPrismaClient;

  const tabhopExecutiveAdmin: { id: string; role: "PLATFORM_ADMIN"; } = {
    id: 'tabhop-executive-admin-claire',
    role: UserRole.PLATFORM_ADMIN,
  };

  const tabhopFinanceAnalyst: { id: string; role: "PLATFORM_FINANCE"; } = {
    id: 'tabhop-finance-analyst-david',
    role: UserRole.PLATFORM_FINANCE,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db: typeof import('@tabhop/database') = await import('@tabhop/database');
    mockPrisma = db.prisma as unknown as MockPrismaClient;
  });

  describe('Scenario: Validating basis-point updates via UpdatePlatformSettingsSchema', () => {
    it('Given valid platformFeeBps and taxRateBps values, When parsed, Then UpdatePlatformSettingsSchema succeeds', () => {
      expect(
        UpdatePlatformSettingsSchema.parse({ platformFeeBps: 650, taxRateBps: 825 })
      ).toEqual({ platformFeeBps: 650, taxRateBps: 825 });

      expect(UpdatePlatformSettingsSchema.parse({ platformFeeBps: 0 })).toEqual({
        platformFeeBps: 0,
      });
    });

    it('Given negative, >10000, fractional, or empty basis-point payloads, When parsed, Then validation fails', () => {
      expect(UpdatePlatformSettingsSchema.safeParse({}).success).toBe(false);
      expect(UpdatePlatformSettingsSchema.safeParse({ platformFeeBps: -1 }).success).toBe(false);
      expect(UpdatePlatformSettingsSchema.safeParse({ taxRateBps: -100 }).success).toBe(false);
      expect(UpdatePlatformSettingsSchema.safeParse({ platformFeeBps: 10001 }).success).toBe(false);
      expect(UpdatePlatformSettingsSchema.safeParse({ taxRateBps: 15000 }).success).toBe(false);
      expect(UpdatePlatformSettingsSchema.safeParse({ platformFeeBps: 5.5 }).success).toBe(false);
    });
  });

  describe('Scenario: Reading platform settings with default fallback', () => {
    it('Given no PlatformSettings row in the database yet, When getPlatformSettings is called, Then it returns 500 BPS platform fee and 800 BPS tax rate', async () => {
      mockPrisma.platformSettings.findUnique.mockResolvedValue(null);

      const defaultPlatformSettings: PlatformSettingsView = await getPlatformSettings();
      expect(defaultPlatformSettings).toEqual({
        platformFeeBps: DEFAULT_PLATFORM_FEE_BPS,
        taxRateBps: DEFAULT_TAX_RATE_BPS,
        updatedByUserId: null,
        updatedAt: null,
      });
    });

    it('Given configured PlatformSettings in the database, When getPlatformSettings is called, Then it returns the stored BPS rates', async () => {
      const updatedTimestamp: Date = new Date();
      mockPrisma.platformSettings.findUnique.mockResolvedValue({
        id: 'default',
        platformFeeBps: 600,
        taxRateBps: 900,
        updatedByUserId: tabhopExecutiveAdmin.id,
        updatedAt: updatedTimestamp,
      });

      const storedPlatformSettings: PlatformSettingsView = await getPlatformSettings();
      expect(storedPlatformSettings).toEqual({
        platformFeeBps: 600,
        taxRateBps: 900,
        updatedByUserId: tabhopExecutiveAdmin.id,
        updatedAt: updatedTimestamp,
      });
    });
  });

  describe('Scenario: Differentiated write permissions between PLATFORM_ADMIN and PLATFORM_FINANCE', () => {
    it('Given a TabHop Executive Admin (PLATFORM_ADMIN), When updating platformFeeBps, Then the update succeeds and preserves existing taxRateBps', async () => {
      const updatedTimestamp: Date = new Date();
      mockPrisma.platformSettings.findUnique.mockResolvedValue(null);
      mockPrisma.platformSettings.upsert.mockResolvedValue({
        id: 'default',
        platformFeeBps: 450,
        taxRateBps: 800,
        updatedByUserId: tabhopExecutiveAdmin.id,
        updatedAt: updatedTimestamp,
      });

      const updatedSettings: PlatformSettingsView = await updatePlatformSettings(
        { platformFeeBps: 450 },
        tabhopExecutiveAdmin
      );
      expect(updatedSettings.platformFeeBps).toBe(450);
      expect(updatedSettings.taxRateBps).toBe(800);
      expect(updatedSettings.updatedByUserId).toBe(tabhopExecutiveAdmin.id);
    });

    it('Given a TabHop Finance Analyst (PLATFORM_FINANCE), When updating taxRateBps, Then the update succeeds', async () => {
      const updatedTimestamp: Date = new Date();
      mockPrisma.platformSettings.findUnique.mockResolvedValue({
        id: 'default',
        platformFeeBps: 500,
        taxRateBps: 800,
        updatedByUserId: tabhopExecutiveAdmin.id,
        updatedAt: updatedTimestamp,
      });
      mockPrisma.platformSettings.upsert.mockResolvedValue({
        id: 'default',
        platformFeeBps: 500,
        taxRateBps: 875,
        updatedByUserId: tabhopFinanceAnalyst.id,
        updatedAt: updatedTimestamp,
      });

      const updatedTaxSettings: PlatformSettingsView = await updatePlatformSettings(
        { taxRateBps: 875 },
        tabhopFinanceAnalyst
      );
      expect(updatedTaxSettings.taxRateBps).toBe(875);
      expect(updatedTaxSettings.platformFeeBps).toBe(500);
      expect(updatedTaxSettings.updatedByUserId).toBe(tabhopFinanceAnalyst.id);
    });

    it('Given a TabHop Finance Analyst (PLATFORM_FINANCE), When attempting to modify commercial platformFeeBps, Then it throws 403 FORBIDDEN', async () => {
      await expect(
        updatePlatformSettings({ platformFeeBps: 300 }, tabhopFinanceAnalyst)
      ).rejects.toMatchObject({
        httpStatus: 403,
        code: 'FORBIDDEN',
      });
    });

    it('Given out-of-range BPS values passed directly to updatePlatformSettings, When invoked, Then it throws 400 INVALID_SETTINGS', async () => {
      await expect(
        updatePlatformSettings({ platformFeeBps: -10 }, tabhopExecutiveAdmin)
      ).rejects.toMatchObject({
        httpStatus: 400,
        code: 'INVALID_SETTINGS',
      });

      await expect(
        updatePlatformSettings({ taxRateBps: 10001 }, tabhopExecutiveAdmin)
      ).rejects.toMatchObject({
        httpStatus: 400,
        code: 'INVALID_SETTINGS',
      });
    });
  });
});
