import type { Response } from 'express';

/**
 * Expected domain failure raised by services; controllers translate it to an HTTP response.
 */
export class ServiceError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

/**
 * Sends the response for a ServiceError. Returns false for any other error.
 */
export function sendServiceError(res: Response, error: unknown): boolean {
  if (!(error instanceof ServiceError)) {
    return false;
  }
  res.status(error.httpStatus).json({
    status: 'error',
    code: error.code,
    message: error.message,
    ...error.extra,
  });
  return true;
}
