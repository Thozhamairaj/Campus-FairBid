import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, optionalAuth, AuthenticatedRequest } from '../middleware/auth';
import { rateLimit } from 'express-rate-limit';
import { createNotification } from '../services/notificationService';

const router = Router();

const questionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many question requests. Please wait before posting again.',
});

const answerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: 'Too many answer requests. Please wait before posting again.',
});

const QuestionSchema = z.object({
  text: z.string().trim().min(5, 'Question must be at least 5 characters').max(500, 'Question cannot exceed 500 characters'),
});

const AnswerSchema = z.object({
  text: z.string().trim().min(2, 'Answer must be at least 2 characters').max(1000, 'Answer cannot exceed 1000 characters'),
});

// GET /api/questions/:listingId — public questions for a listing
router.get('/:listingId', optionalAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const listingId = req.params.listingId as string;

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

// POST /api/questions/:listingId — ask a question
router.post('/:listingId', authenticate, questionLimiter, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const listingId = req.params.listingId as string;
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

  const io = req.app.get('io');
  // Persist notification for the seller in the DB and real-time socket
  await createNotification({
    userId: listing.sellerId,
    type: 'QUESTION_ANSWERED',
    title: '💬 New question on your listing',
    message: `A buyer asked on "${listing.title}": "${result.data.text.slice(0, 80)}"`,
    listingId,
    io,
  });

  io?.to(`listing:${listingId}`).emit('question:new', { question });

  res.status(201).json({ question });
});

// PUT /api/questions/:listingId/:questionId — edit a question (asker only)
router.put('/:listingId/:questionId', authenticate, questionLimiter, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const listingId = req.params.listingId as string;
  const questionId = req.params.questionId as string;
  const userId = req.user!.id;

  const result = QuestionSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
    return;
  }

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: { answer: true },
  });

  if (!question || question.listingId !== listingId) {
    res.status(404).json({ error: 'Question not found' });
    return;
  }

  if (question.askerId !== userId) {
    res.status(403).json({ error: 'You can only edit your own questions' });
    return;
  }

  const updated = await prisma.question.update({
    where: { id: questionId },
    data: { text: result.data.text },
    include: {
      asker: { select: { id: true, name: true } },
      answer: { include: { seller: { select: { id: true, name: true } } } },
    },
  });

  const io = req.app.get('io');
  io?.to(`listing:${listingId}`).emit('question:updated', { question: updated });

  res.json({ question: updated });
});

// DELETE /api/questions/:listingId/:questionId — delete a question (asker or seller or admin)
router.delete('/:listingId/:questionId', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const listingId = req.params.listingId as string;
  const questionId = req.params.questionId as string;
  const userId = req.user!.id;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true },
  });

  const question = await prisma.question.findUnique({
    where: { id: questionId },
  });

  if (!question || question.listingId !== listingId) {
    res.status(404).json({ error: 'Question not found' });
    return;
  }

  const isAuthor = question.askerId === userId;
  const isSeller = listing?.sellerId === userId;
  const isAdmin = req.user?.role === 'ADMIN';

  if (!isAuthor && !isSeller && !isAdmin) {
    res.status(403).json({ error: 'You are not authorized to delete this question' });
    return;
  }

  await prisma.question.delete({
    where: { id: questionId },
  });

  const io = req.app.get('io');
  io?.to(`listing:${listingId}`).emit('question:deleted', { questionId });

  res.json({ message: 'Question deleted successfully', questionId });
});

// POST /api/questions/:listingId/:questionId/answer — answer a question (seller only)
router.post('/:listingId/:questionId/answer', authenticate, answerLimiter, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const listingId = req.params.listingId as string;
  const questionId = req.params.questionId as string;
  const userId = req.user!.id;

  const result = AnswerSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
    return;
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true, title: true },
  });

  if (!listing || listing.sellerId !== userId) {
    res.status(403).json({ error: 'Only the seller can answer questions' });
    return;
  }

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: { answer: true, asker: { select: { id: true, name: true } } },
  });

  if (!question || question.listingId !== listingId) {
    res.status(404).json({ error: 'Question not found' });
    return;
  }

  if (question.answer) {
    res.status(400).json({ error: 'Question already answered. You can edit the existing answer instead.' });
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

  // Persist notification for the question author
  await createNotification({
    userId: question.askerId,
    type: 'QUESTION_ANSWERED',
    title: '🔔 Your question was answered!',
    message: `The seller answered your question on "${listing.title}": "${result.data.text.slice(0, 80)}"`,
    listingId,
    io,
  });

  res.status(201).json({ answer });
});

// PUT /api/questions/:listingId/:questionId/answer — edit an answer (seller only)
router.put('/:listingId/:questionId/answer', authenticate, answerLimiter, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const listingId = req.params.listingId as string;
  const questionId = req.params.questionId as string;
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
    res.status(403).json({ error: 'Only the seller can edit the answer' });
    return;
  }

  const answer = await prisma.answer.findUnique({
    where: { questionId },
  });

  if (!answer) {
    res.status(404).json({ error: 'Answer not found' });
    return;
  }

  const updatedAnswer = await prisma.answer.update({
    where: { questionId },
    data: { text: result.data.text },
    include: { seller: { select: { id: true, name: true } } },
  });

  const io = req.app.get('io');
  io?.to(`listing:${listingId}`).emit('answer:updated', { questionId, answer: updatedAnswer });

  res.json({ answer: updatedAnswer });
});

// DELETE /api/questions/:listingId/:questionId/answer — delete an answer (seller only)
router.delete('/:listingId/:questionId/answer', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const listingId = req.params.listingId as string;
  const questionId = req.params.questionId as string;
  const userId = req.user!.id;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true },
  });

  if (!listing || listing.sellerId !== userId) {
    res.status(403).json({ error: 'Only the seller can delete the answer' });
    return;
  }

  const answer = await prisma.answer.findUnique({
    where: { questionId },
  });

  if (!answer) {
    res.status(404).json({ error: 'Answer not found' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.answer.delete({ where: { questionId } });
    await tx.question.update({ where: { id: questionId }, data: { isAnswered: false } });
  });

  const io = req.app.get('io');
  io?.to(`listing:${listingId}`).emit('answer:deleted', { questionId });

  res.json({ message: 'Answer deleted successfully', questionId });
});

export { router as questionsRouter };
