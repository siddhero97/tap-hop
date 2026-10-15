export enum OrderStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
}

export enum RecipientType {
  PRIMARY_VENUE = 'PRIMARY_VENUE',
  PARTNER_MERCHANT = 'PARTNER_MERCHANT',
  STAFF_TIP = 'STAFF_TIP',
  PLATFORM_FEE = 'PLATFORM_FEE',
}

export interface OrderWithItems {
  id: string;
  venueId: string;
  serverStaffId?: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  platformFeeCents: number;
  totalCents: number;
  items: Array<{
    merchantId: string;
    merchantType: 'PRIMARY_VENUE' | 'EXTERNAL_PARTNER';
    commissionRate: number;
    lineCents: number;
  }>;
}

export interface SplitRow {
  recipientType: RecipientType;
  merchantId?: string;
  staffId?: string;
  receiverEmail: string;
  amountCents: number;
}
