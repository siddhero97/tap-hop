import { Router } from 'express';
import { validateMiddleware } from '../middleware/validate.js';
import { createOrder, getOrder } from './orders.controller.js';
import { CreateOrderSchema, OrderIdParamsSchema } from './orders.validator.js';

const router = Router();

/**
 * POST /orders - Create a new order
 */
router.post('/', validateMiddleware(CreateOrderSchema, 'body'), createOrder);

/**
 * GET /orders/:id - Retrieve an order with items and amounts
 */
router.get('/:id', validateMiddleware(OrderIdParamsSchema, 'params'), getOrder);

export { router as ordersRouter };
