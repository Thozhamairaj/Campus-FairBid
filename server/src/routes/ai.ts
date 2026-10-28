import { Router, Response } from 'express';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../lib/prisma';
import { optionalAuth, authenticate, AuthenticatedRequest } from '../middleware/auth';
import { rateLimit } from 'express-rate-limit';

const router = Router();

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many AI requests. Please wait.',
});

const AssistantSchema = z.object({
  query: z.string().min(2).max(500),
});

interface ParsedIntent {
  category?: string;
  maxPrice?: number;
  condition?: string;
  closingSoon?: boolean;
  keywords?: string;
}

/**
 * Rule-based NLP intent parser.
 * Falls back gracefully if no LLM key is available.
 */
function parseIntent(query: string): ParsedIntent {
  const q = query.toLowerCase();
  const intent: ParsedIntent = {};

  // Category detection
  if (q.includes('cycle') || q.includes('bicycle') || q.includes('bike')) intent.category = 'BICYCLE';
  else if (q.includes('calculator') || q.includes('calc')) intent.category = 'CALCULATOR';
  else if (q.includes('book') || q.includes('textbook')) intent.category = 'BOOKS';
  else if (q.includes('electronic') || q.includes('laptop') || q.includes('phone') || q.includes('charger')) intent.category = 'ELECTRONICS';
  else if (q.includes('hostel') || q.includes('mattress') || q.includes('bucket') || q.includes('fan')) intent.category = 'HOSTEL_ESSENTIALS';

  // Price extraction: "under ₹2000", "below 1500", "less than 500"
  const priceMatch = q.match(/(?:under|below|less than|max|upto|up to|within)\s*[₹rs.]?\s*(\d[\d,]*)/i);
  if (priceMatch) {
    intent.maxPrice = parseInt(priceMatch[1].replace(/,/g, ''), 10);
  }
  // Also try "2000 rs" or "₹2000"
  if (!intent.maxPrice) {
    const priceMatch2 = q.match(/[₹rs.]\s*(\d[\d,]+)/i);
    if (priceMatch2) intent.maxPrice = parseInt(priceMatch2[1].replace(/,/g, ''), 10);
  }

  // Condition
  if (q.includes('new')) intent.condition = 'NEW';
  else if (q.includes('like new')) intent.condition = 'LIKE_NEW';
  else if (q.includes('good condition') || q.includes('good')) intent.condition = 'GOOD';
  else if (q.includes('fair')) intent.condition = 'FAIR';

  // Time preference
  if (q.includes('today') || q.includes('closing soon') || q.includes('ending soon')) {
    intent.closingSoon = true;
  }

  // Keywords (everything not captured)
  const words = query.split(' ').filter(w => w.length > 3 && !['under', 'below', 'than', 'less', 'with', 'that', 'this', 'have', 'need', 'want', 'find', 'show'].includes(w.toLowerCase()));
  intent.keywords = words.slice(0, 5).join(' ');

  return intent;
}

function generateExplanation(listing: { title: string; currentPrice: string | null; startingPrice: string; condition: string; closingAt: Date }, intent: ParsedIntent): string {
  const parts: string[] = [];
  const price = listing.currentPrice || listing.startingPrice;
  
  if (intent.category) parts.push(`matches your ${intent.category.toLowerCase().replace('_', ' ')} category`);
  if (intent.maxPrice) parts.push(`within your ₹${intent.maxPrice.toLocaleString('en-IN')} budget (current: ₹${new Decimal(price).toFixed(0)})`);
  if (intent.condition) parts.push(`condition is ${listing.condition.toLowerCase().replace('_', ' ')}`);
  
  const minsLeft = Math.round((new Date(listing.closingAt).getTime() - Date.now()) / 60000);
  if (minsLeft < 60) parts.push(`closes very soon (${minsLeft} min left)`);
  else if (minsLeft < 1440) parts.push(`closes today`);

  return parts.length > 0 ? `Matches because it ${parts.join(', ')}.` : 'Good match for your query.';
}

function suggestBid(listing: { currentPrice: string | null; startingPrice: string; minIncrement: string }): string {
  const current = new Decimal(listing.currentPrice || listing.startingPrice);
  const increment = new Decimal(listing.minIncrement);
  const suggested = current.plus(increment);
  return suggested.toFixed(2);
}

