import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

export function setupSocketIO(io: SocketIOServer): void {
  io.use(async (socket, next) => {
    // Optional auth for socket connections
    const token = socket.handshake.auth.token as string | undefined;
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET) as { sub: string; name: string };
        (socket as Socket & { userId?: string; userName?: string }).userId = payload.sub;
        (socket as Socket & { userId?: string; userName?: string }).userName = payload.name;
      } catch {
        // Invalid token — allow anonymous
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    const authedSocket = socket as Socket & { userId?: string; userName?: string };
    
    if (authedSocket.userId) {
      // Join user-specific room for personal notifications
      socket.join(`user:${authedSocket.userId}`);
    }

    // Join listing room for real-time auction updates
    socket.on('listing:join', async ({ listingId }: { listingId: string }) => {
      socket.join(`listing:${listingId}`);
      
      // Send current auction state on join
      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        select: { id: true, status: true, currentPrice: true, closingAt: true, extensionCount: true },
      }).catch(() => null);

      if (listing) {
        socket.emit('listing:state', { listing });
      }
    });

    socket.on('listing:leave', ({ listingId }: { listingId: string }) => {
      socket.leave(`listing:${listingId}`);
    });

    socket.on('disconnect', () => {
      // cleanup handled automatically by socket.io
    });
  });
}
