import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../lib/prisma';
import { createNotification } from './notificationService';
import { Server as SocketIOServer } from 'socket.io';
import { NotificationType } from '@prisma/client';

const ANTI_SNIPE_WINDOW_SECONDS = 30;
const ANTI_SNIPE_EXTENSION_SECONDS = 60;

interface PendingNotification {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  listingId: string;
}

/**
 * Run proxy auto-bidding engine after a new manual bid is placed.
 * 
 * Tie-breaking rule: When two auto-bids would produce the same leading amount,
 * the auto-bid registered FIRST (earliest createdAt) wins.
 */
export async function runAutoBidding(
  listingId: string,
  triggerBidderId: string | null,
  currentAmountOrNull: Decimal | null,
  io?: SocketIOServer
): Promise<void> {
  const pendingNotifications: PendingNotification[] = [];

  // Get the current state of the listing with a row lock
  await prisma.$transaction(async (tx) => {
    const listingRaw = await tx.$queryRaw<Array<{
      id: string; title: string; status: string; startingPrice: string;
      minIncrement: string; currentPrice: string | null;
      closingAt: Date; extensionCount: number;
    }>>`
      SELECT id, title, status, "startingPrice"::text, "minIncrement"::text,
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

    // Sort auto-bids by highest max amount, tie-break by earlier registration
    const sortedByMax = [...autoBids].sort((a, b) => {
      const diff = new Decimal(b.maxAmount).minus(new Decimal(a.maxAmount)).toNumber();
      if (diff !== 0) return diff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const winner = sortedByMax[0];
    const runnerUp = sortedByMax[1];

    if (!winner) return;

    // If winner is already leading, check if a manual bid triggered a need to counter
    if (leadingBidderId === winner.bidderId && triggerBidderId !== winner.bidderId) {
      if (triggerBidderId && triggerBidderId !== winner.bidderId && currentPrice) {
        const requiredBid = currentPrice.plus(minIncrement);
        if (new Decimal(winner.maxAmount).greaterThanOrEqualTo(requiredBid)) {
          await placeProxyBid(tx, listingId, winner.bidderId, requiredBid, listing, leadingBidderId, pendingNotifications, io);
        }
      }
      return;
    }

    // Winner has an auto-bid and needs to place a proxy bid
    const baseNeeded = currentPrice ? currentPrice.plus(minIncrement) : startingPrice;

    if (new Decimal(winner.maxAmount).lessThan(baseNeeded)) {
      // Winner's max is exhausted; queue notification for them
      pendingNotifications.push({
        userId: winner.bidderId,
        type: 'OUTBID',
        title: 'Auto-bid limit reached',
        message: `Your maximum auto-bid of ₹${new Decimal(winner.maxAmount).toFixed(0)} on "${listing.title}" has been reached. Increase your limit to stay in the lead!`,
        listingId,
      });
      return;
    }

    // Calculate the smallest proxy bid needed
    let proxyBidAmount: Decimal;

    if (runnerUp) {
      const runnerUpMax = new Decimal(runnerUp.maxAmount);
      const neededToBeatRunnerUp = runnerUpMax.plus(minIncrement);

      if (neededToBeatRunnerUp.greaterThan(new Decimal(winner.maxAmount))) {
        // Winner's max doesn't exceed runner-up by a full increment — use winner's full max
        proxyBidAmount = new Decimal(winner.maxAmount);
      } else {
        proxyBidAmount = neededToBeatRunnerUp;
      }
    } else {
      proxyBidAmount = baseNeeded;
    }

    // Ensure proxy bid is at least baseNeeded and does not exceed winner's max
    if (proxyBidAmount.lessThan(baseNeeded)) {
      proxyBidAmount = baseNeeded;
    }
    if (proxyBidAmount.greaterThan(new Decimal(winner.maxAmount))) {
      proxyBidAmount = new Decimal(winner.maxAmount);
    }

    // If already at or above this amount and winner is leading, skip
    if (currentPrice && proxyBidAmount.lessThanOrEqualTo(currentPrice) && leadingBidderId === winner.bidderId) {
      return;
    }

    await placeProxyBid(tx, listingId, winner.bidderId, proxyBidAmount, listing, leadingBidderId, pendingNotifications, io);

    // If runner-up's max is now exceeded by the winner's new bid, notify runner-up
    if (runnerUp && new Decimal(runnerUp.maxAmount).lessThanOrEqualTo(proxyBidAmount)) {
      pendingNotifications.push({
        userId: runnerUp.bidderId,
        type: 'OUTBID',
        title: 'Auto-bid limit reached',
        message: `Your auto-bid limit of ₹${new Decimal(runnerUp.maxAmount).toFixed(0)} on "${listing.title}" was outbid. Increase your limit to bid again!`,
        listingId,
      });
    }
  });

  // Dispatch all notifications AFTER transaction commits to prevent deadlock on foreign keys
  for (const notif of pendingNotifications) {
    await createNotification({ ...notif, io });
  }
}

async function placeProxyBid(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  listingId: string,
  bidderId: string,
  amount: Decimal,
  listing: { title: string; closingAt: Date; extensionCount: number },
  previousLeaderId: string | null,
  pendingNotifications: PendingNotification[],
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

  // Queue notification for previous leader if someone else took the lead
  if (previousLeaderId && previousLeaderId !== bidderId) {
    pendingNotifications.push({
      userId: previousLeaderId,
      type: 'OUTBID',
      title: "You've been outbid!",
      message: `An automatic bid of ₹${amount.toFixed(0)} has taken the lead on "${listing.title}".`,
      listingId,
    });
  }

  // Broadcast real-time events
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
