import { Request, Response } from 'express';
import { prisma, OrderStatus } from '@tabhop/database';
import { computeOrderTotal, pricingToDecimals } from './orders.service.js';
import { logger } from '../lib/logger.js';
import { CreateOrderRequest, OrderIdSchema } from './orders.validator.js';

/**
 * POST /orders - Create a new order
 * Validates items exist and are active, computes pricing, stores in PENDING state
 */
export async function createOrder(req: Request, res: Response): Promise<void> {
  try {
    const input = (req as any).validatedData as CreateOrderRequest;

    // Check for idempotency
    if (input.idempotencyKey) {
      const existingOrder = await prisma.order.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: {
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      if (existingOrder) {
        res.status(200).json({
          status: 'success',
          order: {
            id: existingOrder.id,
            venueId: existingOrder.venueId,
            status: existingOrder.status,
            subtotalCents: Math.round(parseFloat(existingOrder.subtotalAmount.toString()) * 100),
            taxCents: Math.round(parseFloat(existingOrder.taxAmount.toString()) * 100),
            tipCents: Math.round(parseFloat(existingOrder.tipAmount.toString()) * 100),
            platformFeeCents: Math.round(parseFloat(existingOrder.platformFeeAmount.toString()) * 100),
            totalCents: Math.round(parseFloat(existingOrder.totalAmount.toString()) * 100),
            items: existingOrder.items.map((oi) => ({
              itemId: oi.itemId,
              quantity: oi.quantity,
              unitPriceCents: Math.round(parseFloat(oi.unitPrice.toString()) * 100),
            })),
          },
        });
        return;
      }
    }

    // Fetch all items to validate they exist and are active
    const itemIds = input.lines.map((line) => line.itemId);
    const items = await prisma.item.findMany({
      where: { id: { in: itemIds } },
      include: { merchant: true },
    });

    // Validate all items exist
    if (items.length !== itemIds.length) {
      const missingIds = itemIds.filter(
        (id) => !items.find((item) => item.id === id)
      );
      res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Some items not found',
        missingItemIds: missingIds,
      });
      return;
    }

    // Validate all items are active
    const inactiveItems = items.filter((item) => !item.isActive);
    if (inactiveItems.length > 0) {
      res.status(400).json({
        status: 'error',
        code: 'ITEM_INACTIVE',
        message: 'One or more items are inactive',
        inactiveItemIds: inactiveItems.map((item) => item.id),
      });
      return;
    }

    // Validate venue exists and is PRIMARY_VENUE
    const venue = await prisma.merchant.findUnique({
      where: { id: input.venueId },
    });

    if (!venue || venue.merchantType !== 'PRIMARY_VENUE') {
      res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Venue not found or is not a primary venue',
      });
      return;
    }

    // Validate server staff exists if provided
    if (input.serverStaffId) {
      const staff = await prisma.staff.findUnique({
        where: { id: input.serverStaffId },
      });

      if (!staff || staff.venueId !== input.venueId) {
        res.status(404).json({
          status: 'error',
          code: 'NOT_FOUND',
          message: 'Server staff not found or does not belong to this venue',
        });
        return;
      }
    }

    // Build line items for pricing calculation
    const lineItems = input.lines.map((line) => {
      const item = items.find((i) => i.id === line.itemId)!;
      return {
        priceDecimal: item.price,
        quantity: line.quantity,
      };
    });

    // Compute pricing
    const pricing = computeOrderTotal({
      lineItems,
      taxRateBps: 800, // 8% tax
      platformFeeBps: 500, // 5% platform fee
    });

    // Create order and items in transaction
    const order = await prisma.$transaction(async (tx: any) => {
      const newOrder = await tx.order.create({
        data: {
          venueId: input.venueId,
          tableNumber: input.tableNumber,
          serverStaffId: input.serverStaffId,
          idempotencyKey: input.idempotencyKey,
          subtotalAmount: pricingToDecimals(pricing).subtotalAmount,
          taxAmount: pricingToDecimals(pricing).taxAmount,
          tipAmount: input.tipAmount,
          platformFeeAmount: pricingToDecimals(pricing).platformFeeAmount,
          totalAmount: pricingToDecimals(pricing).totalAmount,
          status: OrderStatus.PENDING,
        },
      });

      // Create order items
      const orderItems = input.lines.map((line) => {
        const item = items.find((i) => i.id === line.itemId)!;
        return {
          orderId: newOrder.id,
          itemId: line.itemId,
          quantity: line.quantity,
          unitPrice: item.price,
        };
      });

      await tx.orderItem.createMany({
        data: orderItems,
      });

      return newOrder;
    });

    logger.info(
      { orderId: order.id, venueId: input.venueId },
      'Order created successfully'
    );

    res.status(201).json({
      status: 'success',
      order: {
        id: order.id,
        venueId: order.venueId,
        status: order.status,
        subtotalCents: pricing.subtotalCents,
        taxCents: pricing.taxCents,
        tipCents: Math.round(input.tipAmount * 100),
        platformFeeCents: pricing.platformFeeCents,
        totalCents: pricing.totalCents,
      },
    });
  } catch (error) {
    logger.error(
      { error: String(error) },
      'Error creating order'
    );
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
    const { id } = req.params;

    // Validate UUID format
    const parseResult = OrderIdSchema.safeParse(id);
    if (!parseResult.success) {
      res.status(400).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Invalid order ID format',
      });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            item: true,
          },
        },
        payoutBatch: true,
      },
    });

    if (!order) {
      res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Order not found',
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      order: {
        id: order.id,
        venueId: order.venueId,
        serverStaffId: order.serverStaffId,
        tableNumber: order.tableNumber,
        status: order.status,
        paypalOrderId: order.paypalOrderId,
        paypalCaptureId: order.paypalCaptureId,
        subtotalCents: Math.round(parseFloat(order.subtotalAmount.toString()) * 100),
        taxCents: Math.round(parseFloat(order.taxAmount.toString()) * 100),
        tipCents: Math.round(parseFloat(order.tipAmount.toString()) * 100),
        platformFeeCents: Math.round(parseFloat(order.platformFeeAmount.toString()) * 100),
        totalCents: Math.round(parseFloat(order.totalAmount.toString()) * 100),
        items: order.items.map((oi) => ({
          itemId: oi.itemId,
          itemName: oi.item.name,
          quantity: oi.quantity,
          unitPriceCents: Math.round(parseFloat(oi.unitPrice.toString()) * 100),
        })),
        payoutBatch: order.payoutBatch
          ? {
              id: order.payoutBatch.id,
              paypalBatchId: order.payoutBatch.paypalBatchId,
              status: order.payoutBatch.status,
            }
          : null,
        capturedAt: order.capturedAt,
        createdAt: order.createdAt,
      },
    });
  } catch (error) {
    logger.error(
      { error: String(error), orderId: req.params.id },
      'Error retrieving order'
    );
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve order',
    });
  }
}