// POST /api/ai/assistant
router.post('/assistant', optionalAuth, aiLimiter, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = AssistantSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid query' });
    return;
  }

  const { query } = result.data;
  const intent = parseIntent(query);

  const where: Record<string, unknown> = { status: 'ACTIVE' };
  if (intent.category) where.category = intent.category;
  if (intent.condition) where.condition = intent.condition;
  if (intent.maxPrice) {
    where.OR = [
      { currentPrice: { lte: new Decimal(intent.maxPrice) } },
      { AND: [{ currentPrice: null }, { startingPrice: { lte: new Decimal(intent.maxPrice) } }] },
    ];
  }
  if (intent.closingSoon) {
    where.closingAt = { lte: new Date(Date.now() + 24 * 60 * 60 * 1000), gte: new Date() };
  }

  // Keyword search in title/description
  if (intent.keywords && intent.keywords.length > 2) {
    const existingOR = where.OR as unknown[];
    if (existingOR) {
      // already has OR — wrap in AND
      delete where.OR;
      where.AND = [
        { OR: existingOR },
        { OR: [
          { title: { contains: intent.keywords, mode: 'insensitive' } },
          { description: { contains: intent.keywords, mode: 'insensitive' } },
        ]},
      ];
    } else {
      where.OR = [
        { title: { contains: intent.keywords, mode: 'insensitive' } },
        { description: { contains: intent.keywords, mode: 'insensitive' } },
      ];
    }
  }

  const listings = await prisma.listing.findMany({
    where: where as Parameters<typeof prisma.listing.findMany>[0]['where'],
    orderBy: [{ currentPrice: 'asc' }, { closingAt: 'asc' }],
    take: 6,
    include: {
      seller: { select: { id: true, name: true } },
      images: { orderBy: { order: 'asc' }, take: 1 },
      _count: { select: { bids: true } },
    },
  });

  const results = listings.map((listing) => ({
    listing,
    explanation: generateExplanation(listing as Parameters<typeof generateExplanation>[0], intent),
    suggestedBid: suggestBid(listing as Parameters<typeof suggestBid>[0]),
    matchScore: [
      intent.category && listing.category === intent.category ? 30 : 0,
      intent.condition && listing.condition === intent.condition ? 20 : 0,
      intent.maxPrice && new Decimal(listing.currentPrice || listing.startingPrice).lte(intent.maxPrice) ? 30 : 0,
      intent.closingSoon && new Date(listing.closingAt) < new Date(Date.now() + 24 * 60 * 60 * 1000) ? 20 : 0,
    ].reduce((a, b) => a + b, 0),
  })).sort((a, b) => b.matchScore - a.matchScore);

  res.json({
    query,
    intent,
    results,
    summary: results.length === 0
      ? `No active listings match your search for "${query}". Try broadening your criteria.`
      : `Found ${results.length} listing(s) matching "${query}". ${intent.maxPrice ? `All within ₹${intent.maxPrice.toLocaleString('en-IN')}.` : ''} ${intent.closingSoon ? 'Showing items closing soon.' : ''}`,
  });
});

// GET /api/ai/fair-play/:listingId — Fair-Play Insights
router.get('/fair-play/:listingId', async (req, res: Response): Promise<void> => {
  const { listingId } = req.params;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      bids: {
        orderBy: { createdAt: 'desc' },
        include: { bidder: { select: { id: true, name: true } } },
      },
      statusHistory: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  // Calculate min next bid
  const currentPrice = listing.currentPrice ? new Decimal(listing.currentPrice) : null;
  const minIncrement = new Decimal(listing.minIncrement);
  const startingPrice = new Decimal(listing.startingPrice);
  const minNextBid = currentPrice ? currentPrice.plus(minIncrement) : startingPrice;

  // Bid validity analysis
  const bidInsights = listing.bids.map((bid, i) => {
    const prev = listing.bids[i + 1]; // bids are desc, so i+1 is previous
    let wasValid = true;
    let reason = 'Valid bid';

    if (!prev && new Decimal(bid.amount).lessThan(startingPrice)) {
      wasValid = false;
      reason = `Rejected: below starting price ₹${startingPrice.toFixed(2)}`;
    } else if (prev) {
      const required = new Decimal(prev.amount).plus(minIncrement);
      if (new Decimal(bid.amount).lessThan(required)) {
        wasValid = false;
        reason = `Would be rejected: below minimum ₹${required.toFixed(2)}`;
      }
    }

    return {
      bidId: bid.id,
      bidderName: bid.bidder.name,
      amount: bid.amount,
      isAuto: bid.isAuto,
      placedAt: bid.createdAt,
      wasValid,
      reason,
    };
  });

  // Find comparable listings
  const comparables = await prisma.listing.findMany({
    where: {
      category: listing.category,
      id: { not: listingId },
      status: { in: ['SOLD', 'ACTIVE', 'CLOSED_UNSOLD'] },
    },
    select: { id: true, title: true, currentPrice: true, startingPrice: true, condition: true, status: true },
    take: 5,
    orderBy: { createdAt: 'desc' },
  });

  let priceRange: { min: number; max: number; avg: number } | null = null;
  if (comparables.length >= 2) {
    const prices = comparables
      .map(c => parseFloat(((c.currentPrice || c.startingPrice) as unknown as string)))
      .filter(p => !isNaN(p));
    priceRange = {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: prices.reduce((a, b) => a + b, 0) / prices.length,
    };
  }

  res.json({
    listingId,
    title: listing.title,
    status: listing.status,
    startingPrice: listing.startingPrice,
    currentPrice: listing.currentPrice,
    minNextBid,
    minIncrement: listing.minIncrement,
    totalBids: listing.bids.length,
    extensionCount: listing.extensionCount,
    originalClosingAt: listing.originalClosingAt,
    currentClosingAt: listing.closingAt,
    bidInsights: bidInsights.slice(0, 10),
    comparables: comparables.length >= 2 ? comparables : [],
    priceRange,
    fairnessNote: comparables.length < 2
      ? 'Insufficient comparable listings to estimate a price range. Showing auction-only data.'
      : `Based on ${comparables.length} similar ${listing.category.toLowerCase()} listings in the same category.`,
    statusHistory: listing.statusHistory,
  });
});

export { router as aiRouter };
