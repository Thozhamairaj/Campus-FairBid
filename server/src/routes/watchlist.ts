import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/watchlist
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const items = await prisma.watchlist.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: {
      listing: {
        include: {
          seller: { select: { id: true, name: true } },
          images: { orderBy: { order: 'asc' }, take: 1 },
          _count: { select: { bids: true } },
        },
      },
    },
  });
  res.json({ items });
});

// POST /api/watchlist/:listingId
router.post('/:listingId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId } = req.params;
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { id: true } });
  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  try {
    const item = await prisma.watchlist.create({
      data: { userId: req.user!.id, listingId },
    });
    res.status(201).json({ item, watching: true });
  } catch {
    res.status(400).json({ error: 'Already in watchlist' });
  }
});

// DELETE /api/watchlist/:listingId
router.delete('/:listingId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId } = req.params;
  await prisma.watchlist.deleteMany({
    where: { userId: req.user!.id, listingId },
  });
  res.json({ watching: false });
});

export { router as watchlistRouter };
