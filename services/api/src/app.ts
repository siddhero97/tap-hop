import Express from 'express';
import { requestIdMiddleware } from './middleware/request-id.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandlerMiddleware } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';
import { ordersRouter } from './routes/orders.js';
import { paymentsRouter } from './routes/payments.js';
import { settlementsRouter } from './routes/settlements.js';
import { webhooksRouter } from './routes/webhooks.js';

/**
 * Create and configure Express application with middleware and routes
 */
export function createApp(): Express.Application {
  const app = Express();

  // Middleware (in order)
  app.use(requestIdMiddleware);
  app.use(Express.json());
  app.use(authMiddleware);

  // Routes
  app.use('/health', healthRouter);
  app.use('/orders', ordersRouter);
  app.use('/orders', paymentsRouter);
  app.use('/settlements', settlementsRouter);
  app.use('/webhooks', webhooksRouter);

  // Error handler (must be last)
  app.use(errorHandlerMiddleware);

  return app;
}

export default createApp;
