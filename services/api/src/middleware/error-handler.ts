import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

/**
 * Express error handler middleware.
 * Catches errors and returns standardized error responses.
 * Must be registered after all other middleware and routes.
 */
export function errorHandlerMiddleware(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req as any).requestId;

  logger.error(
    {
      error: String(error),
      message: error.message,
      stack: error.stack,
      requestId,
      method: req.method,
      path: req.path,
    },
    'Unhandled error'
  );

  res.status(500).json({
    status: 'error',
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    requestId,
  });
}
