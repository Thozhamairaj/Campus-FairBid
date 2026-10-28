import prisma from '../lib/prisma';
import { Server as SocketIOServer } from 'socket.io';
import { NotificationType } from '@prisma/client';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  listingId?: string;
  io?: SocketIOServer;
}

export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const { userId, type, title, message, listingId, io } = params;

  const notification = await prisma.notification.create({
    data: { userId, type, title, message, listingId },
  });

  // Push real-time notification
  if (io) {
    io.to(`user:${userId}`).emit('notification:new', { notification });
  }
}

export async function createBulkNotifications(
  params: Omit<CreateNotificationParams, 'io'>[],
  io?: SocketIOServer
): Promise<void> {
  if (params.length === 0) return;

  await prisma.notification.createMany({
    data: params.map(({ userId, type, title, message, listingId }) => ({
      userId, type, title, message, listingId,
    })),
  });

  // Broadcast to each user
  if (io) {
    for (const p of params) {
      io.to(`user:${p.userId}`).emit('notification:new', {
        notification: { type: p.type, title: p.title, message: p.message, listingId: p.listingId },
      });
    }
  }
}
