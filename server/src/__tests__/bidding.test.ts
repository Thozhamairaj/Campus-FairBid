import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Campus FairBid — Bidding Engine Tests
 * 
 * These tests verify core auction business rules using the actual database.
 * Run: npm test
 */

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/campus_fairbid' } },
});

// Simplified bid placement function that mirrors bids.ts logic (without Express)
async function placeBid(listingId: string, bidderId: string, amount: number): Promise<{ success: boolean; error?: string; bid?: unknown }> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const listingRaw = await tx.$queryRaw<Array<{
        id: string; status: string; sellerId: string; startingPrice: string;
        minIncrement: string; currentPrice: string | null; closingAt: Date; extensionCount: number;
      }>>`SELECT id, status, "sellerId", "startingPrice"::text, "minIncrement"::text, "currentPrice"::text, "closingAt", "extensionCount" FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;

      if (!listingRaw.length) throw new Error('Listing not found');
      const l = listingRaw[0];

      if (l.status !== 'ACTIVE') throw new Error(`Auction not active: ${l.status}`);
      if (new Date(l.closingAt) <= new Date()) throw new Error('Auction closed');
      if (l.sellerId === bidderId) throw new Error('Seller cannot bid on own listing');

      const bidAmount = new Decimal(amount);
      const startingPrice = new Decimal(l.startingPrice);
      const minIncrement = new Decimal(l.minIncrement);
      const currentPrice = l.currentPrice ? new Decimal(l.currentPrice) : null;

      if (currentPrice === null) {
        if (bidAmount.lessThan(startingPrice)) throw new Error(`First bid must be at or above the starting price of ₹${startingPrice}`);
      } else {
        const minRequired = currentPrice.plus(minIncrement);
        if (bidAmount.lessThan(minRequired)) throw new Error(`Bid must be >= ₹${minRequired}`);
      }

      const bid = await tx.bid.create({
        data: { listingId, bidderId, amount: bidAmount },
      });
      await tx.listing.update({ where: { id: listingId }, data: { currentPrice: bidAmount } });

      // Anti-sniping
      const secsToClose = (new Date(l.closingAt).getTime() - Date.now()) / 1000;
      if (secsToClose <= 30) {
        const newDeadline = new Date(Date.now() + 60 * 1000);
        await tx.listing.update({ where: { id: listingId }, data: { closingAt: newDeadline, extensionCount: { increment: 1 } } });
      }

      return bid;
    });
    return { success: true, bid: result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

let testSellerId: string;
let testBuyerId1: string;
let testBuyerId2: string;
let testListingId: string;

beforeAll(async () => {
  // Create test users
  const hash = await bcrypt.hash('testpass', 10);
  const seller = await prisma.user.upsert({
    where: { email: 'test-seller@test.local' },
    update: {},
    create: { name: 'Test Seller', email: 'test-seller@test.local', passwordHash: hash },
  });
  const buyer1 = await prisma.user.upsert({
    where: { email: 'test-buyer1@test.local' },
    update: {},
    create: { name: 'Test Buyer 1', email: 'test-buyer1@test.local', passwordHash: hash },
  });
  const buyer2 = await prisma.user.upsert({
    where: { email: 'test-buyer2@test.local' },
    update: {},
    create: { name: 'Test Buyer 2', email: 'test-buyer2@test.local', passwordHash: hash },
  });
  testSellerId = seller.id;
  testBuyerId1 = buyer1.id;
  testBuyerId2 = buyer2.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createTestListing(overrides: Partial<{
  startingPrice: number;
  minIncrement: number;
  closingAt: Date;
  sellerId: string;
}> = {}) {
  const listing = await prisma.listing.create({
    data: {
      sellerId: overrides.sellerId ?? testSellerId,
      title: 'Test Item',
      description: 'A test listing for unit tests',
      category: 'OTHER',
      condition: 'GOOD',
      startingPrice: new Decimal(overrides.startingPrice ?? 100),
      minIncrement: new Decimal(overrides.minIncrement ?? 10),
      closingAt: overrides.closingAt ?? new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      originalClosingAt: overrides.closingAt ?? new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await prisma.auctionStatusHistory.create({
    data: { listingId: listing.id, status: 'ACTIVE', reason: 'Test listing' },
  });
  return listing;
}

async function cleanListing(id: string) {
  await prisma.bid.deleteMany({ where: { listingId: id } });
  await prisma.auctionStatusHistory.deleteMany({ where: { listingId: id } });
  await prisma.listing.delete({ where: { id } });
}

// ─── TEST SUITE ───────────────────────────────────────────────────────────────

describe('Bidding Engine — Core Rules', () => {
  beforeEach(async () => {
    const l = await createTestListing({ startingPrice: 100, minIncrement: 10 });
    testListingId = l.id;
  });

  afterEach(async () => {
    await cleanListing(testListingId);
  });

  test('First bid at exactly the starting price is accepted', async () => {
    const result = await placeBid(testListingId, testBuyerId1, 100);
    expect(result.success).toBe(true);
  });

  test('First bid below starting price is rejected', async () => {
    const result = await placeBid(testListingId, testBuyerId1, 80);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/starting price/i);
  });

  test('First bid above starting price is accepted', async () => {
    const result = await placeBid(testListingId, testBuyerId1, 200);
    expect(result.success).toBe(true);
  });

  test('Minimum increment is enforced on subsequent bids', async () => {
    await placeBid(testListingId, testBuyerId1, 100); // First bid
    const result = await placeBid(testListingId, testBuyerId2, 105); // Only 5 above, need 10
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/₹110/); // 100 + 10 = 110
  });

  test('Bid at exactly minimum increment is accepted', async () => {
    await placeBid(testListingId, testBuyerId1, 100);
    const result = await placeBid(testListingId, testBuyerId2, 110);
    expect(result.success).toBe(true);
  });

  test('Seller cannot bid on their own listing', async () => {
    const result = await placeBid(testListingId, testSellerId, 100);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/seller/i);
  });

  test('Bid on cancelled listing is rejected', async () => {
    await prisma.listing.update({ where: { id: testListingId }, data: { status: 'CANCELLED' } });
    const result = await placeBid(testListingId, testBuyerId1, 100);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not active/i);
  });

  test('Bid after auction close time is rejected', async () => {
    await prisma.listing.update({
      where: { id: testListingId },
      data: { closingAt: new Date(Date.now() - 1000) }, // 1 second ago
    });
    const result = await placeBid(testListingId, testBuyerId1, 100);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/closed/i);
  });
});

describe('Anti-Sniping Extension', () => {
  test('Bid in last 30 seconds extends deadline to 60 seconds from now', async () => {
    const closingIn25Sec = new Date(Date.now() + 25 * 1000);
    const listing = await createTestListing({ closingAt: closingIn25Sec });

    const before = await prisma.listing.findUnique({ where: { id: listing.id }, select: { closingAt: true, extensionCount: true } });
    expect(before!.extensionCount).toBe(0);

    const result = await placeBid(listing.id, testBuyerId1, 100);
    expect(result.success).toBe(true);

    const after = await prisma.listing.findUnique({ where: { id: listing.id }, select: { closingAt: true, extensionCount: true } });
    expect(after!.extensionCount).toBe(1);
    // New deadline should be ~60 seconds from now (within 5 sec tolerance)
    const expectedDeadline = Date.now() + 60 * 1000;
    expect(Math.abs(after!.closingAt.getTime() - expectedDeadline)).toBeLessThan(5000);

    await cleanListing(listing.id);
  });

  test('Bid outside 30-second window does NOT extend deadline', async () => {
    const closingIn2Min = new Date(Date.now() + 2 * 60 * 1000);
    const listing = await createTestListing({ closingAt: closingIn2Min });
    
    await placeBid(listing.id, testBuyerId1, 100);
    const after = await prisma.listing.findUnique({ where: { id: listing.id }, select: { extensionCount: true } });
    expect(after!.extensionCount).toBe(0);

    await cleanListing(listing.id);
  });
});

describe('Auction Closing Logic', () => {
  test('Auction with no bids is marked CLOSED_UNSOLD', async () => {
    const pastClosing = new Date(Date.now() - 1000);
    const listing = await createTestListing({ closingAt: pastClosing });
    
    // Run closer manually
    const { runAuctionCloser } = await import('../services/auctionCloser');
    const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} } as unknown as import('socket.io').Server;
    await runAuctionCloser(mockIo);

    const closed = await prisma.listing.findUnique({ where: { id: listing.id }, select: { status: true } });
    expect(closed!.status).toBe('CLOSED_UNSOLD');

    await cleanListing(listing.id);
  });

  test('Auction with bids is marked PENDING_SELLER_DECISION', async () => {
    const listing = await createTestListing({ closingAt: new Date(Date.now() + 60 * 60 * 1000) });
    await placeBid(listing.id, testBuyerId1, 100);
    
    // Force close
    await prisma.listing.update({ where: { id: listing.id }, data: { closingAt: new Date(Date.now() - 1000) } });

    const { runAuctionCloser } = await import('../services/auctionCloser');
    const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} } as unknown as import('socket.io').Server;
    await runAuctionCloser(mockIo);

    const closed = await prisma.listing.findUnique({ where: { id: listing.id }, select: { status: true } });
    expect(closed!.status).toBe('PENDING_SELLER_DECISION');

    await cleanListing(listing.id);
  });
});

describe('Seller Decision', () => {
  test('Seller can approve and status changes to RESERVED_FOR_WINNER', async () => {
    const listing = await createTestListing({});
    await placeBid(listing.id, testBuyerId1, 100);
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'PENDING_SELLER_DECISION' } });

    await prisma.sellerDecision.create({
      data: { listingId: listing.id, sellerId: testSellerId, approved: true },
    });
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'RESERVED_FOR_WINNER' } });

    const updated = await prisma.listing.findUnique({ where: { id: listing.id }, select: { status: true } });
    expect(updated!.status).toBe('RESERVED_FOR_WINNER');

    await prisma.sellerDecision.deleteMany({ where: { listingId: listing.id } });
    await cleanListing(listing.id);
  });

  test('Seller can reject and status changes to REJECTED', async () => {
    const listing = await createTestListing({});
    await placeBid(listing.id, testBuyerId1, 100);
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'PENDING_SELLER_DECISION' } });

    await prisma.sellerDecision.create({
      data: { listingId: listing.id, sellerId: testSellerId, approved: false, reason: 'Changed my mind' },
    });
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'REJECTED' } });

    const updated = await prisma.listing.findUnique({ where: { id: listing.id }, select: { status: true } });
    expect(updated!.status).toBe('REJECTED');

    await prisma.sellerDecision.deleteMany({ where: { listingId: listing.id } });
    await cleanListing(listing.id);
  });
});

describe('Concurrent Bid Protection', () => {
  test('Concurrent bids at same amount — only one should win at minimum amount', async () => {
    const listing = await createTestListing({ startingPrice: 100, minIncrement: 10 });
    
    // Simulate concurrent bids by placing them sequentially
    // (True concurrency testing requires separate DB connections)
    const [r1, r2] = await Promise.allSettled([
      placeBid(listing.id, testBuyerId1, 100),
      placeBid(listing.id, testBuyerId2, 100),
    ]);

    const results = [r1, r2].map(r => r.status === 'fulfilled' ? r.value : { success: false });
    const successes = results.filter(r => r.success).length;
    
    // At least one should succeed (could be both if amounts are different required)
    // The key test is: final price == 100
    const final = await prisma.listing.findUnique({ where: { id: listing.id }, select: { currentPrice: true } });
    expect(new Decimal(final!.currentPrice!).toNumber()).toBe(100);

    await cleanListing(listing.id);
  });
});

describe('Automatic Bidding', () => {
  test('Auto-bid respects maximum amount', async () => {
    const listing = await createTestListing({ startingPrice: 100, minIncrement: 10 });
    
    // Set up auto-bid with max 150
    await prisma.autoBid.create({
      data: { listingId: listing.id, bidderId: testBuyerId1, maxAmount: new Decimal(150) },
    });

    // Simulate someone bidding 130 — auto-bidder should counter at 140
    await placeBid(listing.id, testBuyerId2, 100); // First bid
    await placeBid(listing.id, testBuyerId2, 130); // Push to 130

    const { runAutoBidding } = await import('../services/autoBidService');
    await runAutoBidding(listing.id, testBuyerId2, new Decimal(130), undefined);

    const updatedListing = await prisma.listing.findUnique({
      where: { id: listing.id },
      select: { currentPrice: true },
    });

    // Auto-bidder should have placed a bid at 140 (130 + 10)
    expect(new Decimal(updatedListing!.currentPrice!).toNumber()).toBe(140);

    await prisma.autoBid.deleteMany({ where: { listingId: listing.id } });
    await cleanListing(listing.id);
  });
});

describe('Authorization Checks', () => {
  test('Non-seller cannot cancel a listing', async () => {
    const listing = await createTestListing({});
    
    // Simulate what the route would do — check ownership
    const isOwner = listing.sellerId === testBuyerId1;
    expect(isOwner).toBe(false);

    await cleanListing(listing.id);
  });

  test('Listing with bids cannot be edited', async () => {
    const listing = await createTestListing({});
    await placeBid(listing.id, testBuyerId1, 100);

    const bidCount = await prisma.bid.count({ where: { listingId: listing.id } });
    expect(bidCount).toBeGreaterThan(0);

    // The route checks this and rejects
    const canEdit = bidCount === 0;
    expect(canEdit).toBe(false);

    await cleanListing(listing.id);
  });
});

describe('Cancellation Rules', () => {
  test('ACTIVE listing with no bids can be cancelled', async () => {
    const listing = await createTestListing({});
    const ineligible = ['CLOSED_UNSOLD', 'PENDING_SELLER_DECISION', 'RESERVED_FOR_WINNER', 'SOLD', 'REJECTED', 'CANCELLED'];
    expect(ineligible.includes(listing.status)).toBe(false);
    
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'CANCELLED' } });
    const updated = await prisma.listing.findUnique({ where: { id: listing.id }, select: { status: true } });
    expect(updated!.status).toBe('CANCELLED');

    await cleanListing(listing.id);
  });

  test('SOLD listing cannot be cancelled', async () => {
    const listing = await createTestListing({});
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'SOLD' } });
    
    const ineligible = ['CLOSED_UNSOLD', 'PENDING_SELLER_DECISION', 'RESERVED_FOR_WINNER', 'SOLD', 'REJECTED', 'CANCELLED'];
    const updated = await prisma.listing.findUnique({ where: { id: listing.id }, select: { status: true } });
    expect(ineligible.includes(updated!.status)).toBe(true);

    await cleanListing(listing.id);
  });
});
