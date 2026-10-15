import type { Application, Request } from 'express';
import type { PayPalGateway } from '../payments/payments.gateway.js';
import type { SettlementService } from '../settlements/settlements.service.js';
import type { WebhookService } from '../webhooks/webhooks.service.js';

export interface AppServices {
  gateway: PayPalGateway;
  settlementService: SettlementService;
  webhookService: WebhookService;
  paypalMode: string;
}

/**
 * Attach services to the app, failing fast at startup if any is missing.
 */
export function registerServices(app: Application, services: AppServices): void {
  for (const [name, value] of Object.entries(services)) {
    if (!value) {
      throw new Error(`Required app service not configured: ${name}`);
    }
  }
  Object.assign(app.locals, services);
}

export function getServices(req: Request): AppServices {
  return req.app.locals as AppServices;
}
