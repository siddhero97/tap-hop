import { Router } from 'express';
import { validateMiddleware } from '../middleware/validate.js';
import { OrderIdParamsSchema } from './payments.validator.js';
import { createPayPalOrder, capturePayPalOrder } from './payments.controller.js';

const router: Router = Router({ mergeParams: true });

/**
 * POST /orders/:id/paypal - Create a PayPal order for payment
 */
router.post('/:id/paypal', validateMiddleware(OrderIdParamsSchema, 'params'), createPayPalOrder);

/**
 * POST /orders/:id/capture - Capture PayPal order and dispatch settlement
 */
router.post('/:id/capture', validateMiddleware(OrderIdParamsSchema, 'params'), capturePayPalOrder);

export { router as paymentsRouter };
