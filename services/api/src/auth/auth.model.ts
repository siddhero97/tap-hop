import { UserRole } from '@tabhop/database';
import type { Email } from '../lib/email.js';

/**
 * Database record DTOs and view models for Authentication & RBAC.
 */

export interface AuthenticatedUser {
  id: string;
  email: Email;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  merchantId: string | null;
  staffId: string | null;
}

export interface UserRecordDto {
  id: string;
  email: Email;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  merchantId: string | null;
  staffId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MerchantLookupDto {
  id: string;
}

export interface StaffLookupDto {
  id: string;
  venueId: string;
}

export interface SessionRecordDto {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt?: Date;
}

export interface SessionWithUserRecordDto extends SessionRecordDto {
  user: UserRecordDto;
}
