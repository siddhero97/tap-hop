import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OrderStatus } from '../../src/orders/orders.model';
import { PayPalBatchStatus } from '../../src/payments/payments.model';
import { FakePayPalGateway } from '../../src/payments/payments.fake-gateway';

// Set up mock BEFORE importing SettlementService
vi.mock('@tabhop/database', () => ({
  prisma: {
    order: {
      findUnique: vi.fn(),
    },
    payoutBatch: {
      create: vi.fn(),
      update: vi.fn(),
    },
    payoutBatchItem: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  PayoutStatus: {
    QUEUED: 'QUEUED',
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
  },
}));

// Now import SettlementService after mock is set up
import { SettlementService } from '../../src/settlements/settlements.service';
import { prisma } from '@tabhop/database';

/**
 * Helper to create a mock Decimal that behaves like Prisma Decimal
 */
function mockDecimal(value: string): any {
  return {
    toString: () => value,
    toFixed: (places: number) => parseFloat(value).toFixed(places),
  };
}

describe('SettlementService', () => {
  let service: SettlementService;
  let gateway: FakePayPalGateway;

  beforeEach(() => {
    gateway = new FakePayPalGateway();
    service = new SettlementService(gateway);
    vi.clearAllMocks();
    gateway.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Reset all mock call history
    if (vi.mocked(prisma.order.findUnique)) {
      vi.mocked(prisma.order.findUnique).mockClear();
    }
    if (vi.mocked(prisma.$transaction)) {
      vi.mocked(prisma.$transaction).mockClear();
    }
    if (vi.mocked(prisma.payoutBatch.update)) {
      vi.mocked(prisma.payoutBatch.update).mockClear();
    }
    if (vi.mocked(prisma.payoutBatchItem.createMany)) {
      vi.mocked(prisma.payoutBatchItem.createMany).mockClear();
    }
  });

  describe('Happy path: order captured, batch created, PayPal success', () => {
    it('creates payout batch and dispatches to PayPal', async () => {
      const orderId = 'order-1';
      const batchId = 'batch-1';

      const mockOrder = {
        id: orderId,
        venueId: 'venue-1',
        serverStaffId: 'staff-1',
        status: OrderStatus.CAPTURED,
        subtotalAmount: mockDecimal('100.00'),
        taxAmount: mockDecimal('8.00'),
        tipAmount: mockDecimal('5.00'),
        platformFeeAmount: mockDecimal('3.00'),
        totalAmount: mockDecimal('116.00'),
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: { paypalEmail: 'staff@example.com' },
        items: [
          {
            item: {
              merchantId: 'venue-1',
              merchant: {
                paypalEmail: 'venue@example.com',
                commissionRate: mockDecimal('0.15'),
                merchantType: 'PRIMARY_VENUE',
              },
            },
            unitPrice: mockDecimal('50.00'),
            quantity: 1,
          },
          {
            item: {
              merchantId: 'venue-1',
              merchant: {
                paypalEmail: 'venue@example.com',
                commissionRate: mockDecimal('0.15'),
                merchantType: 'PRIMARY_VENUE',
              },
            },
            unitPrice: mockDecimal('50.00'),
            quantity: 1,
          },
        ],
        payoutBatch: null,
      };

      const mockBatch = {
        id: batchId,
        orderId,
        status: 'PROCESSING',
        attempts: 1,
        paypalBatchId: null,
        lastError: null,
        dispatchedAt: null,
      };

      vi.mocked(prisma.$transaction).mockResolvedValueOnce(mockBatch as any);
      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder as any);
      vi.mocked(prisma.payoutBatch.update).mockResolvedValueOnce({
        ...mockBatch,
        paypalBatchId: 'FAKE-BATCH-1',
        dispatchedAt: new Date(),
      } as any);

      const result = await service.dispatch(orderId);

      expect(result.payoutBatchId).toBe(batchId);
      expect(result.status).toBe(PayPalBatchStatus.PROCESSING);
      expect(vi.mocked(prisma.order.findUnique)).toHaveBeenCalledWith({
        where: { id: orderId },
        include: {
          venue: true,
          serverStaff: true,
          items: {
            include: {
              item: {
                include: {
                  merchant: true,
                },
              },
            },
          },
          payoutBatch: true,
        },
      });
      expect(vi.mocked(prisma.$transaction)).toHaveBeenCalled();
    });
  });

  describe('Idempotent: already has batch', () => {
    it('returns existing batch without calling PayPal again', async () => {
      const orderId = 'order-2';
      const batchId = 'batch-2';

      const mockOrder = {
        id: orderId,
        venueId: 'venue-1',
        serverStaffId: null,
        status: OrderStatus.CAPTURED,
        subtotalAmount: mockDecimal('50.00'),
        taxAmount: mockDecimal('4.00'),
        tipAmount: mockDecimal('0.00'),
        platformFeeAmount: mockDecimal('1.50'),
        totalAmount: mockDecimal('55.50'),
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: null,
        items: [
          {
            item: {
              merchantId: 'venue-1',
              merchant: {
                paypalEmail: 'venue@example.com',
                commissionRate: mockDecimal('0.15'),
                merchantType: 'PRIMARY_VENUE',
              },
            },
            unitPrice: mockDecimal('50.00'),
            quantity: 1,
          },
        ],
        payoutBatch: {
          id: batchId,
          orderId,
          status: 'PROCESSING',
          attempts: 1,
          paypalBatchId: 'FAKE-BATCH-1',
          lastError: null,
          dispatchedAt: new Date(),
        },
      };

      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder as any);

      const result = await service.dispatch(orderId);

      expect(result.payoutBatchId).toBe(batchId);
      expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled();
      expect(gateway.getCalls().length).toBe(0);
    });
  });

  describe('Order not captured', () => {
    it('throws when order status is not CAPTURED', async () => {
      const orderId = 'order-3';

      const mockOrder = {
        id: orderId,
        venueId: 'venue-1',
        serverStaffId: null,
        status: OrderStatus.PENDING,
        subtotalAmount: mockDecimal('50.00'),
        taxAmount: mockDecimal('4.00'),
        tipAmount: mockDecimal('0.00'),
        platformFeeAmount: mockDecimal('1.50'),
        totalAmount: mockDecimal('55.50'),
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: null,
        items: [],
        payoutBatch: null,
      };

      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder as any);

      await expect(service.dispatch(orderId)).rejects.toThrow(
        'Order must be CAPTURED to dispatch settlement'
      );

      expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled();
    });
  });

  describe('PayPal error', () => {
    it('stores FAILED status and rethrows error', async () => {
      const orderId = 'order-4';
      const batchId = 'batch-4';

      const mockOrder = {
        id: orderId,
        venueId: 'venue-1',
        serverStaffId: null,
        status: OrderStatus.CAPTURED,
        subtotalAmount: mockDecimal('50.00'),
        taxAmount: mockDecimal('4.00'),
        tipAmount: mockDecimal('0.00'),
        platformFeeAmount: mockDecimal('1.50'),
        totalAmount: mockDecimal('55.50'),
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: null,
        items: [
          {
            item: {
              merchantId: 'venue-1',
              merchant: {
                paypalEmail: 'venue@example.com',
                commissionRate: mockDecimal('0.15'),
                merchantType: 'PRIMARY_VENUE',
              },
            },
            unitPrice: mockDecimal('50.00'),
            quantity: 1,
          },
        ],
        payoutBatch: null,
      };

      const mockBatch = {
        id: batchId,
        orderId,
        status: 'PROCESSING',
        attempts: 1,
        paypalBatchId: null,
        lastError: null,
        dispatchedAt: null,
      };

      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder as any);
      vi.mocked(prisma.$transaction).mockResolvedValueOnce(mockBatch as any);

      gateway.failNext('createPayoutBatch');

      vi.mocked(prisma.payoutBatch.update).mockResolvedValueOnce({
        ...mockBatch,
        status: 'FAILED',
        lastError: 'Simulated PayPal error: batch creation failed',
      } as any);

      await expect(service.dispatch(orderId)).rejects.toThrow(
        'Simulated PayPal error: batch creation failed'
      );

      expect(vi.mocked(prisma.payoutBatch.update)).toHaveBeenCalledWith({
        where: { id: batchId },
        data: {
          status: 'FAILED',
          lastError: 'Simulated PayPal error: batch creation failed',
        },
      });
    });
  });

  describe('Database transaction rollback on error', () => {
    it('rolls back transaction when batch creation fails', async () => {
      const orderId = 'order-5';

      const mockOrder = {
        id: orderId,
        venueId: 'venue-1',
        serverStaffId: null,
        status: OrderStatus.CAPTURED,
        subtotalAmount: mockDecimal('50.00'),
        taxAmount: mockDecimal('4.00'),
        tipAmount: mockDecimal('0.00'),
        platformFeeAmount: mockDecimal('1.50'),
        totalAmount: mockDecimal('55.50'),
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: null,
        items: [
          {
            item: {
              merchantId: 'venue-1',
              merchant: {
                paypalEmail: 'venue@example.com',
                commissionRate: mockDecimal('0.15'),
                merchantType: 'PRIMARY_VENUE',
              },
            },
            unitPrice: mockDecimal('50.00'),
            quantity: 1,
          },
        ],
        payoutBatch: null,
      };

      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder as any);
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(
        new Error('Database constraint violation')
      );

      await expect(service.dispatch(orderId)).rejects.toThrow(
        'Failed to create payout batch'
      );
    });
  });

  describe('Order not found', () => {
    it('throws when order does not exist', async () => {
      const orderId = 'order-nonexistent';

      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null);

      await expect(service.dispatch(orderId)).rejects.toThrow(
        `Order not found: ${orderId}`
      );
    });
  });

  describe('Retry with failed batch', () => {
    it('retries and creates new batch when previous was FAILED', async () => {
      const orderId = 'order-6';
      const oldBatchId = 'batch-6-old';
      const newBatchId = 'batch-6-new';

      const mockOrder = {
        id: orderId,
        venueId: 'venue-1',
        serverStaffId: null,
        status: OrderStatus.CAPTURED,
        subtotalAmount: mockDecimal('50.00'),
        taxAmount: mockDecimal('4.00'),
        tipAmount: mockDecimal('0.00'),
        platformFeeAmount: mockDecimal('1.50'),
        totalAmount: mockDecimal('55.50'),
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: null,
        items: [
          {
            item: {
              merchantId: 'venue-1',
              merchant: {
                paypalEmail: 'venue@example.com',
                commissionRate: mockDecimal('0.15'),
                merchantType: 'PRIMARY_VENUE',
              },
            },
            unitPrice: mockDecimal('50.00'),
            quantity: 1,
          },
        ],
        payoutBatch: {
          id: oldBatchId,
          orderId,
          status: 'FAILED',
          attempts: 1,
          paypalBatchId: null,
          lastError: 'Previous error',
          dispatchedAt: null,
        },
      };

      const mockNewBatch = {
        id: newBatchId,
        orderId,
        status: 'PROCESSING',
        attempts: 2,
        paypalBatchId: null,
        lastError: null,
        dispatchedAt: null,
      };

      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder as any);
      vi.mocked(prisma.$transaction).mockResolvedValueOnce(mockNewBatch as any);
      vi.mocked(prisma.payoutBatch.update).mockResolvedValueOnce({
        ...mockNewBatch,
        paypalBatchId: 'FAKE-BATCH-2',
        dispatchedAt: new Date(),
      } as any);

      const result = await service.dispatch(orderId);

      expect(result.payoutBatchId).toBe(newBatchId);
      expect(vi.mocked(prisma.$transaction)).toHaveBeenCalled();
    });
  });

  describe('Multiple recipients with different roles', () => {
    it('creates batch items for venue, partner, and staff', async () => {
      const orderId = 'order-7';
      const batchId = 'batch-7';

      const mockOrder = {
        id: orderId,
        venueId: 'venue-1',
        serverStaffId: 'staff-1',
        status: OrderStatus.CAPTURED,
        subtotalAmount: mockDecimal('100.00'),
        taxAmount: mockDecimal('8.00'),
        tipAmount: mockDecimal('10.00'),
        platformFeeAmount: mockDecimal('3.00'),
        totalAmount: mockDecimal('121.00'),
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: { paypalEmail: 'staff@example.com' },
        items: [
          {
            item: {
              merchantId: 'venue-1',
              merchant: {
                paypalEmail: 'venue@example.com',
                commissionRate: { toString: () => '0' },
                merchantType: 'PRIMARY_VENUE',
              },
            },
            unitPrice: mockDecimal('50.00'),
            quantity: 1,
          },
          {
            item: {
              merchantId: 'partner-1',
              merchant: {
                paypalEmail: 'partner@example.com',
                commissionRate: mockDecimal('0.15'),
                merchantType: 'EXTERNAL_PARTNER',
              },
            },
            unitPrice: mockDecimal('50.00'),
            quantity: 1,
          },
        ],
        payoutBatch: null,
      };

      const mockBatch = {
        id: batchId,
        orderId,
        status: 'PROCESSING',
        attempts: 1,
        paypalBatchId: null,
        lastError: null,
        dispatchedAt: null,
      };

      vi.mocked(prisma.$transaction).mockResolvedValueOnce(mockBatch as any);
      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder as any);
      vi.mocked(prisma.payoutBatch.update).mockResolvedValueOnce({
        ...mockBatch,
        paypalBatchId: 'FAKE-BATCH-3',
        dispatchedAt: new Date(),
      } as any);

      const result = await service.dispatch(orderId);

      expect(result.payoutBatchId).toBe(batchId);
      expect(vi.mocked(prisma.$transaction)).toHaveBeenCalled();
    });
  });
});
