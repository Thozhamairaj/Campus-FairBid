import { Router, Response } from 'express';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../lib/prisma';
import { authenticate, optionalAuth, AuthenticatedRequest } from '../middleware/auth';
import { notifyMatchingSavedSearches } from '../services/savedSearchNotifier';

const router = Router();

const CreateListingSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(5000),
  category: z.enum(['BICYCLE', 'CALCULATOR', 'BOOKS', 'ELECTRONICS', 'HOSTEL_ESSENTIALS', 'OTHER']),
  condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR']),
  startingPrice: z.number().positive().max(1000000),
  minIncrement: z.number().positive().max(10000),
  closingAt: z.string().datetime(),
  imageUrls: z.array(z.string().url()).max(5).optional(),
});

const UpdateListingSchema = CreateListingSchema.partial().omit({ imageUrls: true }).extend({
  imageUrls: z.array(z.string().url()).max(5).optional(),
});

const ListingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(12),
  category: z.enum(['BICYCLE', 'CALCULATOR', 'BOOKS', 'ELECTRONICS', 'HOSTEL_ESSENTIALS', 'OTHER']).optional(),
  condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR']).optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  closingSoon: z.coerce.boolean().optional(),
  search: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'CLOSED_UNSOLD', 'PENDING_SELLER_DECISION', 'RESERVED_FOR_WINNER', 'SOLD', 'REJECTED', 'CANCELLED', 'FAILED_PICKUP']).optional(),
  sellerId: z.string().uuid().optional(),
  sortBy: z.enum(['closingAt', 'currentPrice', 'createdAt']).default('closingAt'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

// GET /api/listings
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = ListingsQuerySchema.safeParse(req.query);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid query params', details: result.error.flatten() });
    return;
  }

  const { page, limit, category, condition, minPrice, maxPrice, closingSoon, search, status, sellerId, sortBy, sortOrder } = result.data;

  const where: Record<string, unknown> = {};
  
  if (category) where.category = category;
  if (condition) where.condition = condition;
  if (status) where.status = status;
  else where.status = 'ACTIVE'; // Default to active
  if (sellerId) where.sellerId = sellerId;
  
  if (minPrice !== undefined || maxPrice !== undefined) {
    where.currentPrice = {
      ...(minPrice !== undefined ? { gte: new Decimal(minPrice) } : {}),
      ...(maxPrice !== undefined ? { lte: new Decimal(maxPrice) } : {}),
    };
  }

  if (closingSoon) {
    const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
    where.closingAt = { lte: in24h, gte: new Date() };
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where: where as Parameters<typeof prisma.listing.findMany>[0]['where'],
      include: {
        seller: { select: { id: true, name: true, college: true } },
        images: { orderBy: { order: 'asc' }, take: 1 },
        _count: { select: { bids: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.listing.count({ where: where as Parameters<typeof prisma.listing.count>[0]['where'] }),
  ]);

  res.json({
    listings,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// GET /api/listings/:id
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  
  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      seller: { select: { id: true, name: true, college: true, hostel: true } },
      images: { orderBy: { order: 'asc' } },
      bids: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          bidder: { select: { id: true, name: true } },
        },
      },
      _count: { select: { bids: true, questions: true } },
      questions: {
        orderBy: { createdAt: 'asc' },
        include: {
          asker: { select: { id: true, name: true } },
          answer: { include: { seller: { select: { id: true, name: true } } } },
        },
      },
      statusHistory: { orderBy: { createdAt: 'asc' } },
      sellerDecision: true,
      handover: {
        include: {
          seller: { select: { id: true, name: true } },
          buyer: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  // Increment view count (fire and forget)
  prisma.listing.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => {});

  // Check watchlist status if authenticated
  let isWatched = false;
  let userAutoBid = null;
  if (req.user) {
    const [watchlistEntry, autoBid] = await Promise.all([
      prisma.watchlist.findUnique({ where: { userId_listingId: { userId: req.user.id, listingId: id } } }),
      prisma.autoBid.findUnique({
        where: { listingId_bidderId: { listingId: id, bidderId: req.user.id } },
        select: { id: true, maxAmount: true, isActive: true },
      }),
    ]);
    isWatched = !!watchlistEntry;
    userAutoBid = autoBid;
  }

  res.json({ listing, isWatched, userAutoBid });
});

// POST /api/listings
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = CreateListingSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
    return;
  }

  const { title, description, category, condition, startingPrice, minIncrement, closingAt, imageUrls } = result.data;
  
  const closing = new Date(closingAt);
  if (closing <= new Date()) {
    res.status(400).json({ error: 'Closing time must be in the future' });
    return;
  }
  if (closing > new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) {
    res.status(400).json({ error: 'Closing time cannot be more than 30 days from now' });
    return;
  }

  const listing = await prisma.$transaction(async (tx) => {
    const newListing = await tx.listing.create({
      data: {
        title,
        description,
        category,
        condition,
        startingPrice: new Decimal(startingPrice),
        minIncrement: new Decimal(minIncrement),
        closingAt: closing,
        originalClosingAt: closing,
        sellerId: req.user!.id,
      },
    });

    if (imageUrls && imageUrls.length > 0) {
      await tx.listingImage.createMany({
        data: imageUrls.map((url, index) => ({
          listingId: newListing.id,
          url,
          order: index,
        })),
      });
    }

    await tx.auctionStatusHistory.create({
      data: { listingId: newListing.id, status: 'ACTIVE', reason: 'Listing created' },
    });

    return newListing;
  });

  // Notify saved search watchers (async)
  notifyMatchingSavedSearches(listing.id).catch(console.error);

  const fullListing = await prisma.listing.findUnique({
    where: { id: listing.id },
    include: {
      seller: { select: { id: true, name: true, college: true } },
      images: { orderBy: { order: 'asc' } },
    },
  });

  const io = req.app.get('io');
  io?.emit('listing:created', { listing: fullListing });

  res.status(201).json({ listing: fullListing });
});

