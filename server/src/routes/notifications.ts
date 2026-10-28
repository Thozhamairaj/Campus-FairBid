import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/notifications
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const unreadOnly = req.query.unread === 'true';
  const page = Math.max(1, parseInt(req.query.page as string || '1'));
  const limit = Math.min(50, parseInt(req.query.limit as string || '20'));

  const where = { userId, ...(unreadOnly ? { isRead: false } : {}) };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  res.json({ notifications, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }, unreadCount });
});

// POST /api/notifications/read-all
router.post('/read-all', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, isRead: false },
    data: { isRead: true },
  });
  res.json({ message: 'All notifications marked as read' });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const notif = await prisma.notification.findUnique({ where: { id } });
  if (!notif || notif.userId !== req.user!.id) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }
  await prisma.notification.update({ where: { id }, data: { isRead: true } });
  res.json({ message: 'Notification marked as read' });
});

export { router as notificationsRouter };
