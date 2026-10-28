import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../lib/prisma';
import { createNotification } from './notificationService';
import { Server as SocketIOServer } from 'socket.io';

const ANTI_SNIPE_WINDOW_SECONDS = 30;
const ANTI_SNIPE_EXTENSION_SECONDS = 60;

/**
 * Run proxy auto-bidding engine after a new manual bid is placed.
 * 
 * Tie-breaking rule: When two auto-bids would produce the same leading amount,
 * the auto-bid registered FIRST (earliest createdAt) wins.
 * 
 * This function:
 * 1. Finds all active auto-bids for the listing
 * 2. Determines if anyone with an auto-bid should become the new leader
 * 3. Places proxy bids as necessary, respecting min increment
 * 4. Never exposes one bidder's max to another
 */
export async function runAutoBidding(
  listingId: string,
  triggerBidderId: string | null,
  currentAmountOrNull: Decimal | null,
  io?: SocketIOServer
): Promise<void> {
  // Get the current state of the listing with a lock
  await prisma.$transaction(async (tx) => {
    const listingRaw = await tx.$queryRaw<Array<{
      id: string; status: string; startingPrice: string;
      minIncrement: string; currentPrice: string | null;
      closingAt: Date; extensionCount: number;
    }>>`
      SELECT id, status, "startingPrice"::text, "minIncrement"::text,
             "currentPrice"::text, "closingAt", "extensionCount"
      FROM "Listing"
      WHERE id = ${listingId}
      FOR UPDATE
    `;

    if (!listingRaw || listingRaw.length === 0) return;
    const listing = listingRaw[0];

    if (listing.status !== 'ACTIVE') return;
    if (new Date(listing.closingAt) <= new Date()) return;

    const startingPrice = new Decimal(listing.startingPrice);
    const minIncrement = new Decimal(listing.minIncrement);
    const currentPrice = listing.currentPrice ? new Decimal(listing.currentPrice) : null;

    // Get all active auto-bids ordered by creation time (tie-break: earliest wins)
    const autoBids = await tx.autoBid.findMany({
      where: { listingId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    if (autoBids.length === 0) return;

    // Find the current leader (if any)
    const latestBid = await tx.bid.findFirst({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
    });

    const leadingBidderId = latestBid?.bidderId || null;

    // Find the highest auto-bid that isn't the trigger bidder (the one who just bid manually)
    // Sort auto-bids to find the highest max willing to pay
    const sortedByMax = [...autoBids].sort((a, b) => {
      const diff = new Decimal(b.maxAmount).minus(new Decimal(a.maxAmount)).toNumber();
      if (diff !== 0) return diff;
      // Tie-break: earlier registration wins
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // The auto-bid winner is the one with the highest max
    const winner = sortedByMax[0];
    const runnerUp = sortedByMax[1];

    if (!winner) return;

    // If the winner is currently leading, no action needed unless someone outbid them manually
    if (leadingBidderId === winner.bidderId && triggerBidderId !== winner.bidderId) {
      // The winner is already leading, check if they need to be bumped up
      // by the trigger bidder's manual bid
      if (triggerBidderId && triggerBidderId !== winner.bidderId && currentPrice) {
        // Place a counter-bid for winner if within their max
        const requiredBid = currentPrice.plus(minIncrement);
        if (new Decimal(winner.maxAmount).greaterThanOrEqualTo(requiredBid)) {
          // Winner can counter-bid
          await placePrxoyBid(tx, listingId, winner.bidderId, requiredBid, listing, io);
        }
        // else winner is outbid and cannot respond
      }
      return;
    }

    // The winner has an auto-bid. Calculate what they need to bid.
    const baseNeeded = currentPrice ? currentPrice.plus(minIncrement) : startingPrice;
    
    if (new Decimal(winner.maxAmount).lessThan(baseNeeded)) {
      // Winner's max is not enough — they cannot auto-bid
      return;
    }

    // What should winner's proxy bid be?
    // If there's a runner-up, bid just enough to beat runner-up's max (+ increment), capped at winner's max
    let proxyBidAmount: Decimal;
    
    if (runnerUp) {
      const runnerUpMax = new Decimal(runnerUp.maxAmount);
      const neededToBeatRunnerUp = runnerUpMax.plus(minIncrement);
      
      if (neededToBeatRunnerUp.greaterThan(new Decimal(winner.maxAmount))) {
        // Winner's max doesn't beat runner-up by increment — use winner's full max
        proxyBidAmount = new Decimal(winner.maxAmount);
      } else {
        // Bid just enough above runner-up's max
        proxyBidAmount = neededToBeatRunnerUp;
      }
    } else {
      // No runner-up; bid the minimum required
      proxyBidAmount = baseNeeded;
    }

    // Ensure proxy bid is at least baseNeeded
    if (proxyBidAmount.lessThan(baseNeeded)) {
      proxyBidAmount = baseNeeded;
    }

    // Don't exceed winner's max
    if (proxyBidAmount.greaterThan(new Decimal(winner.maxAmount))) {
      proxyBidAmount = new Decimal(winner.maxAmount);
    }

    // If already at current price (winner is already leading at this amount), skip
    if (currentPrice && proxyBidAmount.lessThanOrEqualTo(currentPrice) && leadingBidderId === winner.bidderId) {
      return;
    }

    await placePrxoyBid(tx, listingId, winner.bidderId, proxyBidAmount, listing, io);
  });
}

async function placePrxoyBid(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  listingId: string,
  bidderId: string,
  amount: Decimal,
  listing: { closingAt: Date; extensionCount: number },
  io?: SocketIOServer
): Promise<void> {
  const newBid = await tx.bid.create({
    data: { listingId, bidderId, amount, isAuto: true },
    include: { bidder: { select: { id: true, name: true } } },
  });

  const now = new Date();
  const secsToClose = (new Date(listing.closingAt).getTime() - now.getTime()) / 1000;
  let extended = false;
  let newDeadline: Date | null = null;

  if (secsToClose <= ANTI_SNIPE_WINDOW_SECONDS) {
    newDeadline = new Date(now.getTime() + ANTI_SNIPE_EXTENSION_SECONDS * 1000);
    await tx.listing.update({
      where: { id: listingId },
      data: { currentPrice: amount, leadingBidId: newBid.id, closingAt: newDeadline, extensionCount: { increment: 1 } },
    });
    extended = true;
  } else {
    await tx.listing.update({
      where: { id: listingId },
      data: { currentPrice: amount, leadingBidId: newBid.id },
    });
  }

  // Broadcast
  if (io) {
    io.to(`listing:${listingId}`).emit('bid:accepted', {
      bid: newBid,
      extended,
      newDeadline,
    });
    if (extended && newDeadline) {
      io.to(`listing:${listingId}`).emit('auction:extended', {
        listingId,
        newDeadline,
        extensionCount: listing.extensionCount + 1,
      });
    }
  }
}
