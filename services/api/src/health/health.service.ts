import { logger } from '../lib/logger.js';
import type { PayPalGateway } from '../payments/payments.gateway.js';
import { pingDatabase } from './health.repository.js';

/**
 * Check database connectivity (non-blocking)
 */
export async function checkDatabaseHealth(): Promise<'ok' | 'fail'> {
  let status: 'ok' | 'fail';
  try {
    await pingDatabase();
    status = 'ok';
  } catch (dbError) {
    logger.error({ error: String(dbError) }, 'Database health check failed');
    status = 'fail';
  }
  return status;
}

export interface HealthReport {
  status: 'ok' | 'fail';
  db: 'ok' | 'fail';
  paypal: 'ok' | 'skipped' | 'unknown';
}

/**
 * Build the health report from database connectivity and PayPal gateway configuration.
 */
export async function getHealthReport(
  gateway: PayPalGateway | null | undefined,
  paypalMode: string
): Promise<HealthReport> {
  const db: 'ok' | 'fail' = await checkDatabaseHealth();
  const paypal: "skipped" | "ok" | "unknown" = paypalMode === 'fake' ? 'skipped' : gateway ? 'ok' : 'unknown';
  return { status: db === 'fail' ? 'fail' : 'ok', db, paypal };
}
