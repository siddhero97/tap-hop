import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { FakePayPalGateway } from './payments/payments.fake-gateway.js';
import { PayPalRestGateway } from './payments/payments.rest-gateway.js';
import { SettlementService } from './settlements/settlements.service.js';
import { WebhookService } from './webhooks/webhooks.service.js';
import { PayPalGateway } from './payments/payments.gateway.js';
import { registerServices } from './lib/app-services.js';
import { prisma } from '@tabhop/database';

/**
 * Initialize and start the Express server
 */
async function main(): Promise<void> {
  try {
    // Create Express application
    const app = createApp();

    // Initialize payment gateway based on configuration
    let gateway: PayPalGateway;
    if (env.PAYPAL_MODE === 'fake') {
      logger.info('Using FakePayPalGateway for testing');
      gateway = new FakePayPalGateway();
    } else {
      logger.info('Using PayPalRestGateway for sandbox/production');
      gateway = new PayPalRestGateway(
        env.PAYPAL_CLIENT_ID!,
        env.PAYPAL_CLIENT_SECRET!,
        env.PAYPAL_WEBHOOK_ID!
      );
    }

    // Initialize services
    const settlementService = new SettlementService(gateway);
    const webhookService = new WebhookService(prisma);

    registerServices(app, {
      gateway,
      settlementService,
      webhookService,
      paypalMode: env.PAYPAL_MODE,
    });

    // Start server
    app.listen(env.PORT, () => {
      logger.info(
        {
          port: env.PORT,
          nodeEnv: env.NODE_ENV,
          paypalMode: env.PAYPAL_MODE,
        },
        'Server started'
      );
    });
  } catch (error) {
    logger.error(
      { error: String(error), stack: (error as Error).stack },
      'Failed to start server'
    );
    process.exit(1);
  }
}

main();
