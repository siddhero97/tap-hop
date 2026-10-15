import { prisma } from '@tabhop/database';
import { logger } from '../lib/logger.js';

/**
 * Check database connectivity (non-blocking)
 */
export async function checkDatabaseHealth(): Promise<'ok' | 'fail'> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch (dbError) {
    logger.error({ error: String(dbError) }, 'Database health check failed');
    return 'fail';
  }
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
  gateway: unknown,
  paypalMode: string
): Promise<HealthReport> {
  const db = await checkDatabaseHealth();
  const paypal = paypalMode === 'fake' ? 'skipped' : gateway ? 'ok' : 'unknown';
  return { status: db === 'fail' ? 'fail' : 'ok', db, paypal };
}
