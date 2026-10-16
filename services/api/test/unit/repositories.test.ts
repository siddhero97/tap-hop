import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { MerchantType, OrderStatus as PrismaOrderStatus, PayoutStatus, UserRole } from '@tabhop/database';
import { Decimal } from '@prisma/client/runtime/library';
import { Currency } from '../../src/lib/currency';

const { mockPrisma, mockTx } = vi.hoisted(() => {
  const tx: { order: { create: Mock<any, any>; }; orderItem: { createMany: Mock<any, any>; }; payoutBatch: { create: Mock<any, any>; update: Mock<any, any>; }; payoutBatchItem: { createMany: Mock<any, any>; deleteMany: Mock<any, any>; }; } = {
    order: {
      create: vi.fn(),
    },
    orderItem: {
      createMany: vi.fn(),
    },
    payoutBatch: {
      create: vi.fn(),
      update: vi.fn(),
    },
    payoutBatchItem: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  return {
    mockTx: tx,
    mockPrisma: {
      platformSettings: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      merchant: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      staff: {
        findUnique: vi.fn(),
      },
      session: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      item: {
        findMany: vi.fn(),
      },
      order: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      orderItem: {
        createMany: vi.fn(),
      },
      payoutBatch: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      payoutBatchItem: {
        createMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      webhookEvent: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(async <T>(callback: (client: typeof tx) => Promise<T>): Promise<T> => {
        return callback(tx);
      }),
    },
  };
});

vi.mock('@tabhop/database', async (importOriginal) => {
  const actual: typeof import('@tabhop/database') = await importOriginal<typeof import('@tabhop/database')>();
  return {
    ...actual,
    prisma: mockPrisma,
  };
});

import {
  findPlatformSettingsById,
  upsertPlatformSettings,
} from '../../src/admin/admin.repository.js';
import type { PlatformSettingsRecordDto } from '../../src/admin/admin.model.js';

import {
  createSessionRecord,
  findUserByEmail,
  findMerchantById,
  findStaffById as findAuthStaffById,
  createUserRecord,
  findSessionByTokenHash,
  revokeSessionById,
  findSessionWithUserByTokenHash,
} from '../../src/auth/auth.repository.js';
import type {
  UserRecordDto,
  MerchantLookupDto,
  StaffLookupDto,
  SessionRecordDto,
  SessionWithUserRecordDto,
} from '../../src/auth/auth.model.js';

import {
  findActiveVenueItems,
  findVenueLocationById,
  findNearbyPartnerIds,
  findActivePartnerItemsByMerchantIds,
  findAllActivePartnerItems,
} from '../../src/catalog/catalog.repository.js';
import type {
  CatalogItemRecordDto,
  VenueLocationRecordDto,
  NearbyPartnerRowDto,
} from '../../src/catalog/catalog.model.js';

import {
  findOrderByIdempotencyKey,
  findItemsWithMerchantByIds,
  findVenueById,
  findStaffById as findOrderStaffById,
  createOrderWithItemsTransaction,
  findOrderWithDetailsById,
} from '../../src/orders/orders.repository.js';
import {
  RecipientType as OrderRecipientType,
  type OrderRecordDto,
  type OrderWithDetailsRecordDto,
  type VenueRecordDto,
  type StaffRecordDto,
  type CatalogItemWithMerchantRecordDto,
  type OrderWithItemsRecordDto,
} from '../../src/orders/orders.model.js';

import {
  findPaymentOrderById,
  updateOrderStatusFailed,
  updateOrderAuthorized,
  updateOrderCaptured,
} from '../../src/payments/payments.repository.js';
import type { PaymentOrderRecordDto } from '../../src/payments/payments.model.js';

import {
  findOrderForSettlementDispatch,
  savePayoutBatchTransaction,
  updatePayoutBatchDispatched,
  updatePayoutBatchFailed,
  findOrderWithBatchById,
  countPayoutBatches,
  findPayoutBatchesWithRelations,
} from '../../src/settlements/settlements.repository.js';
import type {
  SettlementOrderWithRelationsDto,
  SettlementOrderWithBatchDto,
  SettlementBatchWithRelationsDto,
  PayoutBatchRecordDto,
} from '../../src/settlements/settlements.model.js';

import {
  WebhookRepository,
  type WebhookPrismaClient,
} from '../../src/webhooks/webhooks.repository.js';
import type {
  WebhookEventRecordDto,
  WebhookOrderRecordDto,
  WebhookPayoutBatchRecordDto,
} from '../../src/webhooks/webhooks.model.js';

import {
  pingDatabase,
  type HealthPingRowDto,
} from '../../src/health/health.repository.js';

describe('Feature: Module Database Repositories and DTO Contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Scenario: AdminRepository queries PlatformSettings and returns PlatformSettingsRecordDto', () => {
    it('Given a singleton PlatformSettings row, When findPlatformSettingsById and upsertPlatformSettings are called, Then they return PlatformSettingsRecordDto', async () => {
      const configuredSettingsDto: PlatformSettingsRecordDto = {
        id: 'default',
        platformFeeBps: 300,
        taxRateBps: 850,
        updatedByUserId: 'user-exec-claire',
        updatedAt: new Date('2026-10-15T12:30:00.000Z'),
      };

      (mockPrisma.platformSettings.findUnique as Mock).mockResolvedValueOnce(configuredSettingsDto);
      (mockPrisma.platformSettings.upsert as Mock).mockResolvedValueOnce(configuredSettingsDto);

      const fetchedSettings: PlatformSettingsRecordDto | null =
        await findPlatformSettingsById('default');
      expect(fetchedSettings).toEqual(configuredSettingsDto);
      expect(mockPrisma.platformSettings.findUnique).toHaveBeenCalledWith({
        where: { id: 'default' },
      });

      const upsertedSettings: PlatformSettingsRecordDto = await upsertPlatformSettings({
        id: 'default',
        platformFeeBps: 300,
        taxRateBps: 850,
        updatedByUserId: 'user-exec-claire',
      });
      expect(upsertedSettings).toEqual(configuredSettingsDto);
      expect(mockPrisma.platformSettings.upsert).toHaveBeenCalledWith({
        where: { id: 'default' },
        create: {
          id: 'default',
          platformFeeBps: 300,
          taxRateBps: 850,
          updatedByUserId: 'user-exec-claire',
        },
        update: {
          platformFeeBps: 300,
          taxRateBps: 850,
          updatedByUserId: 'user-exec-claire',
        },
      });
    });
  });

  describe('Scenario: AuthRepository queries User, Session, Merchant, and Staff models with explicit DTOs', () => {
    it('Given bar guest Elena and bartender Marco, When AuthRepository methods are invoked, Then each returns its corresponding Auth DTO', async () => {
      const barGuestElenaDto: UserRecordDto = {
        id: 'user-patron-elena',
        email: 'elena.patron@example.com',
        passwordHash: 'scrypt:salt:hash',
        displayName: 'Elena Rostova',
        role: UserRole.PATRON,
        merchantId: null,
        staffId: null,
        isActive: true,
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
        updatedAt: new Date('2026-10-15T12:00:00.000Z'),
      };

      const copperKettleLookupDto: MerchantLookupDto = {
        id: 'venue-copper-kettle',
      };

      const bartenderMarcoLookupDto: StaffLookupDto = {
        id: 'staff-bartender-marco',
        venueId: 'venue-copper-kettle',
      };

      const elenaSessionDto: SessionRecordDto = {
        id: 'session-elena-1',
        tokenHash: 'sha256-session-token-hash',
        userId: barGuestElenaDto.id,
        expiresAt: new Date('2026-10-22T12:00:00.000Z'),
        revokedAt: null,
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
      };

      const elenaSessionWithUserDto: SessionWithUserRecordDto = {
        ...elenaSessionDto,
        user: barGuestElenaDto,
      };

      (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce(barGuestElenaDto);
      (mockPrisma.merchant.findUnique as Mock).mockResolvedValueOnce(copperKettleLookupDto);
      (mockPrisma.staff.findUnique as Mock).mockResolvedValueOnce(bartenderMarcoLookupDto);
      (mockPrisma.user.create as Mock).mockResolvedValueOnce(barGuestElenaDto);
      (mockPrisma.session.create as Mock).mockResolvedValueOnce(elenaSessionDto);
      (mockPrisma.session.findUnique as Mock)
        .mockResolvedValueOnce(elenaSessionDto)
        .mockResolvedValueOnce(elenaSessionWithUserDto);
      (mockPrisma.session.update as Mock).mockResolvedValueOnce({
        ...elenaSessionDto,
        revokedAt: new Date('2026-10-15T14:00:00.000Z'),
      });

      const foundUser: UserRecordDto | null = await findUserByEmail('elena.patron@example.com');
      expect(foundUser).toEqual(barGuestElenaDto);

      const foundMerchant: MerchantLookupDto | null = await findMerchantById('venue-copper-kettle');
      expect(foundMerchant).toEqual(copperKettleLookupDto);

      const foundStaff: StaffLookupDto | null = await findAuthStaffById('staff-bartender-marco');
      expect(foundStaff).toEqual(bartenderMarcoLookupDto);

      const createdUser: UserRecordDto = await createUserRecord({
        email: barGuestElenaDto.email,
        passwordHash: barGuestElenaDto.passwordHash,
        displayName: barGuestElenaDto.displayName,
        role: barGuestElenaDto.role,
        merchantId: null,
        staffId: null,
      });
      expect(createdUser).toEqual(barGuestElenaDto);

      const createdSession: SessionRecordDto = await createSessionRecord({
        tokenHash: elenaSessionDto.tokenHash,
        userId: barGuestElenaDto.id,
        expiresAt: elenaSessionDto.expiresAt,
      });
      expect(createdSession).toEqual(elenaSessionDto);

      const foundSession: SessionRecordDto | null = await findSessionByTokenHash(
        elenaSessionDto.tokenHash
      );
      expect(foundSession).toEqual(elenaSessionDto);

      const foundSessionWithUser: SessionWithUserRecordDto | null =
        await findSessionWithUserByTokenHash(elenaSessionDto.tokenHash);
      expect(foundSessionWithUser).toEqual(elenaSessionWithUserDto);

      const revokedSession: SessionRecordDto = await revokeSessionById(
        elenaSessionDto.id,
        new Date('2026-10-15T14:00:00.000Z')
      );
      expect(revokedSession.revokedAt).not.toBeNull();
    });
  });

  describe('Scenario: CatalogRepository queries Item, Merchant, and PostGIS spatial discovery with explicit DTOs', () => {
    it('Given Copper Kettle Brewery and SmokeStack BBQ Truck, When CatalogRepository methods run, Then they return Catalog DTOs', async () => {
      const hazyIpaItemDto: CatalogItemRecordDto = {
        id: 'item-hazy-ipa',
        merchantId: 'venue-copper-kettle',
        name: 'Copper Kettle Hazy IPA',
        description: 'Crisp citrus notes',
        price: new Decimal('8.50'),
        category: 'Craft Beer',
        isActive: true,
        metadata: null,
      };

      const copperKettleLocationDto: VenueLocationRecordDto = {
        id: 'venue-copper-kettle',
        merchantType: MerchantType.PRIMARY_VENUE,
        latitude: 30.2672,
        longitude: -97.7431,
        deliveryRadiusM: 500,
      };

      const nearbySmokeStackDto: NearbyPartnerRowDto = {
        id: 'partner-smokestack-bbq',
      };

      (mockPrisma.item.findMany as Mock)
        .mockResolvedValueOnce([hazyIpaItemDto])
        .mockResolvedValueOnce([hazyIpaItemDto])
        .mockResolvedValueOnce([hazyIpaItemDto]);
      (mockPrisma.merchant.findUnique as Mock).mockResolvedValueOnce(copperKettleLocationDto);
      (mockPrisma.$queryRaw as Mock).mockResolvedValueOnce([nearbySmokeStackDto]);

      const activeVenueItems: CatalogItemRecordDto[] =
        await findActiveVenueItems('venue-copper-kettle');
      expect(activeVenueItems).toEqual([hazyIpaItemDto]);

      const venueLocation: VenueLocationRecordDto | null =
        await findVenueLocationById('venue-copper-kettle');
      expect(venueLocation).toEqual(copperKettleLocationDto);

      const nearbyPartners: NearbyPartnerRowDto[] = await findNearbyPartnerIds(
        -97.7431,
        30.2672,
        500
      );
      expect(nearbyPartners).toEqual([nearbySmokeStackDto]);

      const partnerItemsByIds: CatalogItemRecordDto[] =
        await findActivePartnerItemsByMerchantIds(['partner-smokestack-bbq']);
      expect(partnerItemsByIds).toEqual([hazyIpaItemDto]);

      const allPartnerItems: CatalogItemRecordDto[] = await findAllActivePartnerItems();
      expect(allPartnerItems).toEqual([hazyIpaItemDto]);
    });
  });

  describe('Scenario: OrdersRepository queries Order, OrderItem, Item, Merchant, and Staff models with explicit DTOs', () => {
    it('Given a combined beer and brisket order at Copper Kettle Brewery, When OrdersRepository methods run, Then they return Order DTOs', async () => {
      const copperKettleVenueDto: VenueRecordDto = {
        id: 'venue-copper-kettle',
        merchantType: MerchantType.PRIMARY_VENUE,
      };

      const bartenderMarcoStaffDto: StaffRecordDto = {
        id: 'staff-bartender-marco',
        venueId: 'venue-copper-kettle',
      };

      const hazyIpaWithMerchantDto: CatalogItemWithMerchantRecordDto = {
        id: 'item-hazy-ipa',
        merchantId: copperKettleVenueDto.id,
        name: 'Copper Kettle Hazy IPA',
        price: new Decimal('8.00'),
        isActive: true,
        merchant: copperKettleVenueDto,
      };

      const elenaTaproomOrderDto: OrderRecordDto = {
        id: 'order-elena-taproom-1',
        venueId: copperKettleVenueDto.id,
        serverStaffId: bartenderMarcoStaffDto.id,
        tableNumber: 'Patio-12',
        status: PrismaOrderStatus.PENDING,
        subtotalAmount: new Decimal('16.00'),
        taxAmount: new Decimal('1.32'),
        tipAmount: new Decimal('3.00'),
        platformFeeAmount: new Decimal('0.40'),
        totalAmount: new Decimal('20.72'),
        currency: Currency.USD,
        idempotencyKey: 'idem-elena-1',
        paypalOrderId: null,
        paypalCaptureId: null,
        capturedAt: null,
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
      };

      const elenaOrderItemWithItemDto: { id: string; orderId: string; itemId: string; quantity: number; unitPrice: Decimal; item: { id: string; merchantId: string; name: string; price: Decimal; isActive: boolean; }; } = {
        id: 'order-item-ipa-1',
        orderId: elenaTaproomOrderDto.id,
        itemId: hazyIpaWithMerchantDto.id,
        quantity: 2,
        unitPrice: new Decimal('8.00'),
        item: {
          id: hazyIpaWithMerchantDto.id,
          merchantId: copperKettleVenueDto.id,
          name: hazyIpaWithMerchantDto.name,
          price: hazyIpaWithMerchantDto.price,
          isActive: true,
        },
      };

      const elenaOrderWithItemsDto: OrderWithItemsRecordDto = {
        ...elenaTaproomOrderDto,
        items: [elenaOrderItemWithItemDto],
      };

      const elenaOrderWithDetailsDto: OrderWithDetailsRecordDto = {
        ...elenaOrderWithItemsDto,
        payoutBatch: null,
      };

      (mockPrisma.order.findUnique as Mock)
        .mockResolvedValueOnce(elenaOrderWithItemsDto)
        .mockResolvedValueOnce(elenaOrderWithDetailsDto);
      (mockPrisma.merchant.findUnique as Mock).mockResolvedValueOnce(copperKettleVenueDto);
      (mockPrisma.staff.findUnique as Mock).mockResolvedValueOnce(bartenderMarcoStaffDto);
      (mockPrisma.item.findMany as Mock).mockResolvedValueOnce([hazyIpaWithMerchantDto]);
      (mockTx.order.create as Mock).mockResolvedValueOnce(elenaTaproomOrderDto);
      (mockTx.orderItem.createMany as Mock).mockResolvedValueOnce({ count: 1 });

      const foundByIdempotencyKey: OrderWithItemsRecordDto | null =
        await findOrderByIdempotencyKey('idem-elena-1');
      expect(foundByIdempotencyKey).toEqual(elenaOrderWithItemsDto);

      const foundDetailedOrder: OrderWithDetailsRecordDto | null = await findOrderWithDetailsById(
        elenaTaproomOrderDto.id
      );
      expect(foundDetailedOrder).toEqual(elenaOrderWithDetailsDto);

      const foundVenue: VenueRecordDto | null = await findVenueById(copperKettleVenueDto.id);
      expect(foundVenue).toEqual(copperKettleVenueDto);

      const foundStaff: StaffRecordDto | null = await findOrderStaffById(
        bartenderMarcoStaffDto.id
      );
      expect(foundStaff).toEqual(bartenderMarcoStaffDto);

      const foundItemsWithMerchant: CatalogItemWithMerchantRecordDto[] =
        await findItemsWithMerchantByIds([hazyIpaWithMerchantDto.id]);
      expect(foundItemsWithMerchant).toEqual([hazyIpaWithMerchantDto]);

      const createdOrder: OrderRecordDto = await createOrderWithItemsTransaction({
        venueId: copperKettleVenueDto.id,
        serverStaffId: bartenderMarcoStaffDto.id,
        tableNumber: 'Patio-12',
        idempotencyKey: 'idem-elena-1',
        subtotalAmount: new Decimal('16.00'),
        taxAmount: new Decimal('1.32'),
        tipAmount: 3.0,
        platformFeeAmount: new Decimal('0.40'),
        totalAmount: new Decimal('20.72'),
        lines: [
          {
            itemId: hazyIpaWithMerchantDto.id,
            quantity: 2,
            unitPrice: new Decimal('8.00'),
          },
        ],
      });
      expect(createdOrder).toEqual(elenaTaproomOrderDto);
    });
  });

  describe('Scenario: PaymentsRepository queries and updates Order payment state with PaymentOrderRecordDto', () => {
    it('Given a pending taproom order, When PaymentsRepository methods authorize, capture, or fail the order, Then they return PaymentOrderRecordDto', async () => {
      const pendingPaymentOrderDto: PaymentOrderRecordDto = {
        id: 'order-payment-1',
        status: PrismaOrderStatus.PENDING,
        totalAmount: new Decimal('25.65'),
        currency: Currency.USD,
        paypalOrderId: null,
        paypalCaptureId: null,
      };

      const authorizedPaymentOrderDto: PaymentOrderRecordDto = {
        ...pendingPaymentOrderDto,
        status: PrismaOrderStatus.AUTHORIZED,
        paypalOrderId: 'PAYPAL-ORDER-101',
      };

      const capturedPaymentOrderDto: PaymentOrderRecordDto = {
        ...authorizedPaymentOrderDto,
        status: PrismaOrderStatus.CAPTURED,
        paypalCaptureId: 'PAYPAL-CAPTURE-101',
      };

      const failedPaymentOrderDto: PaymentOrderRecordDto = {
        ...authorizedPaymentOrderDto,
        status: PrismaOrderStatus.FAILED,
      };

      (mockPrisma.order.findUnique as Mock).mockResolvedValueOnce(pendingPaymentOrderDto);
      (mockPrisma.order.update as Mock)
        .mockResolvedValueOnce(authorizedPaymentOrderDto)
        .mockResolvedValueOnce(capturedPaymentOrderDto)
        .mockResolvedValueOnce(failedPaymentOrderDto);

      const fetchedOrder: PaymentOrderRecordDto | null =
        await findPaymentOrderById('order-payment-1');
      expect(fetchedOrder).toEqual(pendingPaymentOrderDto);

      const authorizedOrder: PaymentOrderRecordDto = await updateOrderAuthorized(
        'order-payment-1',
        'PAYPAL-ORDER-101'
      );
      expect(authorizedOrder).toEqual(authorizedPaymentOrderDto);

      const capturedOrder: PaymentOrderRecordDto = await updateOrderCaptured(
        'order-payment-1',
        'PAYPAL-CAPTURE-101',
        new Date('2026-10-15T12:05:00.000Z')
      );
      expect(capturedOrder).toEqual(capturedPaymentOrderDto);

      const failedOrder: PaymentOrderRecordDto = await updateOrderStatusFailed('order-payment-1');
      expect(failedOrder).toEqual(failedPaymentOrderDto);
    });
  });

  describe('Scenario: SettlementsRepository queries Order, PayoutBatch, and PayoutBatchItem models with explicit DTOs', () => {
    it('Given a captured order ready for multi-merchant split payout, When SettlementsRepository methods execute, Then they return Settlement DTOs', async () => {
      const payoutBatchRecordDto: PayoutBatchRecordDto = {
        id: 'batch-copper-kettle-1',
        orderId: 'order-captured-1',
        paypalBatchId: 'PAYPAL-BATCH-1',
        status: PayoutStatus.COMPLETED,
        attempts: 1,
        lastError: null,
        dispatchedAt: new Date('2026-10-15T12:05:00.000Z'),
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
        updatedAt: new Date('2026-10-15T12:05:00.000Z'),
      };

      const settlementOrderDto: SettlementOrderWithRelationsDto = {
        id: 'order-captured-1',
        venueId: 'venue-copper-kettle',
        serverStaffId: null,
        status: PrismaOrderStatus.CAPTURED,
        subtotalAmount: new Decimal('20.00'),
        taxAmount: new Decimal('1.60'),
        tipAmount: new Decimal('3.00'),
        platformFeeAmount: new Decimal('1.00'),
        totalAmount: new Decimal('25.60'),
        venue: {
          id: 'venue-copper-kettle',
          paypalEmail: 'payouts@copperkettle.example.com',
        },
        serverStaff: null,
        items: [],
        payoutBatch: null,
      };

      (mockPrisma.order.findUnique as Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(settlementOrderDto)
        .mockResolvedValueOnce(null);
      (mockPrisma.payoutBatch.count as Mock).mockResolvedValueOnce(0);
      (mockPrisma.payoutBatch.findMany as Mock).mockResolvedValueOnce([]);

      await expect(findOrderForSettlementDispatch('order-missing')).rejects.toThrow(
        'Order not found: order-missing'
      );

      const foundOrder: SettlementOrderWithRelationsDto =
        await findOrderForSettlementDispatch('order-captured-1');
      expect(foundOrder).toEqual(settlementOrderDto);

      const missingOrderWithBatch: SettlementOrderWithBatchDto | null =
        await findOrderWithBatchById('order-missing');
      expect(missingOrderWithBatch).toBeNull();

      const batchCount: number = await countPayoutBatches({});
      expect(batchCount).toBe(0);

      const batchesWithRelations: SettlementBatchWithRelationsDto[] =
        await findPayoutBatchesWithRelations({ whereClause: {}, skip: 0, take: 10 });
      expect(batchesWithRelations).toEqual([]);

      // New payout batch inside transaction
      (mockTx.payoutBatch.create as Mock).mockResolvedValueOnce(payoutBatchRecordDto);
      (mockTx.payoutBatchItem.createMany as Mock).mockResolvedValueOnce({ count: 1 });

      const newBatchResult: PayoutBatchRecordDto = await savePayoutBatchTransaction({
        orderId: 'order-captured-1',
        existingBatch: null,
        split: [
          {
            merchantId: 'venue-copper-kettle',
            recipientType: OrderRecipientType.PRIMARY_VENUE,
            receiverEmail: 'payouts@copperkettle.example.com',
            amountCents: 2000,
          },
        ],
      });
      expect(newBatchResult).toEqual(payoutBatchRecordDto);

      // Existing payout batch retry inside transaction
      (mockTx.payoutBatchItem.deleteMany as Mock).mockResolvedValueOnce({ count: 1 });
      (mockTx.payoutBatch.update as Mock).mockResolvedValueOnce({
        ...payoutBatchRecordDto,
        attempts: 2,
      });
      (mockTx.payoutBatchItem.createMany as Mock).mockResolvedValueOnce({ count: 1 });

      const retriedBatchResult: PayoutBatchRecordDto = await savePayoutBatchTransaction({
        orderId: 'order-captured-1',
        existingBatch: payoutBatchRecordDto,
        split: [
          {
            staffId: 'staff-bartender-marco',
            recipientType: OrderRecipientType.STAFF_TIP,
            receiverEmail: 'marco.tips@example.com',
            amountCents: 300,
          },
        ],
      });
      expect(retriedBatchResult.attempts).toBe(2);

      (mockPrisma.payoutBatch.update as Mock)
        .mockResolvedValueOnce({ ...payoutBatchRecordDto, status: PayoutStatus.COMPLETED })
        .mockResolvedValueOnce({ ...payoutBatchRecordDto, status: PayoutStatus.FAILED });

      const dispatchedBatch: PayoutBatchRecordDto = await updatePayoutBatchDispatched({
        batchId: payoutBatchRecordDto.id,
        paypalBatchId: 'PAYPAL-BATCH-1',
        status: PayoutStatus.COMPLETED,
        dispatchedAt: new Date('2026-10-15T12:05:00.000Z'),
      });
      expect(dispatchedBatch.status).toBe(PayoutStatus.COMPLETED);

      const failedBatch: PayoutBatchRecordDto = await updatePayoutBatchFailed(
        payoutBatchRecordDto.id,
        'PayPal Payouts API timeout'
      );
      expect(failedBatch.status).toBe(PayoutStatus.FAILED);
    });
  });

  describe('Scenario: WebhookRepository and HealthRepository execute database operations with explicit DTOs', () => {
    it('Given PayPal webhook events and a health database ping, When WebhookRepository and pingDatabase run, Then they return their respective DTOs', async () => {
      const webhookRepo: WebhookRepository = new WebhookRepository(
        mockPrisma as unknown as WebhookPrismaClient
      );

      const webhookEventDto: WebhookEventRecordDto = {
        id: 'wh-record-1',
        eventId: 'WH-PAYPAL-001',
        eventType: 'PAYMENT.CAPTURE.COMPLETED',
        verified: true,
        processedAt: null,
      };

      const webhookOrderDto: WebhookOrderRecordDto = {
        id: 'order-wh-1',
        status: PrismaOrderStatus.CAPTURED,
        paypalOrderId: 'PAYPAL-ORDER-WH-1',
      };

      const webhookBatchDto: WebhookPayoutBatchRecordDto = {
        id: 'batch-wh-1',
        paypalBatchId: 'PAYPAL-BATCH-WH-1',
        status: PayoutStatus.COMPLETED,
      };

      (mockPrisma.webhookEvent.findUnique as Mock).mockResolvedValueOnce(webhookEventDto);
      (mockPrisma.webhookEvent.create as Mock).mockResolvedValueOnce(webhookEventDto);
      (mockPrisma.webhookEvent.update as Mock).mockResolvedValueOnce({
        ...webhookEventDto,
        processedAt: new Date('2026-10-15T12:01:00.000Z'),
      });
      (mockPrisma.order.findUnique as Mock).mockResolvedValueOnce(webhookOrderDto);
      (mockPrisma.order.update as Mock).mockResolvedValueOnce(webhookOrderDto);
      (mockPrisma.payoutBatch.findUnique as Mock).mockResolvedValueOnce(webhookBatchDto);
      (mockPrisma.payoutBatch.update as Mock).mockResolvedValueOnce(webhookBatchDto);

      expect(await webhookRepo.findWebhookEventByEventId('WH-PAYPAL-001')).toEqual(webhookEventDto);
      expect(
        await webhookRepo.createWebhookEvent({
          provider: 'paypal',
          eventId: 'WH-PAYPAL-001',
          eventType: 'PAYMENT.CAPTURE.COMPLETED',
          payload: { id: 'WH-PAYPAL-001', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
          verified: true,
        })
      ).toEqual(webhookEventDto);
      expect(
        (await webhookRepo.markWebhookEventProcessed('WH-PAYPAL-001', new Date())).processedAt
      ).not.toBeNull();
      expect(await webhookRepo.findOrderByPayPalOrderId('PAYPAL-ORDER-WH-1')).toEqual(
        webhookOrderDto
      );
      expect(await webhookRepo.markOrderCaptured('order-wh-1', new Date())).toEqual(
        webhookOrderDto
      );
      expect(await webhookRepo.findPayoutBatchByPayPalBatchId('PAYPAL-BATCH-WH-1')).toEqual(
        webhookBatchDto
      );
      expect(
        await webhookRepo.updatePayoutBatchStatus('batch-wh-1', PayoutStatus.COMPLETED)
      ).toEqual(webhookBatchDto);

      // HealthRepository pingDatabase
      const pingRowsDto: HealthPingRowDto[] = [{ '?column?': 1 }];
      (mockPrisma.$queryRaw as Mock).mockResolvedValueOnce(pingRowsDto);
      const pingResult: HealthPingRowDto[] = await pingDatabase();
      expect(pingResult).toEqual(pingRowsDto);
    });
  });
});
