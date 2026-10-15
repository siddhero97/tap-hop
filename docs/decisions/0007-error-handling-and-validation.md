# ADR 0007: Zod-Based Input Validation and Structured Error Responses

**Date:** 2026-10-14

**Status:** Accepted

## Context

The API receives requests from clients and must:
1. Validate all inputs strictly (prevent invalid data from reaching business logic)
2. Return clear, structured error responses
3. Distinguish between validation errors, not-found, and server errors
4. Use consistent error codes for client-side error handling

## Decision

Use **Zod** for validation and a **middleware-based error handling** approach:

**Validation (Zod):**
```typescript
// src/orders/orders.validator.ts
export const CreateOrderSchema = z.object({
  venueId: z.string().uuid(),
  lines: z.array(
    z.object({
      itemId: z.string().uuid(),
      quantity: z.number().int().positive(),
    })
  ),
});

// src/middleware/validate.ts
export function validateMiddleware(schema, target = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      return res.status(400).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        errors: result.error.issues,
      });
    }
    (req as any).validatedData = result.data;
    next();
  };
}
```

**Error Responses:**
All error responses follow this shape:
```json
{
  "status": "error",
  "code": "ERROR_CODE",
  "message": "Human-readable message",
  "errors": []  // Optional, for validation errors
}
```

**Error codes:**
- `VALIDATION_ERROR` - Request validation failed (400)
- `NOT_FOUND` - Resource not found (404)
- `CONFLICT` - Constraint violation (409)
- `INTERNAL_ERROR` - Unexpected server error (500)
- `ITEM_INACTIVE` - Business logic error (400)

**Error middleware:**
```typescript
// src/middleware/error-handler.ts
app.use((err, req, res, next) => {
  logger.error({ error: err }, 'Unhandled error');
  res.status(500).json({
    status: 'error',
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  });
});
```

## Consequences

**Positive:**
- All inputs validated before reaching business logic
- Validation rules are centralized and reusable
- Consistent error response format
- Clients can parse error codes for internationalization
- Type-safe after validation (TypeScript narrowing)

**Negative:**
- Requires validation schema for every endpoint
- Validation errors can be verbose
- Zod learning curve (though small)

## Verification

- All endpoints use validateMiddleware
- Error response tests verify correct status codes and error codes
- Integration tests verify validation catches common mistakes
