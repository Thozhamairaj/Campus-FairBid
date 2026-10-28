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
      isActive: true,
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

  // Filter by keyword if specified (support full phrase and individual word matching)
  const matchingSearches = searches.filter((s) => {
    const rawKw = (s.keywords || s.name || '').trim().toLowerCase();
    if (!rawKw) return true;

    const titleLower = listing.title.toLowerCase();
    const descLower = listing.description.toLowerCase();
    const fullText = `${titleLower} ${descLower}`;

    // Direct phrase match
    if (fullText.includes(rawKw)) return true;

    // Tokenized word-by-word match
    const words = rawKw.split(/\s+/).filter((w) => w.length > 1);
    if (words.length > 0 && words.every((w) => fullText.includes(w))) {
      return true;
    }

    return false;
  });

  const notifs = matchingSearches.map((s) => {
    const queryTerm = s.keywords || s.name;
    return {
      userId: s.userId,
      type: 'NEW_LISTING_MATCH' as const,
      title: '🔔 Your searched product is now available!',
      message: `"${listing.title}" is now available on FairBid, matching your search for "${queryTerm}". Starting at ₹${new Decimal(listing.startingPrice).toFixed(0)}.`,
      listingId: listing.id,
    };
  });

  if (notifs.length > 0) {
    await createBulkNotifications(notifs, io);
  }
}
