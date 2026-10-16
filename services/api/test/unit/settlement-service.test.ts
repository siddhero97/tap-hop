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
  MerchantType: {
    PRIMARY_VENUE: 'PRIMARY_VENUE',
    EXTERNAL_PARTNER: 'EXTERNAL_PARTNER',
  },
}));

// Now import SettlementService after mock is set up
import { SettlementService } from '../../src/settlements/settlements.service';
import { prisma } from '@tabhop/database';

export interface MockDecimalLike {
  toString(): string;
  toFixed(places: number): string;
}

/**
 * Helper to create a mock Decimal that behaves like Prisma Decimal
 */
function mockDecimal(value: string): MockDecimalLike {
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
      const orderId: string = 'order-1';
      const batchId: string = 'batch-1';

      const mockOrder: { id: string; venueId: string; serverStaffId: string; status: OrderStatus; subtotalAmount: MockDecimalLike; taxAmount: MockDecimalLike; tipAmount: MockDecimalLike; platformFeeAmount: MockDecimalLike; totalAmount: MockDecimalLike; venue: { paypalEmail: string; }; serverStaff: { paypalEmail: string; }; items: { item: { merchantId: string; merchant: { paypalEmail: string; commissionRate: MockDecimalLike; merchantType: string; }; }; unitPrice: MockDecimalLike; quantity: number; }[]; payoutBatch: null; } = {
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

      const mockBatch: { id: string; orderId: string; status: string; attempts: number; paypalBatchId: null; lastError: null; dispatchedAt: null; } = {
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

      const result: { payoutBatchId: string; status: PayPalBatchStatus } = await service.dispatch(orderId);

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
      const orderId: string = 'order-2';
      const batchId: string = 'batch-2';

      const mockOrder: { id: string; venueId: string; serverStaffId: null; status: OrderStatus; subtotalAmount: MockDecimalLike; taxAmount: MockDecimalLike; tipAmount: MockDecimalLike; platformFeeAmount: MockDecimalLike; totalAmount: MockDecimalLike; venue: { paypalEmail: string; }; serverStaff: null; items: { item: { merchantId: string; merchant: { paypalEmail: string; commissionRate: MockDecimalLike; merchantType: string; }; }; unitPrice: MockDecimalLike; quantity: number; }[]; payoutBatch: { id: string; orderId: string; status: string; attempts: number; paypalBatchId: string; lastError: null; dispatchedAt: Date; }; } = {
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

      const result: { payoutBatchId: string; status: PayPalBatchStatus } = await service.dispatch(orderId);

      expect(result.payoutBatchId).toBe(batchId);
      expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled();
      expect(gateway.getCalls().length).toBe(0);
    });
  });

  describe('Order not captured', () => {
    it('throws when order status is not CAPTURED', async () => {
      const orderId: string = 'order-3';

      const mockOrder: { id: string; venueId: string; serverStaffId: null; status: OrderStatus; subtotalAmount: MockDecimalLike; taxAmount: MockDecimalLike; tipAmount: MockDecimalLike; platformFeeAmount: MockDecimalLike; totalAmount: MockDecimalLike; venue: { paypalEmail: string; }; serverStaff: null; items: never[]; payoutBatch: null; } = {
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
      const orderId: string = 'order-4';
      const batchId: string = 'batch-4';

      const mockOrder: { id: string; venueId: string; serverStaffId: null; status: OrderStatus; subtotalAmount: MockDecimalLike; taxAmount: MockDecimalLike; tipAmount: MockDecimalLike; platformFeeAmount: MockDecimalLike; totalAmount: MockDecimalLike; venue: { paypalEmail: string; }; serverStaff: null; items: { item: { merchantId: string; merchant: { paypalEmail: string; commissionRate: MockDecimalLike; merchantType: string; }; }; unitPrice: MockDecimalLike; quantity: number; }[]; payoutBatch: null; } = {
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

      const mockBatch: { id: string; orderId: string; status: string; attempts: number; paypalBatchId: null; lastError: null; dispatchedAt: null; } = {
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
      const orderId: string = 'order-5';

      const mockOrder: { id: string; venueId: string; serverStaffId: null; status: OrderStatus; subtotalAmount: MockDecimalLike; taxAmount: MockDecimalLike; tipAmount: MockDecimalLike; platformFeeAmount: MockDecimalLike; totalAmount: MockDecimalLike; venue: { paypalEmail: string; }; serverStaff: null; items: { item: { merchantId: string; merchant: { paypalEmail: string; commissionRate: MockDecimalLike; merchantType: string; }; }; unitPrice: MockDecimalLike; quantity: number; }[]; payoutBatch: null; } = {
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
      const orderId: string = 'order-nonexistent';

      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null);

      await expect(service.dispatch(orderId)).rejects.toThrow(
        `Order not found: ${orderId}`
      );
    });
  });

  describe('Retry with failed batch', () => {
    it('retries and creates new batch when previous was FAILED', async () => {
      const orderId: string = 'order-6';
      const oldBatchId: string = 'batch-6-old';
      const newBatchId: string = 'batch-6-new';

      const mockOrder: { id: string; venueId: string; serverStaffId: null; status: OrderStatus; subtotalAmount: MockDecimalLike; taxAmount: MockDecimalLike; tipAmount: MockDecimalLike; platformFeeAmount: MockDecimalLike; totalAmount: MockDecimalLike; venue: { paypalEmail: string; }; serverStaff: null; items: { item: { merchantId: string; merchant: { paypalEmail: string; commissionRate: MockDecimalLike; merchantType: string; }; }; unitPrice: MockDecimalLike; quantity: number; }[]; payoutBatch: { id: string; orderId: string; status: string; attempts: number; paypalBatchId: null; lastError: string; dispatchedAt: null; }; } = {
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

      const mockNewBatch: { id: string; orderId: string; status: string; attempts: number; paypalBatchId: null; lastError: null; dispatchedAt: null; } = {
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

      const result: { payoutBatchId: string; status: PayPalBatchStatus } = await service.dispatch(orderId);

      expect(result.payoutBatchId).toBe(newBatchId);
      expect(vi.mocked(prisma.$transaction)).toHaveBeenCalled();
    });
  });

  describe('Multiple recipients with different roles', () => {
    it('creates batch items for venue, partner, and staff', async () => {
      const orderId: string = 'order-7';
      const batchId: string = 'batch-7';

      const mockOrder: { id: string; venueId: string; serverStaffId: string; status: OrderStatus; subtotalAmount: MockDecimalLike; taxAmount: MockDecimalLike; tipAmount: MockDecimalLike; platformFeeAmount: MockDecimalLike; totalAmount: MockDecimalLike; venue: { paypalEmail: string; }; serverStaff: { paypalEmail: string; }; items: ({ item: { merchantId: string; merchant: { paypalEmail: string; commissionRate: { toString: () => string; }; merchantType: string; }; }; unitPrice: MockDecimalLike; quantity: number; } | { item: { merchantId: string; merchant: { paypalEmail: string; commissionRate: MockDecimalLike; merchantType: string; }; }; unitPrice: MockDecimalLike; quantity: number; })[]; payoutBatch: null; } = {
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

      const mockBatch: { id: string; orderId: string; status: string; attempts: number; paypalBatchId: null; lastError: null; dispatchedAt: null; } = {
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

      const result: { payoutBatchId: string; status: PayPalBatchStatus } = await service.dispatch(orderId);

      expect(result.payoutBatchId).toBe(batchId);
      expect(vi.mocked(prisma.$transaction)).toHaveBeenCalled();
    });
  });

  describe('Status mapping branches', () => {
    it('maps existing QUEUED and COMPLETED payout batches on idempotent dispatch', async () => {
      const baseOrder: { id: string; venueId: string; serverStaffId: null; status: OrderStatus; subtotalAmount: MockDecimalLike; taxAmount: MockDecimalLike; tipAmount: MockDecimalLike; platformFeeAmount: MockDecimalLike; totalAmount: MockDecimalLike; venue: { paypalEmail: string; }; serverStaff: null; items: never[]; } = {
        id: 'order-status-map',
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
        items: [],
      };

      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
        ...baseOrder,
        payoutBatch: { id: 'b-queued', status: 'QUEUED', attempts: 1 },
      } as any);
      const resQueued: { payoutBatchId: string; status: PayPalBatchStatus } = await service.dispatch('order-status-map');
      expect(resQueued.status).toBe(PayPalBatchStatus.PENDING);

      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
        ...baseOrder,
        payoutBatch: { id: 'b-completed', status: 'COMPLETED', attempts: 1 },
      } as any);
      const resCompleted: { payoutBatchId: string; status: PayPalBatchStatus } = await service.dispatch('order-status-map');
      expect(resCompleted.status).toBe(PayPalBatchStatus.SUCCESS);
    });

    it('maps PayPalBatchStatus values and throws on unknown statuses', () => {
      const internalService: {
        mapPayoutStatusToPayPalBatchStatus(status: string): PayPalBatchStatus;
        mapPayPalBatchStatusToPayoutStatus(status: string): string;
      } = service as unknown as {
        mapPayoutStatusToPayPalBatchStatus(status: string): PayPalBatchStatus;
        mapPayPalBatchStatusToPayoutStatus(status: string): string;
      };
      expect(internalService.mapPayoutStatusToPayPalBatchStatus('FAILED')).toBe(
        PayPalBatchStatus.FAILED
      );
      expect(() => internalService.mapPayoutStatusToPayPalBatchStatus('UNKNOWN')).toThrow(
        'Unknown PayoutStatus: UNKNOWN'
      );

      expect(
        internalService.mapPayPalBatchStatusToPayoutStatus(PayPalBatchStatus.PENDING)
      ).toBe('QUEUED');
      expect(
        internalService.mapPayPalBatchStatusToPayoutStatus(PayPalBatchStatus.PROCESSING)
      ).toBe('PROCESSING');
      expect(
        internalService.mapPayPalBatchStatusToPayoutStatus(PayPalBatchStatus.SUCCESS)
      ).toBe('COMPLETED');
      expect(
        internalService.mapPayPalBatchStatusToPayoutStatus(PayPalBatchStatus.FAILED)
      ).toBe('FAILED');
      expect(
        internalService.mapPayPalBatchStatusToPayoutStatus(PayPalBatchStatus.DENIED)
      ).toBe('FAILED');
      expect(() => internalService.mapPayPalBatchStatusToPayoutStatus('UNKNOWN')).toThrow(
        'Unknown PayPalBatchStatus: UNKNOWN'
      );
    });

    it('handles $transaction errors with and without constraint/transaction keywords', async () => {
      const baseOrder: { id: string; venueId: string; serverStaffId: null; status: OrderStatus; subtotalAmount: MockDecimalLike; taxAmount: MockDecimalLike; tipAmount: MockDecimalLike; platformFeeAmount: MockDecimalLike; totalAmount: MockDecimalLike; venue: { paypalEmail: string; }; serverStaff: null; items: { quantity: number; unitPrice: MockDecimalLike; item: { merchantId: string; merchant: { id: string; merchantType: string; commissionRate: MockDecimalLike; paypalEmail: string; }; }; }[]; payoutBatch: null; } = {
        id: 'order-tx-err',
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
            quantity: 1,
            unitPrice: mockDecimal('50.00'),
            item: {
              merchantId: 'venue-1',
              merchant: {
                id: 'venue-1',
                merchantType: 'PRIMARY_VENUE',
                commissionRate: mockDecimal('0.15'),
                paypalEmail: 'venue@example.com',
              },
            },
          },
        ],
        payoutBatch: null,
      };

      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(baseOrder as any);
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('transaction aborted'));
      await expect(service.dispatch('order-tx-err')).rejects.toThrow(
        'Failed to create payout batch: transaction aborted'
      );

      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(baseOrder as any);
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.dispatch('order-tx-err')).rejects.toThrow('connection lost');
    });
  });
});