// PUT /api/listings/:id
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  
  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  if (listing.sellerId !== req.user!.id) {
    res.status(403).json({ error: 'You can only edit your own listings' });
    return;
  }

  if (listing.status !== 'ACTIVE') {
    res.status(400).json({ error: 'Cannot edit a listing that is not active' });
    return;
  }

  // Cannot edit after first bid
  const bidCount = await prisma.bid.count({ where: { listingId: id } });
  if (bidCount > 0) {
    res.status(400).json({ error: 'Cannot edit a listing that already has bids' });
    return;
  }

  const result = UpdateListingSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
    return;
  }

  const { imageUrls, ...updateData } = result.data;

  const updatedListing = await prisma.$transaction(async (tx) => {
    const updated = await tx.listing.update({
      where: { id },
      data: {
        ...updateData,
        ...(updateData.startingPrice ? { startingPrice: new Decimal(updateData.startingPrice) } : {}),
        ...(updateData.minIncrement ? { minIncrement: new Decimal(updateData.minIncrement) } : {}),
        ...(updateData.closingAt ? { closingAt: new Date(updateData.closingAt), originalClosingAt: new Date(updateData.closingAt) } : {}),
      },
    });

    if (imageUrls !== undefined) {
      await tx.listingImage.deleteMany({ where: { listingId: id } });
      if (imageUrls.length > 0) {
        await tx.listingImage.createMany({
          data: imageUrls.map((url, index) => ({ listingId: id, url, order: index })),
        });
      }
    }

    return updated;
  });

  const fullListing = await prisma.listing.findUnique({
    where: { id },
    include: {
      seller: { select: { id: true, name: true, college: true } },
      images: { orderBy: { order: 'asc' } },
    },
  });

  const io = req.app.get('io');
  io?.emit('listing:updated', { listing: fullListing });

  res.json({ listing: fullListing });
});

// DELETE /api/listings/:id (cancel)
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { reason } = req.body as { reason?: string };

  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  if (listing.sellerId !== req.user!.id) {
    res.status(403).json({ error: 'You can only cancel your own listings' });
    return;
  }

  const ineligible = ['CLOSED_UNSOLD', 'PENDING_SELLER_DECISION', 'RESERVED_FOR_WINNER', 'SOLD', 'REJECTED', 'CANCELLED'];
  if (ineligible.includes(listing.status)) {
    res.status(400).json({ error: `Cannot cancel a listing with status: ${listing.status}` });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.listing.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason || 'Cancelled by seller',
      },
    });
    await tx.auctionStatusHistory.create({
      data: { listingId: id, status: 'CANCELLED', reason: reason || 'Cancelled by seller' },
    });
    // Deactivate any auto bids
    await tx.autoBid.updateMany({ where: { listingId: id }, data: { isActive: false, cancelledAt: new Date() } });
  });

  const io = req.app.get('io');
  io?.to(`listing:${id}`).emit('auction:cancelled', { listingId: id, reason });

  res.json({ message: 'Listing cancelled successfully' });
});

export { router as listingsRouter };
