import { Request, Response } from 'express';
import { getHealthReport, type HealthReport } from './health.service.js';
import { getServices } from '../lib/app-services.js';
import { logger } from '../lib/logger.js';

/**
 * GET /health - Health check endpoint
 * Returns status of database and PayPal connectivity
 */
export async function getHealth(req: Request, res: Response): Promise<void> {
  try {
    const { gateway, paypalMode } = getServices(req);
    const report: HealthReport = await getHealthReport(gateway, paypalMode);
    res.status(report.status === 'fail' ? 503 : 200).json(report);
  } catch (error) {
    logger.error({ error: String(error) }, 'Error checking health');
    res.status(500).json({
      status: 'fail',
      db: 'unknown',
      paypal: 'unknown',
    });
  }
}
