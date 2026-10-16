import type { Response } from 'express';

export type ServiceErrorExtraValue =
  | string
  | number
  | boolean
  | string[]
  | null
  | undefined;

export type ServiceErrorExtra = Record<string, ServiceErrorExtraValue>;

/**
 * Expected domain failure raised by services; controllers translate it to an HTTP response.
 */
export class ServiceError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly extra: ServiceErrorExtra = {}
  ) {
    super(message);
  }
}

/**
 * Sends the response for a ServiceError. Returns false for any other error.
 */
export function sendServiceError(res: Response, error: unknown): boolean {
  const isServiceErr: boolean = error instanceof ServiceError;
  if (error instanceof ServiceError) {
    res.status(error.httpStatus).json({
      status: 'error',
      code: error.code,
      message: error.message,
      ...error.extra,
    });
  }
  return isServiceErr;
}
