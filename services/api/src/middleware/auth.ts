import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@tabhop/database';
import { authenticateToken, AuthenticatedUser } from '../auth/auth.service.js';
import { logger } from '../lib/logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionToken?: string;
      requestId?: string;
      validatedData?: object;
      rawBody?: string;
    }
  }
}

export const SESSION_COOKIE_NAME: string = 'tabhop_session';

/**
 * Extract bearer token from Authorization header or session token from Cookie header.
 */
export function extractTokenFromRequest(req: Request): string | null {
  let resolvedToken: string | null = null;
  const authHeader: string | undefined = req.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token: string = authHeader.slice('Bearer '.length).trim();
    if (token.length > 0) {
      resolvedToken = token;
    }
  }

  if (resolvedToken === null) {
    const cookieHeader: string | undefined = req.headers?.cookie;
    if (typeof cookieHeader === 'string') {
      const cookies: string[] = cookieHeader.split(';');
      for (const part of cookies) {
        const [rawKey, ...rawValParts] = part.trim().split('=');
        if (rawKey === SESSION_COOKIE_NAME) {
          const val: string = rawValParts.join('=').trim();
          if (val.length > 0) {
            resolvedToken = decodeURIComponent(val);
            break;
          }
        }
      }
    }
  }

  return resolvedToken;
}

/**
 * Optional authentication middleware: attaches req.user if a valid session token
 * is present, while allowing unauthenticated guest QR checkout requests through.
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token: string | null = extractTokenFromRequest(req);
  if (token) {
    try {
      const authResult: { user: AuthenticatedUser; sessionId: string; rawToken: string } | null = await authenticateToken(token);
      if (authResult) {
        req.user = authResult.user;
        req.sessionToken = authResult.rawToken;
      }
    } catch (error) {
      logger.warn(
        { error: String(error), requestId: req.requestId },
        'Failed to authenticate session token'
      );
    }
  }

  next();
}

/**
 * Require an authenticated user session.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    logger.warn(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
      },
      'Authentication required: missing or invalid session'
    );
    res.status(401).json({
      status: 'error',
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
      requestId: req.requestId,
    });
  } else {
    next();
  }
}

/**
 * Role-Based Access Control (RBAC) middleware factory.
 * Requires the authenticated user to hold one of the specified roles.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      logger.warn(
        {
          requestId: req.requestId,
          method: req.method,
          path: req.originalUrl,
        },
        'Authentication required for role-protected resource'
      );
      res.status(401).json({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        requestId: req.requestId,
      });
    } else if (!allowedRoles.includes(req.user.role)) {
      logger.warn(
        {
          requestId: req.requestId,
          userId: req.user.id,
          userRole: req.user.role,
          allowedRoles,
          method: req.method,
          path: req.originalUrl,
        },
        'RBAC authorization denied: insufficient role permissions'
      );
      res.status(403).json({
        status: 'error',
        code: 'FORBIDDEN',
        message: 'Insufficient permissions for this resource',
        requestId: req.requestId,
      });
    } else {
      next();
    }
  };
}

