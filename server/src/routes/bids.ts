import { Router, Response } from 'express';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../lib/prisma';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { rateLimit } from 'express-rate-limit';
import { runAutoBidding } from '../services/autoBidService';
import { createNotification } from '../services/notificationService';

const router = Router();

const bidLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many bids. Please slow down.',
});

const PlaceBidSchema = z.object({
  amount: z.number().positive().max(10000000),
});

const AutoBidSchema = z.object({
  maxAmount: z.number().positive().max(10000000),
});

const ANTI_SNIPE_WINDOW_SECONDS = 30;
const ANTI_SNIPE_EXTENSION_SECONDS = 60;

// POST /api/bids/:listingId
router.post('/:listingId', authenticate, bidLimiter, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId } = req.params;
  const userId = req.user!.id;

  const result = PlaceBidSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid bid amount', details: result.error.flatten() });
    return;
  }

  const { bid, listing, extended, newDeadline } = await prisma.$transaction(async (tx) => {
    // Lock the listing row for this transaction
    const listing = await tx.$queryRaw<Array<{
      id: string; status: string; sellerId: string; startingPrice: string;
      minIncrement: string; currentPrice: string | null; closingAt: Date;
      extensionCount: number;
    }>>`
      SELECT id, status, "sellerId", "startingPrice"::text, "minIncrement"::text,
             "currentPrice"::text, "closingAt", "extensionCount"
      FROM "Listing"
      WHERE id = ${listingId}
      FOR UPDATE
    `;

    if (!listing || listing.length === 0) {
      throw Object.assign(new Error('Listing not found'), { statusCode: 404 });
    }

    const l = listing[0];

    // Server-side checks — never trust client
    if (l.status !== 'ACTIVE') {
      throw Object.assign(new Error(`Auction is not active. Status: ${l.status}`), { statusCode: 400 });
    }

    const now = new Date();
    if (new Date(l.closingAt) <= now) {
      throw Object.assign(new Error('Auction has already closed'), { statusCode: 400 });
    }

    if (l.sellerId === userId) {
      throw Object.assign(new Error('Sellers cannot bid on their own listings'), { statusCode: 403 });
    }

    const bidAmount = new Decimal(result.data.amount);
    const startingPrice = new Decimal(l.startingPrice);
    const minIncrement = new Decimal(l.minIncrement);
    const currentPrice = l.currentPrice ? new Decimal(l.currentPrice) : null;

    // Validate bid amount
    if (currentPrice === null) {
      // First bid: must be >= starting price
      if (bidAmount.lessThan(startingPrice)) {
        throw Object.assign(
          new Error(`First bid must be at least the starting price of ₹${startingPrice.toFixed(2)}`),
          { statusCode: 400 }
        );
      }
    } else {
      // Subsequent bid: must be >= current + increment
      const minRequired = currentPrice.plus(minIncrement);
      if (bidAmount.lessThan(minRequired)) {
        throw Object.assign(
          new Error(`Bid must be at least ₹${minRequired.toFixed(2)} (current ₹${currentPrice.toFixed(2)} + increment ₹${minIncrement.toFixed(2)})`),
          { statusCode: 400 }
        );
      }
    }

    // Create the bid
    const newBid = await tx.bid.create({
      data: {
        listingId,
        bidderId: userId,
        amount: bidAmount,
        isAuto: false,
      },
      include: { bidder: { select: { id: true, name: true } } },
    });

    // Update listing current price
    await tx.listing.update({
      where: { id: listingId },
      data: { currentPrice: bidAmount, leadingBidId: newBid.id },
    });

    // Anti-sniping: extend if bid within last 30 seconds
    const secsToClose = (new Date(l.closingAt).getTime() - now.getTime()) / 1000;
    let extended = false;
    let newDeadline: Date | null = null;

    if (secsToClose <= ANTI_SNIPE_WINDOW_SECONDS) {
      newDeadline = new Date(now.getTime() + ANTI_SNIPE_EXTENSION_SECONDS * 1000);
      await tx.listing.update({
        where: { id: listingId },
        data: {
          closingAt: newDeadline,
          extensionCount: { increment: 1 },
        },
      });
      extended = true;
    }

    const updatedListing = await tx.listing.findUnique({ where: { id: listingId } });

    return { bid: newBid, listing: updatedListing, extended, newDeadline };
  });

  // After transaction: run auto-bidding engine
  const io = req.app.get('io');
  
  try {
    await runAutoBidding(listingId, userId, new Decimal(result.data.amount), io);
  } catch (err) {
    console.error('[AutoBid] Error running auto-bidding:', err);
  }

  // Broadcast bid to all clients watching this listing
  const updatedListing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      bids: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { bidder: { select: { id: true, name: true } } },
      },
    },
  });

  io?.to(`listing:${listingId}`).emit('bid:accepted', {
    bid,
    listing: updatedListing,
    extended,
    newDeadline,
  });

  if (extended && newDeadline) {
    io?.to(`listing:${listingId}`).emit('auction:extended', {
      listingId,
      newDeadline,
      extensionCount: listing?.extensionCount,
    });
  }

  // Notify previous leader they were outbid
  const previousBids = await prisma.bid.findMany({
    where: { listingId, bidderId: { not: req.user!.id } },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { bidderId: true, amount: true },
  });

  if (previousBids.length > 0) {
    await createNotification({
      userId: previousBids[0].bidderId,
      type: 'OUTBID',
      title: 'You\'ve been outbid!',
      message: `Someone bid ₹${result.data.amount.toLocaleString('en-IN')} on an auction you were leading.`,
      listingId,
      io,
    });
  }

  res.status(201).json({ bid, listing: updatedListing, extended, newDeadline });
});

