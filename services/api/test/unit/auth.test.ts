import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import type { PrismaClient as MockPrismaClient } from '../setup.js';
import {
  hashPassword,
  verifyPassword,
  hashSessionToken,
  registerUser,
  loginUser,
  logoutSession,
  authenticateToken,
  type AuthenticatedUser,
} from '../../src/auth/auth.service.js';
import { RegisterSchema, LoginSchema } from '../../src/auth/auth.validator.js';
import {
  extractTokenFromRequest,
  authMiddleware,
  requireAuth,
  requireRole,
} from '../../src/middleware/auth.js';

vi.mock('@tabhop/database', async () => {
  const { PrismaClient, UserRole: MockUserRole }: typeof import('../setup.js') = await import('../setup.js');
  return {
    prisma: new PrismaClient(),
    UserRole: MockUserRole,
  };
});

describe('Feature: Authentication & Multi-Role Access Control (Unit)', () => {
  let mockPrisma: MockPrismaClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db: typeof import('@tabhop/database') = await import('@tabhop/database');
    mockPrisma = db.prisma as unknown as MockPrismaClient;
  });

  describe('Scenario: Cryptographic password and session token hashing', () => {
    it('Given a plaintext password, When hashed with scrypt, Then verifyPassword succeeds for the matching password and rejects wrong passwords', () => {
      const patronPasswordHash: string = hashPassword('CorrectHorseBatteryStaple!');
      expect(patronPasswordHash).toContain(':');
      expect(verifyPassword('CorrectHorseBatteryStaple!', patronPasswordHash)).toBe(true);
      expect(verifyPassword('WrongPassword123!', patronPasswordHash)).toBe(false);
    });

    it('Given malformed password hashes in storage, When verifyPassword is called, Then it safely returns false', () => {
      expect(verifyPassword('password123', 'malformed-no-colon')).toBe(false);
      expect(verifyPassword('password123', ':missing-salt')).toBe(false);
      expect(verifyPassword('password123', 'salt-only:')).toBe(false);
      expect(verifyPassword('password123', 'abcd:1234')).toBe(false);
    });

    it('Given a session token, When hashed with SHA-256, Then hashSessionToken produces a deterministic 64-char hex digest', () => {
      const firstDigest: string = hashSessionToken('tabhop-session-token-alpha');
      const secondDigest: string = hashSessionToken('tabhop-session-token-alpha');
      const differentDigest: string = hashSessionToken('tabhop-session-token-beta');
      expect(firstDigest).toBe(secondDigest);
      expect(firstDigest).not.toBe(differentDigest);
      expect(firstDigest).toHaveLength(64);
    });
  });

  describe('Scenario: Validating registration and login payloads', () => {
    it('Given an unnormalized email and no role in RegisterSchema, When parsed, Then email is trimmed/lowercased and role defaults to PATRON', () => {
      const validatedPatronRegistration: { email: string; password: string; displayName: string; role: "PATRON" | "STAFF" | "MERCHANT_ADMIN" | "PLATFORM_SUPPORT" | "PLATFORM_FINANCE" | "PLATFORM_ADMIN"; merchantId?: string | undefined; staffId?: string | undefined; } = RegisterSchema.parse({
        email: '  Elena.Patron@Example.COM ',
        password: 'password123',
        displayName: 'Elena Patron',
      });
      expect(validatedPatronRegistration.email).toBe('elena.patron@example.com');
      expect(validatedPatronRegistration.role).toBe(UserRole.PATRON);
    });

    it('Given a password shorter than 8 characters, When validated with RegisterSchema, Then validation fails', () => {
      const shortPasswordAttempt: ReturnType<typeof RegisterSchema.safeParse> = RegisterSchema.safeParse({
        email: 'elena.patron@example.com',
        password: 'short',
        displayName: 'Elena Patron',
      });
      expect(shortPasswordAttempt.success).toBe(false);
    });

    it('Given an uppercase email with whitespace in LoginSchema, When parsed, Then email is normalized', () => {
      const validatedAdminLogin: { email: string; password: string; } = LoginSchema.parse({
        email: '  Executive.Admin@TabHop.io ',
        password: 'secretpassword',
      });
      expect(validatedAdminLogin.email).toBe('executive.admin@tabhop.io');
    });
  });

  describe('Scenario: Registering external and internal TabHop users', () => {
    it('Given a new bar patron, When registerUser is called, Then a PATRON account and session are created without exposing passwordHash', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'patron-elena-id',
        email: 'elena.patron@example.com',
        passwordHash: 'salt:hash',
        displayName: 'Elena Patron',
        role: UserRole.PATRON,
        isActive: true,
        merchantId: null,
        staffId: null,
      });
      mockPrisma.session.create.mockResolvedValue({
        id: 'patron-elena-session-id',
        userId: 'patron-elena-id',
      });

      const patronElenaRegistration: { user: AuthenticatedUser; token: string; expiresAt: Date } = await registerUser({
        email: 'elena.patron@example.com',
        password: 'password123',
        displayName: 'Elena Patron',
        role: UserRole.PATRON,
      });

      expect(patronElenaRegistration.user.email).toBe('elena.patron@example.com');
      expect(patronElenaRegistration.user.role).toBe(UserRole.PATRON);
      expect(patronElenaRegistration.user).not.toHaveProperty('passwordHash');
      expect(patronElenaRegistration.token).toBeDefined();
      expect(mockPrisma.session.create).toHaveBeenCalledTimes(1);
    });

    it('Given an email that already belongs to an existing user, When registerUser is called, Then it throws 409 EMAIL_EXISTS', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-patron-id' });

      await expect(
        registerUser({
          email: 'duplicate.patron@example.com',
          password: 'password123',
          displayName: 'Duplicate Patron',
          role: UserRole.PATRON,
        })
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: 'EMAIL_EXISTS',
      });
    });

    it('Given a brewery owner registering as MERCHANT_ADMIN, When merchantId is missing or invalid vs valid, Then it enforces a valid Merchant record', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        registerUser({
          email: 'owner@copperkettle.com',
          password: 'password123',
          displayName: 'Copper Kettle Brewery Owner',
          role: UserRole.MERCHANT_ADMIN,
        })
      ).rejects.toMatchObject({
        httpStatus: 400,
        code: 'INVALID_MERCHANT',
      });

      mockPrisma.merchant.findUnique.mockResolvedValue(null);
      await expect(
        registerUser({
          email: 'owner@copperkettle.com',
          password: 'password123',
          displayName: 'Copper Kettle Brewery Owner',
          role: UserRole.MERCHANT_ADMIN,
          merchantId: '00000000-0000-0000-0000-000000000000',
        })
      ).rejects.toMatchObject({
        httpStatus: 400,
        code: 'INVALID_MERCHANT',
      });

      mockPrisma.merchant.findUnique.mockResolvedValue({ id: 'copper-kettle-brewery-id' });
      mockPrisma.user.create.mockResolvedValue({
        id: 'brewery-owner-user-id',
        email: 'owner@copperkettle.com',
        passwordHash: 'salt:hash',
        displayName: 'Copper Kettle Brewery Owner',
        role: UserRole.MERCHANT_ADMIN,
        isActive: true,
        merchantId: 'copper-kettle-brewery-id',
        staffId: null,
      });
      mockPrisma.session.create.mockResolvedValue({ id: 'brewery-owner-session-id' });

      const breweryOwnerRegistration: { user: AuthenticatedUser; token: string; expiresAt: Date } = await registerUser({
        email: 'owner@copperkettle.com',
        password: 'password123',
        displayName: 'Copper Kettle Brewery Owner',
        role: UserRole.MERCHANT_ADMIN,
        merchantId: 'copper-kettle-brewery-id',
      });
      expect(breweryOwnerRegistration.user.merchantId).toBe('copper-kettle-brewery-id');
    });

    it('Given a bartender registering as STAFF, When staffId is missing or invalid vs valid, Then it links the user to the staff member and their venue', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        registerUser({
          email: 'marco.bartender@copperkettle.com',
          password: 'password123',
          displayName: 'Bartender Marco',
          role: UserRole.STAFF,
        })
      ).rejects.toMatchObject({
        httpStatus: 400,
        code: 'INVALID_STAFF',
      });

      mockPrisma.staff.findUnique.mockResolvedValue(null);
      await expect(
        registerUser({
          email: 'marco.bartender@copperkettle.com',
          password: 'password123',
          displayName: 'Bartender Marco',
          role: UserRole.STAFF,
          staffId: '00000000-0000-0000-0000-000000000000',
        })
      ).rejects.toMatchObject({
        httpStatus: 400,
        code: 'INVALID_STAFF',
      });

      mockPrisma.staff.findUnique.mockResolvedValue({
        id: 'bartender-marco-staff-id',
        venueId: 'copper-kettle-brewery-id',
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'bartender-marco-user-id',
        email: 'marco.bartender@copperkettle.com',
        passwordHash: 'salt:hash',
        displayName: 'Bartender Marco',
        role: UserRole.STAFF,
        isActive: true,
        merchantId: 'copper-kettle-brewery-id',
        staffId: 'bartender-marco-staff-id',
      });
      mockPrisma.session.create.mockResolvedValue({ id: 'bartender-marco-session-id' });

      const bartenderMarcoRegistration: { user: AuthenticatedUser; token: string; expiresAt: Date } = await registerUser({
        email: 'marco.bartender@copperkettle.com',
        password: 'password123',
        displayName: 'Bartender Marco',
        role: UserRole.STAFF,
        staffId: 'bartender-marco-staff-id',
      });
      expect(bartenderMarcoRegistration.user.staffId).toBe('bartender-marco-staff-id');
      expect(bartenderMarcoRegistration.user.merchantId).toBe('copper-kettle-brewery-id');
    });
  });

  describe('Scenario: Logging in, authenticating session tokens, and logging out', () => {
    it('Given an active TabHop executive admin, When loginUser is called with valid credentials, Then a session token is issued', async () => {
      const passwordHash: string = hashPassword('password123');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'tabhop-exec-admin-id',
        email: 'exec.admin@tabhop.io',
        passwordHash,
        displayName: 'TabHop Executive Admin',
        role: UserRole.PLATFORM_ADMIN,
        isActive: true,
        merchantId: null,
        staffId: null,
      });
      mockPrisma.session.create.mockResolvedValue({ id: 'exec-admin-session-id' });

      const executiveAdminSession: { user: AuthenticatedUser; token: string; expiresAt: Date } = await loginUser({
        email: 'exec.admin@tabhop.io',
        password: 'password123',
      });

      expect(executiveAdminSession.user.role).toBe(UserRole.PLATFORM_ADMIN);
      expect(executiveAdminSession.token).toBeDefined();
    });

    it('Given an unknown email or wrong password, When loginUser is called, Then it throws 401 INVALID_CREDENTIALS', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        loginUser({ email: 'unknown@tabhop.io', password: 'password123' })
      ).rejects.toMatchObject({ httpStatus: 401, code: 'INVALID_CREDENTIALS' });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'tabhop-finance-user-id',
        email: 'finance@tabhop.io',
        passwordHash: hashPassword('correct-password'),
        isActive: true,
      });
      await expect(
        loginUser({ email: 'finance@tabhop.io', password: 'wrong-password' })
      ).rejects.toMatchObject({ httpStatus: 401, code: 'INVALID_CREDENTIALS' });
    });

    it('Given a deactivated TabHop staff account, When loginUser is called, Then it throws 403 USER_INACTIVE', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'deactivated-support-user-id',
        email: 'former.support@tabhop.io',
        passwordHash: hashPassword('password123'),
        isActive: false,
      });

      await expect(
        loginUser({ email: 'former.support@tabhop.io', password: 'password123' })
      ).rejects.toMatchObject({ httpStatus: 403, code: 'USER_INACTIVE' });
    });

    it('Given an active session token, When logoutSession is called, Then the session is marked with revokedAt', async () => {
      mockPrisma.session.findUnique.mockResolvedValueOnce(null);
      await logoutSession('nonexistent-session-token');
      expect(mockPrisma.session.update).not.toHaveBeenCalled();

      mockPrisma.session.findUnique.mockResolvedValueOnce({
        id: 'already-revoked-session-id',
        revokedAt: new Date(),
      });
      await logoutSession('already-revoked-session-token');
      expect(mockPrisma.session.update).not.toHaveBeenCalled();

      mockPrisma.session.findUnique.mockResolvedValueOnce({
        id: 'active-patron-session-id',
        revokedAt: null,
      });
      mockPrisma.session.update.mockResolvedValueOnce({ id: 'active-patron-session-id' });
      await logoutSession('active-patron-session-token');
      expect(mockPrisma.session.update).toHaveBeenCalledTimes(1);
    });

    it('Given various session states, When authenticateToken is called, Then only active, unrevoked, unexpired sessions for active users resolve', async () => {
      mockPrisma.session.findUnique.mockResolvedValueOnce(null);
      expect(await authenticateToken('unknown-token')).toBeNull();

      mockPrisma.session.findUnique.mockResolvedValueOnce({
        id: 'revoked-session-id',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        user: { id: 'patron-elena-id', isActive: true },
      });
      expect(await authenticateToken('revoked-token')).toBeNull();

      mockPrisma.session.findUnique.mockResolvedValueOnce({
        id: 'expired-session-id',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 60000),
        user: { id: 'patron-elena-id', isActive: true },
      });
      expect(await authenticateToken('expired-token')).toBeNull();

      mockPrisma.session.findUnique.mockResolvedValueOnce({
        id: 'inactive-user-session-id',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60000),
        user: { id: 'deactivated-user-id', isActive: false },
      });
      expect(await authenticateToken('inactive-user-token')).toBeNull();

      mockPrisma.session.findUnique.mockResolvedValueOnce({
        id: 'valid-finance-session-id',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60000),
        user: {
          id: 'tabhop-finance-analyst-id',
          email: 'finance.analyst@tabhop.io',
          displayName: 'TabHop Finance Analyst',
          role: UserRole.PLATFORM_FINANCE,
          isActive: true,
          merchantId: null,
          staffId: null,
        },
      });
      const authenticatedFinanceSession: { user: AuthenticatedUser; sessionId: string; rawToken: string } | null = await authenticateToken('valid-finance-token');
      expect(authenticatedFinanceSession?.user.email).toBe('finance.analyst@tabhop.io');
      expect(authenticatedFinanceSession?.user.role).toBe(UserRole.PLATFORM_FINANCE);
      expect(authenticatedFinanceSession?.sessionId).toBe('valid-finance-session-id');
    });
  });

  describe('Scenario: Express authentication & Role-Based Access Control (RBAC) middleware', () => {
    it('Given a request with Authorization Bearer header or tabhop_session cookie, When extractTokenFromRequest runs, Then it extracts the token or returns null', () => {
      expect(
        extractTokenFromRequest({
          headers: { authorization: 'Bearer bearer-token-xyz' },
        } as Request)
      ).toBe('bearer-token-xyz');

      expect(
        extractTokenFromRequest({
          headers: { cookie: 'other=1; tabhop_session=cookie-token-123; theme=dark' },
        } as Request)
      ).toBe('cookie-token-123');

      expect(
        extractTokenFromRequest({
          headers: { authorization: 'Bearer    ' },
        } as Request)
      ).toBeNull();

      expect(
        extractTokenFromRequest({
          headers: { cookie: 'tabhop_session=   ' },
        } as Request)
      ).toBeNull();

      expect(extractTokenFromRequest({ headers: {} } as Request)).toBeNull();
    });

    it('Given guest or authenticated requests, When authMiddleware runs, Then it attaches req.user when valid and never blocks guest QR checkout requests', async () => {
      const next: ReturnType<typeof vi.fn> = vi.fn();
      const emptyRes: Partial<Response> = {};
      const guestQrCheckoutReq: Partial<Request> = { headers: {} };
      await authMiddleware(guestQrCheckoutReq as Request, emptyRes as Response, next);
      expect(guestQrCheckoutReq.user).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);

      const invalidTokenGuestReq: Partial<Request> = {
        headers: { authorization: 'Bearer expired-tok' },
      };
      mockPrisma.session.findUnique.mockResolvedValueOnce(null);
      await authMiddleware(invalidTokenGuestReq as Request, emptyRes as Response, next);
      expect(invalidTokenGuestReq.user).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(2);

      mockPrisma.session.findUnique.mockResolvedValueOnce({
        id: 'support-session-id',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60000),
        user: {
          id: 'tabhop-support-specialist-id',
          email: 'support@tabhop.io',
          displayName: 'TabHop Support Specialist',
          role: UserRole.PLATFORM_SUPPORT,
          isActive: true,
          merchantId: null,
          staffId: null,
        },
      });
      const supportSpecialistReq: Partial<Request> = {
        headers: { authorization: 'Bearer valid-support-token' },
      };
      await authMiddleware(supportSpecialistReq as Request, emptyRes as Response, next);
      expect(supportSpecialistReq.user?.id).toBe('tabhop-support-specialist-id');
      expect(supportSpecialistReq.sessionToken).toBe('valid-support-token');

      mockPrisma.session.findUnique.mockRejectedValueOnce(new Error('DB hiccup'));
      const transientErrorReq: Partial<Request> = {
        headers: { authorization: 'Bearer err-tok' },
        requestId: 'req-1',
      };
      await authMiddleware(transientErrorReq as Request, emptyRes as Response, next);
      expect(transientErrorReq.user).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(4);
    });

    it('Given requireAuth and requireRole middlewares, When invoked by different user roles, Then 401 and 403 are enforced accurately', () => {
      const json: ReturnType<typeof vi.fn> = vi.fn();
      const status: ReturnType<typeof vi.fn> = vi.fn().mockReturnValue({ json });
      const res: Response = { status } as unknown as Response;
      const next: ReturnType<typeof vi.fn> = vi.fn();

      // Unauthenticated request on requireAuth
      requireAuth({ requestId: 'req-unauth' } as Request, res, next);
      expect(status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();

      // Authenticated patron on requireAuth
      requireAuth(
        {
          user: {
            id: 'patron-elena-id',
            email: 'elena@example.com',
            displayName: 'Elena Patron',
            role: UserRole.PATRON,
            isActive: true,
            merchantId: null,
            staffId: null,
          },
        } as Request,
        res,
        next
      );
      expect(next).toHaveBeenCalledTimes(1);

      const requireTabHopFinanceOrAdmin: (req: Request, res: Response, next: NextFunction) => void = requireRole(
        UserRole.PLATFORM_FINANCE,
        UserRole.PLATFORM_ADMIN
      );

      // Unauthenticated on requireRole
      requireTabHopFinanceOrAdmin({ requestId: 'req-unauth-role' } as Request, res, next);
      expect(status).toHaveBeenCalledWith(401);

      // Brewery Merchant Admin attempting internal TabHop action -> 403
      requireTabHopFinanceOrAdmin(
        {
          requestId: 'req-merchant',
          user: {
            id: 'brewery-owner-id',
            email: 'owner@brewery.com',
            displayName: 'Brewery Owner',
            role: UserRole.MERCHANT_ADMIN,
            isActive: true,
            merchantId: 'venue-1',
            staffId: null,
          },
        } as Request,
        res,
        next
      );
      expect(status).toHaveBeenCalledWith(403);

      // TabHop Support Specialist attempting Finance/Admin action -> 403
      requireTabHopFinanceOrAdmin(
        {
          requestId: 'req-support',
          user: {
            id: 'support-specialist-id',
            email: 'support@tabhop.io',
            displayName: 'Support Specialist',
            role: UserRole.PLATFORM_SUPPORT,
            isActive: true,
            merchantId: null,
            staffId: null,
          },
        } as Request,
        res,
        next
      );
      expect(status).toHaveBeenCalledWith(403);

      // TabHop Finance Analyst -> allowed
      requireTabHopFinanceOrAdmin(
        {
          requestId: 'req-finance',
          user: {
            id: 'finance-analyst-id',
            email: 'finance@tabhop.io',
            displayName: 'Finance Analyst',
            role: UserRole.PLATFORM_FINANCE,
            isActive: true,
            merchantId: null,
            staffId: null,
          },
        } as Request,
        res,
        next
      );
      expect(next).toHaveBeenCalledTimes(2);
    });
  });
});
