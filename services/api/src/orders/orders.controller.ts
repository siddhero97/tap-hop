import { Request, Response } from 'express';
import { createOrderWithItems, getOrderDetails } from './orders.service.js';
import { CreateOrderRequest } from './orders.validator.js';
import { getValidated } from '../middleware/validate.js';
import { sendServiceError } from '../lib/service-error.js';
import { logger } from '../lib/logger.js';

/**
 * POST /orders - Create a new order
 * Validates items exist and are active, computes pricing, stores in PENDING state
 */
export async function createOrder(req: Request, res: Response): Promise<void> {
  try {
    const { created, order } = await createOrderWithItems(getValidated<CreateOrderRequest>(req));
    res.status(created ? 201 : 200).json({ status: 'success', order });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }
    logger.error({ error: String(error) }, 'Error creating order');
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create order',
    });
  }
}

/**
 * GET /orders/:id - Retrieve an order with items and amounts
 */
export async function getOrder(req: Request, res: Response): Promise<void> {
  try {
    const order = await getOrderDetails(req.params.id);
    res.status(200).json({ status: 'success', order });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }
    logger.error({ error: String(error), orderId: req.params.id }, 'Error retrieving order');
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve order',
    });
  }
}
