import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Factory function to create a validation middleware using Zod schemas.
 * Validates request body, params, or query against the provided schema.
 * Attaches validated data to req.validatedData for use in controllers.
 */
export function validateMiddleware(
  schema: ZodSchema,
  source: 'body' | 'params' | 'query' = 'body'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const dataToValidate: Request['body'] | Request['params'] | Request['query'] =
      source === 'body' ? req.body :
      source === 'params' ? req.params :
      req.query;

    const parseResult: ReturnType<ZodSchema["safeParse"]> = schema.safeParse(dataToValidate);

    if (!parseResult.success) {
      res.status(400).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        errors: parseResult.error.errors,
      });
    } else {
      req.validatedData = parseResult.data;
      next();
    }
  };
}

/**
 * Typed accessor for data attached by validateMiddleware.
 */
export function getValidated<T>(req: Request): T {
  return req.validatedData as T;
}

/**
 * Validates req.rawBody against a schema. Responds 200 with the given error code
 * on failure (for providers such as PayPal that expect 200 for every response).
 */
export function validateRawBodyMiddleware(schema: ZodSchema, errorCode: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!schema.safeParse(req.rawBody).success) {
      res.status(200).json({ status: 'error', code: errorCode });
    } else {
      next();
    }
  };
}
