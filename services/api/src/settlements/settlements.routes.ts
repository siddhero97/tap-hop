import { Router } from 'express';
import { validateMiddleware } from '../middleware/validate.js';
import { GetSettlementsSchema, SettlementOrderParamsSchema } from './settlements.validator.js';
import { retrySettlement, getSettlements } from './settlements.controller.js';

const router = Router();

/**
 * POST /settlements/:orderId/retry - Retry a failed settlement batch
 */
router.post('/:orderId/retry', validateMiddleware(SettlementOrderParamsSchema, 'params'), retrySettlement);

/**
 * GET /settlements - Retrieve paginated settlement ledger
 */
router.get('/', validateMiddleware(GetSettlementsSchema, 'query'), getSettlements);

export { router as settlementsRouter };
