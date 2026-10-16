import { Request, Response } from 'express';
import { registerUser, loginUser, logoutSession, type AuthenticatedUser } from './auth.service.js';
import { getValidated } from '../middleware/validate.js';
import { SESSION_COOKIE_NAME } from '../middleware/auth.js';
import { sendServiceError } from '../lib/service-error.js';
import { logger } from '../lib/logger.js';
import type { RegisterRequest, LoginRequest } from './auth.validator.js';

function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  const maxAgeSeconds: number = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
  );
}

/**
 * POST /auth/register - Register a new user and start a session
 */
export async function register(req: Request, res: Response): Promise<void> {
  try {
    const body: RegisterRequest = getValidated<RegisterRequest>(req);
    const result: { user: AuthenticatedUser; token: string; expiresAt: Date } = await registerUser(body);

    setSessionCookie(res, result.token, result.expiresAt);
    res.status(201).json({
      status: 'success',
      user: result.user,
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    if (!sendServiceError(res, error)) {
      logger.error({ error: String(error) }, 'Error registering user');
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Failed to register user',
      });
    }
  }
}

/**
 * POST /auth/login - Authenticate a user and start a session
 */
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const body: LoginRequest = getValidated<LoginRequest>(req);
    const result: { user: AuthenticatedUser; token: string; expiresAt: Date } = await loginUser(body);

    setSessionCookie(res, result.token, result.expiresAt);
    res.status(200).json({
      status: 'success',
      user: result.user,
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    if (!sendServiceError(res, error)) {
      logger.error({ error: String(error) }, 'Error logging in user');
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Failed to log in',
      });
    }
  }
}

/**
 * POST /auth/logout - Revoke the current session token and clear cookie
 */
export async function logout(req: Request, res: Response): Promise<void> {
  try {
    if (req.sessionToken) {
      await logoutSession(req.sessionToken);
    }
    clearSessionCookie(res);
    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error({ error: String(error) }, 'Error logging out user');
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to log out',
    });
  }
}

/**
 * GET /auth/me - Return the currently authenticated user profile
 */
export async function me(req: Request, res: Response): Promise<void> {
  res.status(200).json({
    status: 'success',
    user: req.user,
  });
}
