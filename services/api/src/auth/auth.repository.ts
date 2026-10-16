import { prisma, UserRole } from '@tabhop/database';
import type {
  MerchantLookupDto,
  SessionRecordDto,
  SessionWithUserRecordDto,
  StaffLookupDto,
  UserRecordDto,
} from './auth.model.js';

/**
 * Database models accessed by the Auth module:
 * - User
 * - Session
 * - Merchant (for MERCHANT_ADMIN association lookup)
 * - Staff (for STAFF association lookup)
 */
export type AuthDatabaseClient = Pick<
  typeof prisma,
  'user' | 'session' | 'merchant' | 'staff'
>;

const db: AuthDatabaseClient = prisma;

export async function createSessionRecord(data: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<SessionRecordDto> {
  const createdSession: SessionRecordDto = await db.session.create({
    data,
  });
  return createdSession;
}

export async function findUserByEmail(
  email: string
): Promise<UserRecordDto | null> {
  const existing: UserRecordDto | null = await db.user.findUnique({
    where: { email },
  });
  return existing;
}

export async function findMerchantById(
  id: string
): Promise<MerchantLookupDto | null> {
  const merchant: MerchantLookupDto | null = await db.merchant.findUnique({
    where: { id },
  });
  return merchant;
}

export async function findStaffById(
  id: string
): Promise<StaffLookupDto | null> {
  const staff: StaffLookupDto | null = await db.staff.findUnique({
    where: { id },
  });
  return staff;
}

export async function createUserRecord(data: {
  email: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  merchantId: string | null;
  staffId: string | null;
}): Promise<UserRecordDto> {
  const user: UserRecordDto = await db.user.create({
    data,
  });
  return user;
}

export async function findSessionByTokenHash(
  tokenHash: string
): Promise<SessionRecordDto | null> {
  const session: SessionRecordDto | null = await db.session.findUnique({
    where: { tokenHash },
  });
  return session;
}

export async function revokeSessionById(
  id: string,
  revokedAt: Date
): Promise<SessionRecordDto> {
  const updatedSession: SessionRecordDto = await db.session.update({
    where: { id },
    data: { revokedAt },
  });
  return updatedSession;
}

export async function findSessionWithUserByTokenHash(
  tokenHash: string
): Promise<SessionWithUserRecordDto | null> {
  const session: SessionWithUserRecordDto | null = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  return session;
}
