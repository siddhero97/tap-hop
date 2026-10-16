import crypto from 'crypto';
import { UserRole } from '@tabhop/database';
import { ServiceError } from '../lib/service-error.js';
import { logger } from '../lib/logger.js';
import type { RegisterRequest, LoginRequest } from './auth.validator.js';
import type {
  AuthenticatedUser,
  MerchantLookupDto,
  SessionRecordDto,
  SessionWithUserRecordDto,
  StaffLookupDto,
  UserRecordDto,
} from './auth.model.js';
import {
  createSessionRecord,
  createUserRecord,
  findMerchantById,
  findSessionByTokenHash,
  findSessionWithUserByTokenHash,
  findStaffById,
  findUserByEmail,
  revokeSessionById,
} from './auth.repository.js';

export type {
  AuthenticatedUser,
  MerchantLookupDto,
  SessionRecordDto,
  SessionWithUserRecordDto,
  StaffLookupDto,
  UserRecordDto,
};

const SCRYPT_KEYLEN: number = 64;
const SESSION_TTL_MS: number = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Hash a plaintext password with a random 16-byte salt using Node's built-in scrypt.
 */
export function hashPassword(password: string): string {
  const salt: string = crypto.randomBytes(16).toString('hex');
  const derivedKey: string = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derivedKey}`;
}

/**
 * Constant-time verification of a plaintext password against a stored salt:hash string.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts: string[] = storedHash.split(':');
  let isValid: boolean = false;

  if (parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1])) {
    const [salt, keyHex] = parts;
    const keyBuffer: Buffer = Buffer.from(keyHex, 'hex');
    if (keyBuffer.length === SCRYPT_KEYLEN) {
      const derivedBuffer: Buffer = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
      isValid = crypto.timingSafeEqual(keyBuffer, derivedBuffer);
    }
  }

  return isValid;
}

/**
 * Hash an opaque session token with SHA-256 before storing or querying in the database.
 */
export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function sanitizeUser(user: UserRecordDto): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    merchantId: user.merchantId,
    staffId: user.staffId,
  };
}

async function createSessionForUser(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const rawToken: string = crypto.randomBytes(32).toString('hex');
  const tokenHash: string = hashSessionToken(rawToken);
  const expiresAt: Date = new Date(Date.now() + SESSION_TTL_MS);

  await createSessionRecord({
    userId,
    tokenHash,
    expiresAt,
  });

  return { token: rawToken, expiresAt };
}

/**
 * Register a new user account and issue a session token.
 */
export async function registerUser(input: RegisterRequest): Promise<{
  user: AuthenticatedUser;
  token: string;
  expiresAt: Date;
}> {
  const existing: UserRecordDto | null = await findUserByEmail(input.email);

  if (existing) {
    logger.warn({ email: input.email, role: input.role }, 'User registration failed: email already exists');
    throw new ServiceError(409, 'EMAIL_EXISTS', 'A user with this email already exists');
  }

  let resolvedMerchantId: string | null = input.merchantId ?? null;
  const resolvedStaffId: string | null = input.staffId ?? null;

  if (input.role === UserRole.MERCHANT_ADMIN) {
    if (!resolvedMerchantId) {
      throw new ServiceError(
        400,
        'INVALID_MERCHANT',
        'MERCHANT_ADMIN requires a valid merchantId'
      );
    }
    const merchant: MerchantLookupDto | null = await findMerchantById(resolvedMerchantId);
    if (!merchant) {
      throw new ServiceError(
        400,
        'INVALID_MERCHANT',
        'MERCHANT_ADMIN requires a valid merchantId'
      );
    }
  }

  if (input.role === UserRole.STAFF) {
    if (!resolvedStaffId) {
      throw new ServiceError(400, 'INVALID_STAFF', 'STAFF role requires a valid staffId');
    }
    const staff: StaffLookupDto | null = await findStaffById(resolvedStaffId);
    if (!staff) {
      throw new ServiceError(400, 'INVALID_STAFF', 'STAFF role requires a valid staffId');
    }
    resolvedMerchantId = staff.venueId;
  }

  const passwordHash: string = hashPassword(input.password);

  const user: UserRecordDto = await createUserRecord({
    email: input.email,
    passwordHash,
    displayName: input.displayName,
    role: input.role,
    merchantId: resolvedMerchantId,
    staffId: resolvedStaffId,
  });

  const { token, expiresAt }: { token: string; expiresAt: Date } = await createSessionForUser(user.id);

  logger.info(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      merchantId: user.merchantId,
      staffId: user.staffId,
    },
    'User registered and session created'
  );

  return {
    user: sanitizeUser(user),
    token,
    expiresAt,
  };
}

/**
 * Authenticate a user by email and password and issue a session token.
 */
export async function loginUser(input: LoginRequest): Promise<{
  user: AuthenticatedUser;
  token: string;
  expiresAt: Date;
}> {
  const user: UserRecordDto | null = await findUserByEmail(input.email);

  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    logger.warn(
      { email: input.email, reason: 'INVALID_CREDENTIALS' },
      'Failed login attempt: invalid credentials'
    );
    throw new ServiceError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (!user.isActive) {
    logger.warn(
      { userId: user.id, email: user.email, reason: 'USER_INACTIVE' },
      'Failed login attempt: deactivated user account'
    );
    throw new ServiceError(403, 'USER_INACTIVE', 'User account is deactivated');
  }

  const { token, expiresAt }: { token: string; expiresAt: Date } = await createSessionForUser(user.id);

  logger.info(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      merchantId: user.merchantId,
    },
    'User logged in and session created'
  );

  return {
    user: sanitizeUser(user),
    token,
    expiresAt,
  };
}

/**
 * Revoke an active session token on logout.
 */
export async function logoutSession(rawToken: string): Promise<void> {
  const tokenHash: string = hashSessionToken(rawToken);
  const session: SessionRecordDto | null = await findSessionByTokenHash(tokenHash);

  if (session && session.revokedAt === null) {
    await revokeSessionById(session.id, new Date());
    logger.info(
      { sessionId: session.id, userId: session.userId },
      'User session revoked on logout'
    );
  }
}

/**
 * Verify a raw session token and return the associated active user, or null if invalid/expired.
 */
export async function authenticateToken(rawToken: string): Promise<{
  user: AuthenticatedUser;
  sessionId: string;
  rawToken: string;
} | null> {
  const tokenHash: string = hashSessionToken(rawToken);
  const session: SessionWithUserRecordDto | null =
    await findSessionWithUserByTokenHash(tokenHash);

  let authResult: {
    user: AuthenticatedUser;
    sessionId: string;
    rawToken: string;
  } | null = null;

  if (
    session &&
    session.revokedAt === null &&
    session.expiresAt > new Date() &&
    session.user.isActive
  ) {
    authResult = {
      user: sanitizeUser(session.user),
      sessionId: session.id,
      rawToken,
    };
  }

  return authResult;
}
