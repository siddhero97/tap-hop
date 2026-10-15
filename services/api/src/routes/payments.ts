import { Router } from 'express';
import { createPayPalOrder, capturePayPalOrder } from '../controllers/payments.js';

const router = Router({ mergeParams: true });

/**
 * POST /orders/:id/paypal - Create a PayPal order for payment
 */
router.post('/:id/paypal', createPayPalOrder);

/**
 * POST /orders/:id/capture - Capture PayPal order and dispatch settlement
 */
router.post('/:id/capture', capturePayPalOrder);

export { router as paymentsRouter };
