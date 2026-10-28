import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, optionalAuth, AuthenticatedRequest } from '../middleware/auth';
import { rateLimit } from 'express-rate-limit';

const router = Router();

const questionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many questions. Please wait before posting again.',
});

const QuestionSchema = z.object({
  text: z.string().min(5).max(500),
});

const AnswerSchema = z.object({
  text: z.string().min(2).max(1000),
});

// GET /api/questions/:listingId
router.get('/:listingId', optionalAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId } = req.params;

  const questions = await prisma.question.findMany({
    where: { listingId },
    orderBy: { createdAt: 'asc' },
    include: {
      asker: { select: { id: true, name: true } },
      answer: { include: { seller: { select: { id: true, name: true } } } },
    },
  });

  res.json({ questions });
});

// POST /api/questions/:listingId
router.post('/:listingId', authenticate, questionLimiter, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId } = req.params;
  const userId = req.user!.id;

  const result = QuestionSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
    return;
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, status: true, sellerId: true, title: true },
  });

  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  if (!['ACTIVE', 'PENDING_SELLER_DECISION'].includes(listing.status)) {
    res.status(400).json({ error: 'Questions can only be asked on active listings' });
    return;
  }

  if (listing.sellerId === userId) {
    res.status(403).json({ error: 'Sellers cannot ask questions on their own listings' });
    return;
  }

  const question = await prisma.question.create({
    data: { listingId, askerId: userId, text: result.data.text },
    include: { asker: { select: { id: true, name: true } } },
  });

  // Notify seller
  const io = req.app.get('io');
  io?.to(`user:${listing.sellerId}`).emit('notification:new', {
    notification: {
      type: 'QUESTION_ANSWERED',
      title: 'New question on your listing',
      message: `Someone asked: "${result.data.text.slice(0, 80)}..."`,
      listingId,
    },
  });

  io?.to(`listing:${listingId}`).emit('question:new', { question });

  res.status(201).json({ question });
});

// POST /api/questions/:listingId/:questionId/answer
router.post('/:listingId/:questionId/answer', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { listingId, questionId } = req.params;
  const userId = req.user!.id;

  const result = AnswerSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
    return;
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true },
  });

  if (!listing || listing.sellerId !== userId) {
    res.status(403).json({ error: 'Only the seller can answer questions' });
    return;
  }

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: { answer: true, asker: { select: { id: true } } },
  });

  if (!question || question.listingId !== listingId) {
    res.status(404).json({ error: 'Question not found' });
    return;
  }

  if (question.answer) {
    res.status(400).json({ error: 'Question already answered' });
    return;
  }

  const answer = await prisma.$transaction(async (tx) => {
    const ans = await tx.answer.create({
      data: { questionId, sellerId: userId, text: result.data.text },
      include: { seller: { select: { id: true, name: true } } },
    });
    await tx.question.update({ where: { id: questionId }, data: { isAnswered: true } });
    return ans;
  });

  const io = req.app.get('io');
  io?.to(`listing:${listingId}`).emit('question:answered', { questionId, answer });
  io?.to(`user:${question.askerId.id}`).emit('notification:new', {
    notification: {
      type: 'QUESTION_ANSWERED',
      title: 'Your question was answered',
      message: `The seller answered: "${result.data.text.slice(0, 80)}..."`,
      listingId,
    },
  });

  res.status(201).json({ answer });
});

export { router as questionsRouter };