// GET /api/bids/:listingId — bid history
router.get('/:listingId', async (req, res: Response): Promise<void> => {
  const { listingId } = req.params;
  const page = parseInt(req.query.page as string || '1');
  const limit = Math.min(parseInt(req.query.limit as string || '20'), 100);

  const [bids, total] = await Promise.all([
    prisma.bid.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { bidder: { select: { id: true, name: true } } },
    }),
    prisma.bid.count({ where: { listingId } }),
  ]);

  res.json({ bids, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

// POST /api/bids/:listingId/auto — set up auto-bidding
router.post('/:listingId/auto', authenticate, bidLimiter, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId } = req.params;
  const userId = req.user!.id;

  const result = AutoBidSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid max amount', details: result.error.flatten() });
    return;
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, status: true, sellerId: true, startingPrice: true, currentPrice: true, minIncrement: true, closingAt: true },
  });

  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  if (listing.status !== 'ACTIVE') {
    res.status(400).json({ error: 'Auction is not active' });
    return;
  }

  if (new Date(listing.closingAt) <= new Date()) {
    res.status(400).json({ error: 'Auction has already closed' });
    return;
  }

  if (listing.sellerId === userId) {
    res.status(403).json({ error: 'Sellers cannot auto-bid on their own listings' });
    return;
  }

  const maxAmount = new Decimal(result.data.maxAmount);
  const startingPrice = new Decimal(listing.startingPrice);
  
  if (maxAmount.lessThan(startingPrice)) {
    res.status(400).json({ error: `Maximum amount must be at least the starting price of ₹${startingPrice.toFixed(2)}` });
    return;
  }

  // Upsert auto-bid instruction
  const autoBid = await prisma.autoBid.upsert({
    where: { listingId_bidderId: { listingId, bidderId: userId } },
    update: { maxAmount, isActive: true, cancelledAt: null, updatedAt: new Date() },
    create: { listingId, bidderId: userId, maxAmount },
  });

  // Immediately run auto-bidding
  const io = req.app.get('io');
  try {
    await runAutoBidding(listingId, null, listing.currentPrice ? new Decimal(listing.currentPrice as string) : null, io);
  } catch (err) {
    console.error('[AutoBid] Error after setting auto-bid:', err);
  }

  res.status(201).json({ autoBid: { id: autoBid.id, maxAmount: autoBid.maxAmount, isActive: autoBid.isActive } });
});

// DELETE /api/bids/:listingId/auto — cancel auto-bidding
router.delete('/:listingId/auto', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId } = req.params;
  const userId = req.user!.id;

  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { status: true } });
  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  if (listing.status !== 'ACTIVE') {
    res.status(400).json({ error: 'Cannot cancel auto-bid on a closed auction' });
    return;
  }

  const autoBid = await prisma.autoBid.findUnique({
    where: { listingId_bidderId: { listingId, bidderId: userId } },
  });

  if (!autoBid || !autoBid.isActive) {
    res.status(404).json({ error: 'No active auto-bid found' });
    return;
  }

  await prisma.autoBid.update({
    where: { id: autoBid.id },
    data: { isActive: false, cancelledAt: new Date() },
  });

  res.json({ message: 'Auto-bid cancelled successfully' });
});

export { router as bidsRouter };
