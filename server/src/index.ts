import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import cron from 'node-cron';

import { authRouter } from './routes/auth';
import { listingsRouter } from './routes/listings';
import { bidsRouter } from './routes/bids';
import { questionsRouter } from './routes/questions';
import { notificationsRouter } from './routes/notifications';
import { savedSearchesRouter } from './routes/savedSearches';
import { watchlistRouter } from './routes/watchlist';
import { aiRouter } from './routes/ai';
import { sellerRouter } from './routes/seller';
import { setupSocketIO } from './services/socketService';
import { runAuctionCloser } from './services/auctionCloser';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

const app = express();
const httpServer = createServer(app);

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: frontendUrl,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Make io accessible to routes
app.set('io', io);

// Middlewares
app.use(cors({
  origin: frontendUrl,
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Auth rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts. Please try again later.',
});

// Routes
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/bids', bidsRouter);
app.use('/api/questions', questionsRouter);
app.use('/api/notifications', authenticate, notificationsRouter);
app.use('/api/saved-searches', authenticate, savedSearchesRouter);
app.use('/api/watchlist', authenticate, watchlistRouter);
app.use('/api/ai', aiRouter);
app.use('/api/seller', authenticate, sellerRouter);

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use(errorHandler);

// Socket.IO setup
setupSocketIO(io);

// Cron: close auctions every minute
cron.schedule('* * * * *', async () => {
  try {
    await runAuctionCloser(io);
  } catch (err) {
    console.error('[AuctionCloser] Error:', err);
  }
});

const PORT = parseInt(process.env.PORT || '3001', 10);
httpServer.listen(PORT, () => {
  console.log(`🚀 Campus FairBid server running on port ${PORT}`);
  console.log(`📡 Socket.IO ready`);
  console.log(`🌐 CORS allowed from: ${frontendUrl}`);
});

export { io };
