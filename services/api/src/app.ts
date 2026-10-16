import Express from 'express';
import { requestIdMiddleware } from './middleware/request-id.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandlerMiddleware } from './middleware/error-handler.js';
import { healthRouter } from './health/health.routes.js';
import { authRouter } from './auth/auth.routes.js';
import { adminRouter } from './admin/admin.routes.js';
import { catalogRouter } from './catalog/catalog.routes.js';
import { ordersRouter } from './orders/orders.routes.js';
import { paymentsRouter } from './payments/payments.routes.js';
import { settlementsRouter } from './settlements/settlements.routes.js';
import { webhooksRouter } from './webhooks/webhooks.routes.js';

/**
 * Create and configure Express application with middleware and routes
 */
export function createApp(): Express.Application {
  const app: Express.Application = Express();

  // Middleware (in order)
  app.use(requestIdMiddleware);
  app.use(
    Express.json({
      verify: (req, _res, buf) => {
        (req as Express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(authMiddleware);

  // Routes
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/admin', adminRouter);
  app.use('/catalog', catalogRouter);
  app.use('/orders', ordersRouter);
  app.use('/orders', paymentsRouter);
  app.use('/settlements', settlementsRouter);
  app.use('/webhooks', webhooksRouter);

  // Error handler (must be last)
  app.use(errorHandlerMiddleware);

  return app;
}

export default createApp;

