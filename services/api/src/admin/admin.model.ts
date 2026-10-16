/**
 * Database record DTOs and view models for Platform Administration.
 */

export interface PlatformSettingsRecordDto {
  id: string;
  platformFeeBps: number;
  taxRateBps: number;
  updatedByUserId: string | null;
  updatedAt: Date;
}

export interface PlatformSettingsView {
  platformFeeBps: number;
  taxRateBps: number;
  updatedByUserId: string | null;
  updatedAt: Date | null;
}
