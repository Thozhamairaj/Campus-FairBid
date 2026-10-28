import prisma from '../lib/prisma';
import { Server as SocketIOServer } from 'socket.io';
import { Decimal } from '@prisma/client/runtime/library';
import { createBulkNotifications } from './notificationService';
import { runAutoBidding } from './autoBidService';

/**
 * Runs every minute via cron.
 * Closes expired ACTIVE auctions and sets their status.
 */
export async function runAuctionCloser(io: SocketIOServer): Promise<void> {
  const now = new Date();

  // Find all ACTIVE listings that have passed their closing time
  const expiredListings = await prisma.listing.findMany({
    where: {
      status: 'ACTIVE',
      closingAt: { lte: now },
    },
    include: {
      bids: {
        orderBy: { amount: 'desc' },
        take: 1,
        include: { bidder: { select: { id: true, name: true, email: true } } },
      },
      seller: { select: { id: true, name: true } },
    },
  });

  for (const listing of expiredListings) {
    const highestBid = listing.bids[0];

    await prisma.$transaction(async (tx) => {
      if (highestBid) {
        // Has a bid — pending seller decision
        await tx.listing.update({
          where: { id: listing.id },
          data: { status: 'PENDING_SELLER_DECISION' },
        });
        await tx.auctionStatusHistory.create({
          data: {
            listingId: listing.id,
            status: 'PENDING_SELLER_DECISION',
            reason: `Auction closed with ${listing.bids.length} bid(s). Highest bid: ₹${highestBid.amount}`,
          },
        });
        // Deactivate auto-bids
        await tx.autoBid.updateMany({
          where: { listingId: listing.id, isActive: true },
          data: { isActive: false },
        });
      } else {
        // No bids — closed unsold
        await tx.listing.update({
          where: { id: listing.id },
          data: { status: 'CLOSED_UNSOLD' },
        });
        await tx.auctionStatusHistory.create({
          data: { listingId: listing.id, status: 'CLOSED_UNSOLD', reason: 'Auction closed with no bids' },
        });
      }
    });

    // Broadcast closure
    io.to(`listing:${listing.id}`).emit('auction:closed', {
      listingId: listing.id,
      status: highestBid ? 'PENDING_SELLER_DECISION' : 'CLOSED_UNSOLD',
      winnerId: highestBid?.bidderId,
      winnerName: highestBid?.bidder?.name,
      winningAmount: highestBid?.amount,
    });
    io.emit('listing:statusChanged', { listingId: listing.id, status: highestBid ? 'PENDING_SELLER_DECISION' : 'CLOSED_UNSOLD' });

    // Notify participants
    const notifs: Parameters<typeof createBulkNotifications>[0] = [];

    // Notify seller
    notifs.push({
      userId: listing.sellerId,
      type: 'AUCTION_CLOSED',
      title: 'Your auction has closed',
      message: highestBid
        ? `"${listing.title}" closed with a winning bid of ₹${new Decimal(highestBid.amount).toFixed(2)}. Please make your decision.`
        : `"${listing.title}" closed with no bids.`,
      listingId: listing.id,
    });

    // Notify winner
    if (highestBid) {
      notifs.push({
        userId: highestBid.bidderId,
        type: 'AUCTION_WON',
        title: '🎉 You won an auction!',
        message: `Congratulations! You won "${listing.title}" with a bid of ₹${new Decimal(highestBid.amount).toFixed(2)}. Waiting for seller approval.`,
        listingId: listing.id,
      });

      // Notify other bidders they lost
      const losingBidders = await prisma.bid.findMany({
        where: { listingId: listing.id, bidderId: { not: highestBid.bidderId } },
        distinct: ['bidderId'],
        select: { bidderId: true },
      });

      for (const loser of losingBidders) {
        notifs.push({
          userId: loser.bidderId,
          type: 'AUCTION_CLOSED',
          title: 'Auction ended',
          message: `The auction for "${listing.title}" has ended. Unfortunately, you did not win this one.`,
          listingId: listing.id,
        });
      }
    }

    await createBulkNotifications(notifs, io);
    console.log(`[AuctionCloser] Closed listing ${listing.id}: ${highestBid ? 'PENDING_SELLER_DECISION' : 'CLOSED_UNSOLD'}`);
  }
}
