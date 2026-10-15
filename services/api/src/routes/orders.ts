import { Router } from 'express';
import { validateMiddleware } from '../middleware/validate.js';
import { createOrder, getOrder } from '../controllers/orders.js';
import { CreateOrderSchema } from '../validators/orders.js';

const router = Router();

/**
 * POST /orders - Create a new order
 */
router.post('/', validateMiddleware(CreateOrderSchema, 'body'), createOrder);

/**
 * GET /orders/:id - Retrieve an order with items and amounts
 */
router.get('/:id', getOrder);

export { router as ordersRouter };
