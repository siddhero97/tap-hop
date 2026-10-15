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
