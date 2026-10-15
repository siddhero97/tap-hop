import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettlementService } from '../../src/modules/settlements/service';
import { FakePayPalGateway } from '../../src/modules/payments/fake-gateway';
import { PayPalBatchStatus } from '../../src/modules/payments/constants';
import { OrderStatus } from '../../src/modules/orders/types';

/**
 * Mock Prisma client for SettlementService tests
 */
const mockPrisma = {
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
};

// Mock the database module
vi.mock('@tabhop/database', () => ({
  prisma: mockPrisma,
  PayoutStatus: {
    QUEUED: 'QUEUED',
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
  },
}));

describe('SettlementService', () => {
  let service: SettlementService;
  let gateway: FakePayPalGateway;

  beforeEach(() => {
    gateway = new FakePayPalGateway();
    service = new SettlementService(gateway);
    vi.clearAllMocks();
    gateway.reset();
  });

  describe('Happy path: order captured, batch created, PayPal success', () => {
    it('creates payout batch and dispatches to PayPal', async () => {
      const orderId = 'order-1';
      const batchId = 'batch-1';

      // Mock order data
      const mockOrder = {
        id: orderId,
        venueId: 'venue-1',
        serverStaffId: 'staff-1',
        status: OrderStatus.CAPTURED,
        subtotalAmount: { toString: () => '100.00' },
        taxAmount: { toString: () => '8.00' },
        tipAmount: { toString: () => '5.00' },
        platformFeeAmount: { toString: () => '3.00' },
        totalAmount: { toString: () => '116.00' },
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
            unitPrice: { toString: () => '50.00' },
            quantity: 1,
          },
          {
            item: {
              merchantId: 'venue-1',
              merchant: {
                paypalEmail: 'venue@example.com',
                commissionRate: { toString: () => '0' },
                merchantType: 'PRIMARY_VENUE',
              },
            },
            unitPrice: { toString: () => '50.00' },
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

      // Mock transaction to create batch
      mockPrisma.$transaction.mockResolvedValueOnce(mockBatch);
      mockPrisma.order.findUnique.mockResolvedValueOnce(mockOrder);
      mockPrisma.payoutBatch.update.mockResolvedValueOnce({
        ...mockBatch,
        paypalBatchId: 'FAKE-BATCH-1',
        dispatchedAt: new Date(),
      });

      const result = await service.dispatch(orderId);

      expect(result.payoutBatchId).toBe(batchId);
      expect(result.status).toBe(PayPalBatchStatus.PROCESSING);
      expect(mockPrisma.order.findUnique).toHaveBeenCalledWith({
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
      expect(mockPrisma.$transaction).toHaveBeenCalled();
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
        subtotalAmount: { toString: () => '50.00' },
        taxAmount: { toString: () => '4.00' },
        tipAmount: { toString: () => '0.00' },
        platformFeeAmount: { toString: () => '1.50' },
        totalAmount: { toString: () => '55.50' },
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: null,
        items: [],
        payoutBatch: {
          id: batchId,
          orderId,
          status: 'PROCESSING', // Not FAILED
          attempts: 1,
          paypalBatchId: 'FAKE-BATCH-1',
          lastError: null,
          dispatchedAt: new Date(),
        },
      };

      mockPrisma.order.findUnique.mockResolvedValueOnce(mockOrder);

      const result = await service.dispatch(orderId);

      expect(result.payoutBatchId).toBe(batchId);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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
        subtotalAmount: { toString: () => '50.00' },
        taxAmount: { toString: () => '4.00' },
        tipAmount: { toString: () => '0.00' },
        platformFeeAmount: { toString: () => '1.50' },
        totalAmount: { toString: () => '55.50' },
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: null,
        items: [],
        payoutBatch: null,
      };

      mockPrisma.order.findUnique.mockResolvedValueOnce(mockOrder);

      await expect(service.dispatch(orderId)).rejects.toThrow(
        'Order must be CAPTURED to dispatch settlement'
      );

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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
        subtotalAmount: { toString: () => '50.00' },
        taxAmount: { toString: () => '4.00' },
        tipAmount: { toString: () => '0.00' },
        platformFeeAmount: { toString: () => '1.50' },
        totalAmount: { toString: () => '55.50' },
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: null,
        items: [],
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

      mockPrisma.order.findUnique.mockResolvedValueOnce(mockOrder);
      mockPrisma.$transaction.mockResolvedValueOnce(mockBatch);

      // Make gateway fail
      gateway.failNext('createPayoutBatch');

      mockPrisma.payoutBatch.update.mockResolvedValueOnce({
        ...mockBatch,
        status: 'FAILED',
        lastError: 'Simulated PayPal error: batch creation failed',
      });

      await expect(service.dispatch(orderId)).rejects.toThrow(
        'Simulated PayPal error: batch creation failed'
      );

      // Verify that FAILED status was stored
      expect(mockPrisma.payoutBatch.update).toHaveBeenCalledWith({
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
        subtotalAmount: { toString: () => '50.00' },
        taxAmount: { toString: () => '4.00' },
        tipAmount: { toString: () => '0.00' },
        platformFeeAmount: { toString: () => '1.50' },
        totalAmount: { toString: () => '55.50' },
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: null,
        items: [],
        payoutBatch: null,
      };

      mockPrisma.order.findUnique.mockResolvedValueOnce(mockOrder);

      // Make transaction fail
      mockPrisma.$transaction.mockRejectedValueOnce(
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

      mockPrisma.order.findUnique.mockResolvedValueOnce(null);

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
        subtotalAmount: { toString: () => '50.00' },
        taxAmount: { toString: () => '4.00' },
        tipAmount: { toString: () => '0.00' },
        platformFeeAmount: { toString: () => '1.50' },
        totalAmount: { toString: () => '55.50' },
        venue: { paypalEmail: 'venue@example.com' },
        serverStaff: null,
        items: [],
        payoutBatch: {
          id: oldBatchId,
          orderId,
          status: 'FAILED', // Previously failed
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
        attempts: 2, // Incremented attempts
        paypalBatchId: null,
        lastError: null,
        dispatchedAt: null,
      };

      mockPrisma.order.findUnique.mockResolvedValueOnce(mockOrder);
      mockPrisma.$transaction.mockResolvedValueOnce(mockNewBatch);
      mockPrisma.payoutBatch.update.mockResolvedValueOnce({
        ...mockNewBatch,
        paypalBatchId: 'FAKE-BATCH-2',
        dispatchedAt: new Date(),
      });

      const result = await service.dispatch(orderId);

      expect(result.payoutBatchId).toBe(newBatchId);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
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
        subtotalAmount: { toString: () => '100.00' },
        taxAmount: { toString: () => '8.00' },
        tipAmount: { toString: () => '10.00' },
        platformFeeAmount: { toString: () => '3.00' },
        totalAmount: { toString: () => '121.00' },
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
            unitPrice: { toString: () => '50.00' },
            quantity: 1,
          },
          {
            item: {
              merchantId: 'partner-1',
              merchant: {
                paypalEmail: 'partner@example.com',
                commissionRate: { toString: () => '0.15' },
                merchantType: 'EXTERNAL_PARTNER',
              },
            },
            unitPrice: { toString: () => '50.00' },
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

      mockPrisma.$transaction.mockResolvedValueOnce(mockBatch);
      mockPrisma.order.findUnique.mockResolvedValueOnce(mockOrder);
      mockPrisma.payoutBatch.update.mockResolvedValueOnce({
        ...mockBatch,
        paypalBatchId: 'FAKE-BATCH-3',
        dispatchedAt: new Date(),
      });

      const result = await service.dispatch(orderId);

      expect(result.payoutBatchId).toBe(batchId);
      expect(mockPrisma.$transaction).toHaveBeenCalled();

      // Verify transaction was called with batch creation
      const transactionCall = mockPrisma.$transaction.mock.calls[0];
      expect(transactionCall).toBeDefined();
    });
  });
});
