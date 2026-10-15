import { Request, Response } from 'express';
import { GetSettlementsQuery } from './settlements.validator.js';
import { getValidated } from '../middleware/validate.js';
import { getServices } from '../lib/app-services.js';
import { sendServiceError } from '../lib/service-error.js';
import { logger } from '../lib/logger.js';

/**
 * POST /settlements/:orderId/retry - Retry a failed settlement batch
 */
export async function retrySettlement(req: Request, res: Response): Promise<void> {
  try {
    const { settlementService } = getServices(req);
    const result = await settlementService.retry(req.params.orderId);
    res.status(200).json({
      status: 'success',
      payoutBatch: {
        id: result.payoutBatchId,
        status: result.status,
      },
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }
    logger.error(
      { error: String(error), orderId: req.params.orderId },
      'Error retrying settlement'
    );
    res.status(400).json({
      status: 'error',
      code: 'SETTLEMENT_DISPATCH_FAILED',
      message: 'Failed to dispatch settlement retry',
      details: (error as Error).message,
    });
  }
}

/**
 * GET /settlements - Retrieve paginated settlement ledger
 * Supports filtering by venueId, status, and date range
 */
export async function getSettlements(req: Request, res: Response): Promise<void> {
  try {
    const query = getValidated<GetSettlementsQuery>(req);
    const { settlementService } = getServices(req);
    const { rows, total } = await settlementService.listSettlements(query);

    res.status(200).json({
      status: 'success',
      data: rows,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        pages: Math.ceil(total / query.pageSize),
      },
    });
  } catch (error) {
    logger.error({ error: String(error) }, 'Error retrieving settlements');
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve settlements',
    });
  }
}
