import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const SavedSearchSchema = z.object({
  name: z.string().trim().min(1, 'Search name is required').max(100),
  keywords: z.string().trim().max(100).optional(),
  category: z.enum(['BICYCLE', 'CALCULATOR', 'BOOKS', 'ELECTRONICS', 'HOSTEL_ESSENTIALS', 'OTHER']).optional(),
  maxPrice: z.number().positive().optional(),
  condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR']).optional(),
  closingSoon: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// GET /api/saved-searches
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const searches = await prisma.savedSearch.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ searches });
});

// POST /api/saved-searches
router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = SavedSearchSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
    return;
  }

  // Check if identical search already exists for this user
  const existing = await prisma.savedSearch.findFirst({
    where: {
      userId: req.user!.id,
      name: { equals: result.data.name, mode: 'insensitive' },
    },
  });
  if (existing) {
    res.status(200).json({ search: existing, alreadySaved: true });
    return;
  }

  const count = await prisma.savedSearch.count({ where: { userId: req.user!.id } });
  if (count >= 10) {
    res.status(400).json({ error: 'Maximum 10 saved searches allowed' });
    return;
  }

  const search = await prisma.savedSearch.create({
    data: {
      userId: req.user!.id,
      ...result.data,
      maxPrice: result.data.maxPrice ? result.data.maxPrice : undefined,
    },
  });

  res.status(201).json({ search });
});

// PUT /api/saved-searches/:id — edit a saved search
router.put('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const result = SavedSearchSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
    return;
  }

  const existing = await prisma.savedSearch.findUnique({ where: { id } });
  if (!existing || existing.userId !== req.user!.id) {
    res.status(404).json({ error: 'Saved search not found' });
    return;
  }

  const updated = await prisma.savedSearch.update({
    where: { id },
    data: {
      ...result.data,
      maxPrice: result.data.maxPrice !== undefined ? result.data.maxPrice : existing.maxPrice,
    },
  });

  res.json({ search: updated });
});

// PATCH /api/saved-searches/:id/toggle — enable/disable notifications
router.patch('/:id/toggle', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const existing = await prisma.savedSearch.findUnique({ where: { id } });
  if (!existing || existing.userId !== req.user!.id) {
    res.status(404).json({ error: 'Saved search not found' });
    return;
  }

  const updated = await prisma.savedSearch.update({
    where: { id },
    data: { isActive: !existing.isActive },
  });

  res.json({ search: updated });
});

// DELETE /api/saved-searches/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const search = await prisma.savedSearch.findUnique({ where: { id } });
  if (!search || search.userId !== req.user!.id) {
    res.status(404).json({ error: 'Saved search not found' });
    return;
  }
  await prisma.savedSearch.delete({ where: { id } });
  res.json({ message: 'Saved search deleted' });
});

export { router as savedSearchesRouter };
