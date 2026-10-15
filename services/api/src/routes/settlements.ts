import { Router } from 'express';
import { retrySettlement, getSettlements } from '../controllers/settlements.js';

const router = Router();

/**
 * POST /settlements/:orderId/retry - Retry a failed settlement batch
 */
router.post('/:orderId/retry', retrySettlement);

/**
 * GET /settlements - Retrieve paginated settlement ledger
 */
router.get('/', getSettlements);

export { router as settlementsRouter };
