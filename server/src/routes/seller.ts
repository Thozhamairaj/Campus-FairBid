import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { createNotification } from '../services/notificationService';

const router = Router();

// POST /api/seller/:listingId/decide — approve or reject winning bid
router.post('/:listingId/decide', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId } = req.params;
  const userId = req.user!.id;

  const schema = z.object({
    approved: z.boolean(),
    reason: z.string().max(500).optional(),
  });

  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid request', details: result.error.flatten() });
    return;
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      bids: { orderBy: { amount: 'desc' }, take: 1 },
      sellerDecision: true,
    },
  });

  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  if (listing.sellerId !== userId) {
    res.status(403).json({ error: 'Only the seller can make this decision' });
    return;
  }

  if (listing.status !== 'PENDING_SELLER_DECISION') {
    res.status(400).json({ error: `Cannot decide on a listing with status: ${listing.status}` });
    return;
  }

  if (listing.sellerDecision) {
    res.status(400).json({ error: 'Decision already made' });
    return;
  }

  const winner = listing.bids[0];
  if (!winner) {
    res.status(400).json({ error: 'No bids found' });
    return;
  }

  const { approved, reason } = result.data;
  const newStatus = approved ? 'RESERVED_FOR_WINNER' : 'REJECTED';

  await prisma.$transaction(async (tx) => {
    await tx.listing.update({ where: { id: listingId }, data: { status: newStatus } });
    await tx.sellerDecision.create({
      data: { listingId, sellerId: userId, approved, reason },
    });
    await tx.auctionStatusHistory.create({
      data: { listingId, status: newStatus, reason: reason || (approved ? 'Seller approved' : 'Seller rejected') },
    });

    if (approved) {
      await tx.handoverConfirmation.create({
        data: { listingId, sellerId: userId, buyerId: winner.bidderId },
      });
    }
  });

  const io = req.app.get('io');
  io?.to(`listing:${listingId}`).emit('auction:decided', { listingId, approved, status: newStatus });

  await createNotification({
    userId: winner.bidderId,
    type: approved ? 'SELLER_APPROVED' : 'SELLER_REJECTED',
    title: approved ? '✅ Seller approved your bid!' : '❌ Seller rejected your bid',
    message: approved
      ? `The seller approved your winning bid on an item. Please proceed with the campus handover.`
      : `The seller rejected your winning bid. Reason: ${reason || 'Not provided'}.`,
    listingId,
    io,
  });

  res.json({ message: `Listing ${approved ? 'approved' : 'rejected'} successfully`, status: newStatus });
});

// POST /api/seller/:listingId/handover/seller-confirm — seller confirms handover
router.post('/:listingId/handover/seller-confirm', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId } = req.params;
  const userId = req.user!.id;

  const schema = z.object({ location: z.string().max(200).optional(), scheduledAt: z.string().datetime().optional() });
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed' });
    return;
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { handover: true },
  });

  if (!listing || listing.sellerId !== userId) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  if (listing.status !== 'RESERVED_FOR_WINNER') {
    res.status(400).json({ error: 'Item must be reserved for a winner' });
    return;
  }

  if (!listing.handover) {
    res.status(400).json({ error: 'No handover record found' });
    return;
  }

  const updated = await prisma.handoverConfirmation.update({
    where: { listingId },
    data: {
      sellerConfirmed: true,
      location: result.data.location,
      scheduledAt: result.data.scheduledAt ? new Date(result.data.scheduledAt) : undefined,
    },
  });

  const io = req.app.get('io');
  await createNotification({
    userId: listing.handover.buyerId,
    type: 'HANDOVER_REQUESTED',
    title: '📦 Seller confirmed handover',
    message: `The seller is ready to hand over your item. ${result.data.location ? 'Location: ' + result.data.location : ''}`,
    listingId,
    io,
  });

  res.json({ handover: updated });
});

// POST /api/seller/:listingId/handover/buyer-confirm — buyer confirms receipt
router.post('/:listingId/handover/buyer-confirm', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId } = req.params;
  const userId = req.user!.id;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { handover: true },
  });

  if (!listing || !listing.handover || listing.handover.buyerId !== userId) {
    res.status(403).json({ error: 'Not authorized or no handover record' });
    return;
  }

  if (listing.status !== 'RESERVED_FOR_WINNER') {
    res.status(400).json({ error: 'Item must be reserved for winner' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.handoverConfirmation.update({
      where: { listingId },
      data: { buyerConfirmed: true, completedAt: new Date() },
    });
    await tx.listing.update({ where: { id: listingId }, data: { status: 'SOLD' } });
    await tx.auctionStatusHistory.create({
      data: { listingId, status: 'SOLD', reason: 'Buyer confirmed receipt' },
    });
  });

  const io = req.app.get('io');
  io?.to(`listing:${listingId}`).emit('auction:sold', { listingId });
  await createNotification({
    userId: listing.sellerId,
    type: 'HANDOVER_CONFIRMED',
    title: '🎉 Sale completed!',
    message: `The buyer confirmed receipt. Your item has been successfully sold!`,
    listingId,
    io,
  });

  res.json({ message: 'Handover confirmed. Sale completed!' });
});

// POST /api/seller/:listingId/handover/failed — report failed pickup
router.post('/:listingId/handover/failed', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId } = req.params;
  const userId = req.user!.id;
  const { reason } = req.body as { reason?: string };

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { handover: true },
  });

  if (!listing || !listing.handover) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  if (listing.sellerId !== userId && listing.handover.buyerId !== userId) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.handoverConfirmation.update({
      where: { listingId },
      data: { failedAt: new Date(), failReason: reason },
    });
    await tx.listing.update({ where: { id: listingId }, data: { status: 'FAILED_PICKUP' } });
    await tx.auctionStatusHistory.create({
      data: { listingId, status: 'FAILED_PICKUP', reason: reason || 'Pickup failed' },
    });
  });

  const io = req.app.get('io');
  io?.to(`listing:${listingId}`).emit('auction:failed', { listingId });

  res.json({ message: 'Pickup failure recorded' });
});

export { router as sellerRouter };
