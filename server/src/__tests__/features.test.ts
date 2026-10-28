import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Decimal } from '@prisma/client/runtime/library';
import { runAutoBidding } from '../services/autoBidService';
import { notifyMatchingSavedSearches } from '../services/savedSearchNotifier';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || 'postgresql://postgres@localhost/campus_fairbid?host=/tmp' } },
});

describe('Campus FairBid — Feature Audit & QA Verification Suite', () => {
  let sellerId: string;
  let buyer1Id: string;
  let buyer2Id: string;
  let buyer3Id: string;

  beforeAll(async () => {
    const hash = await bcrypt.hash('password123', 8);

    const s = await prisma.user.upsert({
      where: { email: 'test-qa-seller@campus.edu' },
      update: {},
      create: { email: 'test-qa-seller@campus.edu', name: 'Seller Sam', passwordHash: hash },
    });
    sellerId = s.id;

    const b1 = await prisma.user.upsert({
      where: { email: 'test-qa-buyer1@campus.edu' },
      update: {},
      create: { email: 'test-qa-buyer1@campus.edu', name: 'Buyer Bob', passwordHash: hash },
    });
    buyer1Id = b1.id;

    const b2 = await prisma.user.upsert({
      where: { email: 'test-qa-buyer2@campus.edu' },
      update: {},
      create: { email: 'test-qa-buyer2@campus.edu', name: 'Buyer Alice', passwordHash: hash },
    });
    buyer2Id = b2.id;

    const b3 = await prisma.user.upsert({
      where: { email: 'test-qa-buyer3@campus.edu' },
      update: {},
      create: { email: 'test-qa-buyer3@campus.edu', name: 'Buyer Charlie', passwordHash: hash },
    });
    buyer3Id = b3.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Phase 2 — Questions & Answers Visibility, Ownership, and Editing', () => {
    let listingId: string;
    let questionId: string;

    beforeEach(async () => {
      const listing = await prisma.listing.create({
        data: {
          title: 'QA Test Physics Textbook',
          description: 'Halliday Resnick in good shape',
          category: 'BOOKS',
          condition: 'GOOD',
          startingPrice: new Decimal(300),
          minIncrement: new Decimal(50),
          closingAt: new Date(Date.now() + 3600 * 1000),
          sellerId,
        },
      });
      listingId = listing.id;
    });

    afterEach(async () => {
      await prisma.answer.deleteMany({ where: { question: { listingId } } });
      await prisma.question.deleteMany({ where: { listingId } });
      await prisma.listing.delete({ where: { id: listingId } });
    });

    test('Buyer can ask question and it is associated with correct listing and author', async () => {
      const q = await prisma.question.create({
        data: {
          listingId,
          askerId: buyer1Id,
          text: 'Does this include the solution manual?',
        },
        include: { asker: { select: { id: true, name: true } } },
      });
      questionId = q.id;

      expect(q.listingId).toBe(listingId);
      expect(q.askerId).toBe(buyer1Id);
      expect(q.asker.name).toBe('Buyer Bob');
      expect((q.asker as any).email).toBeUndefined(); // Verify private email is not included
    });

    test('Seller can answer question on their own listing', async () => {
      const q = await prisma.question.create({
        data: { listingId, askerId: buyer1Id, text: 'Is shipping available?' },
      });

      const ans = await prisma.$transaction(async (tx) => {
        const a = await tx.answer.create({
          data: { questionId: q.id, sellerId, text: 'No, campus pickup only.' },
          include: { seller: { select: { id: true, name: true } } },
        });
        await tx.question.update({ where: { id: q.id }, data: { isAnswered: true } });
        return a;
      });

      expect(ans.text).toBe('No, campus pickup only.');
      expect(ans.seller.name).toBe('Seller Sam');

      const updatedQ = await prisma.question.findUnique({ where: { id: q.id } });
      expect(updatedQ?.isAnswered).toBe(true);
    });

    test('Question author can edit their question', async () => {
      const q = await prisma.question.create({
        data: { listingId, askerId: buyer1Id, text: 'Original question text here' },
      });

      const updated = await prisma.question.update({
        where: { id: q.id },
        data: { text: 'Updated question with more details' },
      });

      expect(updated.text).toBe('Updated question with more details');
    });

    test('Deleting an answer resets question isAnswered flag to false without crashing', async () => {
      const q = await prisma.question.create({
        data: { listingId, askerId: buyer1Id, text: 'Will this fit a 2nd year course?' },
      });

      await prisma.answer.create({
        data: { questionId: q.id, sellerId, text: 'Yes, absolutely.' },
      });
      await prisma.question.update({ where: { id: q.id }, data: { isAnswered: true } });

      // Delete answer
      await prisma.$transaction(async (tx) => {
        await tx.answer.delete({ where: { questionId: q.id } });
        await tx.question.update({ where: { id: q.id }, data: { isAnswered: false } });
      });

      const reloaded = await prisma.question.findUnique({
        where: { id: q.id },
        include: { answer: true },
      });

      expect(reloaded?.isAnswered).toBe(false);
      expect(reloaded?.answer).toBeNull();
    });
  });

  describe('Phase 4 — Saved Searches and Matching', () => {
    let savedSearchId: string;
    let listingId: string;

    afterEach(async () => {
      if (savedSearchId) {
        await prisma.savedSearch.deleteMany({ where: { id: savedSearchId } });
      }
      if (listingId) {
        await prisma.notification.deleteMany({ where: { listingId } });
        await prisma.listing.deleteMany({ where: { id: listingId } });
      }
    });

    test('User can create and toggle active status on a saved search', async () => {
      const ss = await prisma.savedSearch.create({
        data: {
          userId: buyer2Id,
          name: 'Scientific Calculator Under 500',
          keywords: 'calculator',
          category: 'CALCULATOR',
          maxPrice: new Decimal(500),
          isActive: true,
        },
      });
      savedSearchId = ss.id;

      expect(ss.isActive).toBe(true);
      expect(ss.category).toBe('CALCULATOR');

      // Toggle inactive
      const toggled = await prisma.savedSearch.update({
        where: { id: ss.id },
        data: { isActive: false },
      });
      expect(toggled.isActive).toBe(false);
    });

    test('New matching listing creates notification for saved search owner', async () => {
      const ss = await prisma.savedSearch.create({
        data: {
          userId: buyer2Id,
          name: 'Bontrager Helmet Alert',
          keywords: 'helmet',
          category: 'BICYCLE',
          isActive: true,
        },
      });
      savedSearchId = ss.id;

      // Create matching listing
      const listing = await prisma.listing.create({
        data: {
          title: 'Bontrager Cycle Helmet M Size',
          description: 'Used for one semester, excellent condition',
          category: 'BICYCLE',
          condition: 'LIKE_NEW',
          startingPrice: new Decimal(400),
          minIncrement: new Decimal(50),
          closingAt: new Date(Date.now() + 86400 * 1000),
          sellerId,
        },
      });
      listingId = listing.id;

      await notifyMatchingSavedSearches(listing.id);

      const notifs = await prisma.notification.findMany({
        where: { userId: buyer2Id, listingId: listing.id },
      });

      expect(notifs.length).toBeGreaterThan(0);
      expect(notifs[0].title).toContain('now available');
    });

    test('Inactive saved search does NOT generate notifications', async () => {
      const ss = await prisma.savedSearch.create({
        data: {
          userId: buyer3Id,
          name: 'Deactivated Search',
          keywords: 'guitar',
          category: 'OTHER',
          isActive: false, // PAUSED
        },
      });
      savedSearchId = ss.id;

      const listing = await prisma.listing.create({
        data: {
          title: 'Yamaha Acoustic Guitar with bag',
          description: 'Selling guitar',
          category: 'OTHER',
          condition: 'GOOD',
          startingPrice: new Decimal(2000),
          minIncrement: new Decimal(100),
          closingAt: new Date(Date.now() + 86400 * 1000),
          sellerId,
        },
      });
      listingId = listing.id;

      await notifyMatchingSavedSearches(listing.id);

      const notifs = await prisma.notification.findMany({
        where: { userId: buyer3Id, listingId: listing.id },
      });

      expect(notifs.length).toBe(0);
    });
  });

  describe('Phase 6 — Automatic Bidding Scenarios', () => {
    let listingId: string;

    beforeEach(async () => {
      const listing = await prisma.listing.create({
        data: {
          title: 'Auto-Bid Test Bicycle',
          description: 'Single speed campus cycle',
          category: 'BICYCLE',
          condition: 'GOOD',
          startingPrice: new Decimal(1000),
          minIncrement: new Decimal(100),
          closingAt: new Date(Date.now() + 3600 * 1000),
          sellerId,
        },
      });
      listingId = listing.id;
    });

    afterEach(async () => {
      await prisma.notification.deleteMany({ where: { listingId } });
      await prisma.bid.deleteMany({ where: { listingId } });
      await prisma.autoBid.deleteMany({ where: { listingId } });
      await prisma.listing.deleteMany({ where: { id: listingId } });
    });

    test('One automatic bidder responds to manual bid with smallest required increment', async () => {
      // Buyer 1 sets auto-bid max 1800
      await prisma.autoBid.create({
        data: { listingId, bidderId: buyer1Id, maxAmount: new Decimal(1800), isActive: true },
      });

      // Buyer 1 gets initial leading bid at starting price 1000
      await runAutoBidding(listingId, buyer1Id, null);

      let latestBid = await prisma.bid.findFirst({ where: { listingId }, orderBy: { createdAt: 'desc' } });
      expect(Number(latestBid?.amount)).toBe(1000);
      expect(latestBid?.bidderId).toBe(buyer1Id);

      // Buyer 2 places manual bid of 1200
      await prisma.bid.create({
        data: { listingId, bidderId: buyer2Id, amount: new Decimal(1200), isAuto: false },
      });
      await prisma.listing.update({ where: { id: listingId }, data: { currentPrice: new Decimal(1200) } });

      // Engine runs in response to Buyer 2's bid
      await runAutoBidding(listingId, buyer2Id, new Decimal(1200));

      // Buyer 1 should counter-bid at 1300 (1200 + 100 minIncrement), NOT jump to 1800
      latestBid = await prisma.bid.findFirst({ where: { listingId }, orderBy: { createdAt: 'desc' } });
      expect(Number(latestBid?.amount)).toBe(1300);
      expect(latestBid?.bidderId).toBe(buyer1Id);
      expect(latestBid?.isAuto).toBe(true);
    });

    test('Two automatic bidders with different maximums: higher max wins at runnerUp + minIncrement', async () => {
      // Buyer 1 sets max 1500
      await prisma.autoBid.create({
        data: { listingId, bidderId: buyer1Id, maxAmount: new Decimal(1500), isActive: true },
      });
      await runAutoBidding(listingId, buyer1Id, null);

      // Buyer 2 sets max 2000
      await prisma.autoBid.create({
        data: { listingId, bidderId: buyer2Id, maxAmount: new Decimal(2000), isActive: true },
      });
      await runAutoBidding(listingId, buyer2Id, null);

      // Buyer 2 should lead at 1600 (1500 runnerUp max + 100 increment)
      const latestBid = await prisma.bid.findFirst({ where: { listingId }, orderBy: { createdAt: 'desc' } });
      expect(latestBid?.bidderId).toBe(buyer2Id);
      expect(Number(latestBid?.amount)).toBe(1600);
    });

    test('Two automatic bidders with equal maximums: earliest registration wins at full max', async () => {
      const now = Date.now();
      // Buyer 1 registers FIRST
      await prisma.autoBid.create({
        data: {
          listingId,
          bidderId: buyer1Id,
          maxAmount: new Decimal(1500),
          isActive: true,
          createdAt: new Date(now - 10000),
        },
      });

      // Buyer 2 registers SECOND with equal max
      await prisma.autoBid.create({
        data: {
          listingId,
          bidderId: buyer2Id,
          maxAmount: new Decimal(1500),
          isActive: true,
          createdAt: new Date(now),
        },
      });

      await runAutoBidding(listingId, buyer2Id, null);

      const latestBid = await prisma.bid.findFirst({ where: { listingId }, orderBy: { createdAt: 'desc' } });
      expect(latestBid?.bidderId).toBe(buyer1Id);
      expect(Number(latestBid?.amount)).toBe(1500);
    });

    test('Manual bid exceeding auto-bidder max causes auto-bidder to lose lead without exceeding max', async () => {
      // Buyer 1 sets max 1400
      await prisma.autoBid.create({
        data: { listingId, bidderId: buyer1Id, maxAmount: new Decimal(1400), isActive: true },
      });
      await runAutoBidding(listingId, buyer1Id, null);

      // Buyer 2 places manual bid of 1500
      await prisma.bid.create({
        data: { listingId, bidderId: buyer2Id, amount: new Decimal(1500), isAuto: false },
      });
      await prisma.listing.update({ where: { id: listingId }, data: { currentPrice: new Decimal(1500) } });

      await runAutoBidding(listingId, buyer2Id, new Decimal(1500));

      // Buyer 2 remains leader; Buyer 1's max is exhausted
      const latestBid = await prisma.bid.findFirst({ where: { listingId }, orderBy: { createdAt: 'desc' } });
      expect(latestBid?.bidderId).toBe(buyer2Id);
      expect(Number(latestBid?.amount)).toBe(1500);
    });
  });
});
