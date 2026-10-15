import { Request, Response, NextFunction } from 'express';

/**
 * Placeholder authentication middleware.
 * To be implemented when auth requirements are defined.
 */
export function authMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction
): void {
  // Placeholder for future auth implementation
  next();
}
