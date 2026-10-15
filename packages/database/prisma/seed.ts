import 'dotenv/config.js';
import { prisma } from '../src/index.js';
import { MerchantType } from '@prisma/client';

async function main() {
  console.log('Clearing existing data...');
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.payoutBatchItem.deleteMany();
  await prisma.payoutBatch.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.item.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.merchant.deleteMany();

  console.log('Creating merchants...');
  const venue = await prisma.merchant.create({
    data: {
      businessName: 'The Copper Still',
      merchantType: MerchantType.PRIMARY_VENUE,
      paypalEmail: 'venue@sandbox.paypal.com',
      commissionRate: 0.15,
    },
  });

  const partner1 = await prisma.merchant.create({
    data: {
      businessName: 'Churro & Co.',
      merchantType: MerchantType.EXTERNAL_PARTNER,
      paypalEmail: 'churros@sandbox.paypal.com',
    },
  });

  const partner2 = await prisma.merchant.create({
    data: {
      businessName: 'Rideline',
      merchantType: MerchantType.EXTERNAL_PARTNER,
      paypalEmail: 'rides@sandbox.paypal.com',
    },
  });

  console.log('Creating staff...');
  const staff1 = await prisma.staff.create({
    data: {
      venueId: venue.id,
      displayName: 'Alice',
      paypalEmail: 'alice@sandbox.paypal.com',
    },
  });

  const staff2 = await prisma.staff.create({
    data: {
      venueId: venue.id,
      displayName: 'Bob',
      paypalEmail: 'bob@sandbox.paypal.com',
    },
  });

  console.log('Creating venue items...');
  await prisma.item.createMany({
    data: [
      { merchantId: venue.id, name: 'Mezcal Cocktail', description: 'Small batch mezcal', price: '15.00', category: 'cocktail', metadata: { tags: ['smoky'] } },
      { merchantId: venue.id, name: 'Local IPA', description: 'Hoppy beer', price: '8.00', category: 'beer' },
      { merchantId: venue.id, name: 'Margarita', description: 'Classic lime', price: '12.00', category: 'cocktail' },
      { merchantId: venue.id, name: 'Whiskey Neat', description: 'Single pour', price: '10.00', category: 'spirits' },
      { merchantId: venue.id, name: 'House Wine', description: 'By the glass', price: '9.00', category: 'wine' },
      { merchantId: venue.id, name: 'Soft Drink', description: 'Non-alcoholic', price: '4.00', category: 'soft' },
    ],
  });

  console.log('Creating partner items...');
  await prisma.item.createMany({
    data: [
      { merchantId: partner1.id, name: 'Dark Chocolate Churros', description: 'Dipped', price: '10.00', category: 'dessert' },
      { merchantId: partner1.id, name: 'Cinnamon Churros', description: 'Classic', price: '8.00', category: 'dessert' },
      { merchantId: partner2.id, name: '$15 Ride Voucher', description: 'Valid 30 days', price: '15.00', category: 'ride' },
      { merchantId: partner2.id, name: '$25 Ride Voucher', description: 'Longer trips', price: '25.00', category: 'ride' },
    ],
  });

  console.log(`✓ Seeded venue ${venue.businessName} (${venue.id})`);
  console.log(`✓ Seeded partners ${partner1.businessName}, ${partner2.businessName}`);
  console.log(`✓ Seeded staff ${staff1.displayName}, ${staff2.displayName}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
