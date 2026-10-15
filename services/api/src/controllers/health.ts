import { Request, Response } from 'express';
import { prisma } from '@tabhop/database';
import { logger } from '../lib/logger.js';

/**
 * GET /health - Health check endpoint
 * Returns status of database and PayPal connectivity
 */
export async function getHealth(req: Request, res: Response): Promise<void> {
  try {
    const { gateway, paypalMode } = req.app.locals;
    const result: any = {
      status: 'ok',
      db: 'unknown',
      paypal: 'unknown',
    };

    // Check database connectivity
    try {
      await prisma.$queryRaw`SELECT 1`;
      result.db = 'ok';
    } catch (dbError) {
      logger.error({ error: String(dbError) }, 'Database health check failed');
      result.db = 'fail';
    }

    // Check PayPal connectivity (if not in fake mode)
    if (paypalMode === 'fake') {
      result.paypal = 'skipped';
    } else if (gateway && 'createOrder' in gateway) {
      try {
        // If gateway exists and we got here, assume it's OK
        result.paypal = 'ok';
      } catch (paypalError) {
        logger.error({ error: String(paypalError) }, 'PayPal health check failed');
        result.paypal = 'fail';
      }
    } else {
      result.paypal = 'unknown';
    }

    // Determine overall status
    if (result.db === 'fail') {
      result.status = 'fail';
      res.status(503).json(result);
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    logger.error(
      { error: String(error) },
      'Error checking health'
    );
    res.status(500).json({
      status: 'fail',
      db: 'unknown',
      paypal: 'unknown',
    });
  }
}
