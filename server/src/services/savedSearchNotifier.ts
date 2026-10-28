import prisma from '../lib/prisma';
import { Server as SocketIOServer } from 'socket.io';
import { createBulkNotifications } from './notificationService';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * When a new listing is created, check saved searches and notify matching users.
 */
export async function notifyMatchingSavedSearches(
  listingId: string,
  io?: SocketIOServer
): Promise<void> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { seller: { select: { id: true } } },
  });

  if (!listing) return;

  const closingAt = new Date(listing.closingAt);
  const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const searches = await prisma.savedSearch.findMany({
    where: {
      userId: { not: listing.sellerId }, // don't notify seller of their own listing
      AND: [
        // Category match
        listing.category ? { OR: [{ category: null }, { category: listing.category }] } : {},
        // Condition match
        listing.condition ? { OR: [{ condition: null }, { condition: listing.condition }] } : {},
        // Max price check against starting price
        { OR: [{ maxPrice: null }, { maxPrice: { gte: new Decimal(listing.startingPrice) } }] },
        // Closing soon filter
        closingAt <= in24h ? {} : { closingSoon: false },
      ],
    },
  });

  // Filter by keyword if specified
  const matchingSearches = searches.filter((s) => {
    if (!s.keywords) return true;
    const kw = s.keywords.toLowerCase();
    return (
      listing.title.toLowerCase().includes(kw) ||
      listing.description.toLowerCase().includes(kw)
    );
  });

  const notifs = matchingSearches.map((s) => ({
    userId: s.userId,
    type: 'NEW_LISTING_MATCH' as const,
    title: '🔔 New listing matches your search!',
    message: `"${listing.title}" matches your saved search "${s.name}". Starting at ₹${new Decimal(listing.startingPrice).toFixed(0)}.`,
    listingId: listing.id,
  }));

  if (notifs.length > 0) {
    await createBulkNotifications(notifs, io);
  }
}
