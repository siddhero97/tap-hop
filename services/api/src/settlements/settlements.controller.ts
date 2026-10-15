import { Request, Response } from 'express';
import { prisma, PayoutStatus } from '@tabhop/database';
import { SettlementService } from './settlements.service.js';
import { logger } from '../lib/logger.js';
import { GetSettlementsSchema, GetSettlementsQuery, OrderIdSchema } from './settlements.validator.js';

/**
 * POST /settlements/:orderId/retry - Retry a failed settlement batch
 */
export async function retrySettlement(req: Request, res: Response): Promise<void> {
  try {
    const { orderId } = req.params;
    const { settlementService } = req.app.locals;

    if (!settlementService || !('dispatch' in settlementService)) {
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Settlement service not configured',
      });
      return;
    }

    const service = settlementService as SettlementService;

    // Validate UUID format
    const parseResult = OrderIdSchema.safeParse(orderId);
    if (!parseResult.success) {
      res.status(400).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Invalid order ID format',
      });
      return;
    }

    // Fetch order and batch
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payoutBatch: true },
    });

    if (!order) {
      res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Order not found',
      });
      return;
    }

    if (!order.payoutBatch) {
      res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'No settlement batch found for this order',
      });
      return;
    }

    // Validate batch is in FAILED state
    if (order.payoutBatch.status !== PayoutStatus.FAILED) {
      res.status(409).json({
        status: 'error',
        code: 'SETTLEMENT_INVALID_TRANSITION',
        message: `Cannot retry settlement batch in ${order.payoutBatch.status} state`,
        currentStatus: order.payoutBatch.status,
      });
      return;
    }

    try {
      // Dispatch settlement retry
      const result = await service.dispatch(orderId);

      logger.info(
        { orderId, payoutBatchId: result.payoutBatchId },
        'Settlement retry dispatched'
      );

      res.status(200).json({
        status: 'success',
        payoutBatch: {
          id: result.payoutBatchId,
          status: result.status,
        },
      });
    } catch (dispatchError) {
      logger.error(
        { error: String(dispatchError), orderId },
        'Settlement retry dispatch failed'
      );

      res.status(400).json({
        status: 'error',
        code: 'SETTLEMENT_DISPATCH_FAILED',
        message: 'Failed to dispatch settlement retry',
        details: (dispatchError as Error).message,
      });
    }
  } catch (error) {
    logger.error(
      { error: String(error), orderId: req.params.orderId },
      'Error retrying settlement'
    );
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retry settlement',
    });
  }
}

/**
 * GET /settlements - Retrieve paginated settlement ledger
 * Supports filtering by venueId, status, and date range
 */
export async function getSettlements(req: Request, res: Response): Promise<void> {
  try {
    // Validate query params
    const parseResult = GetSettlementsSchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Invalid query parameters',
        errors: parseResult.error.errors,
      });
      return;
    }

    const query = parseResult.data as GetSettlementsQuery;
    const skip = (query.page - 1) * query.pageSize;

    // Build where clause
    const whereClause: any = {};

    if (query.venueId) {
      whereClause.order = {
        venueId: query.venueId,
      };
    }

    if (query.status) {
      whereClause.status = query.status;
    }

    if (query.startDate || query.endDate) {
      whereClause.createdAt = {};
      if (query.startDate) {
        whereClause.createdAt.gte = query.startDate;
      }
      if (query.endDate) {
        whereClause.createdAt.lte = query.endDate;
      }
    }

    // Fetch total count
    const total = await prisma.payoutBatch.count({
      where: whereClause,
    });

    // Fetch batches with items
    const batches = await prisma.payoutBatch.findMany({
      where: whereClause,
      include: {
        order: {
          include: {
            venue: true,
            items: {
              include: {
                item: {
                  include: {
                    merchant: true,
                  },
                },
              },
            },
          },
        },
        items: {
          include: {
            merchant: true,
            staff: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.pageSize,
    });

    // Format response
    const rows = batches.map((batch) => {
      const partnerNames = new Set<string>();
      batch.order.items.forEach((oi) => {
        if (oi.item.merchant.merchantType === 'EXTERNAL_PARTNER') {
          partnerNames.add(oi.item.merchant.businessName);
        }
      });

      return {
        orderId: batch.orderId,
        venueName: batch.order.venue.businessName,
        partnerNames: Array.from(partnerNames),
        subtotalCents: Math.round(parseFloat(batch.order.subtotalAmount.toString()) * 100),
        taxCents: Math.round(parseFloat(batch.order.taxAmount.toString()) * 100),
        tipCents: Math.round(parseFloat(batch.order.tipAmount.toString()) * 100),
        platformFeeCents: Math.round(parseFloat(batch.order.platformFeeAmount.toString()) * 100),
        totalCents: Math.round(parseFloat(batch.order.totalAmount.toString()) * 100),
        status: batch.status,
        attempts: batch.attempts,
        lastError: batch.lastError,
        dispatchedAt: batch.dispatchedAt,
        createdAt: batch.createdAt,
      };
    });

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
    logger.error(
      { error: String(error) },
      'Error retrieving settlements'
    );
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve settlements',
    });
  }
}
