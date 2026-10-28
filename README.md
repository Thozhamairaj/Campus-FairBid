# 🎓 Campus FairBid — Real-Time Campus Auction Platform

> A transparent, anti-sniping campus marketplace where every item gets a fair chance at a fair price.

[![Tests](https://img.shields.io/badge/tests-20%2F20%20passing-brightgreen)](#testing)
[![Backend](https://img.shields.io/badge/backend-Node.js%20%2B%20TypeScript-blue)](#tech-stack)
[![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20Vite-purple)](#tech-stack)
[![DB](https://img.shields.io/badge/database-PostgreSQL%20%2B%20Prisma-336791)](#tech-stack)

---

## 🏆 Problem Statement

College seniors leaving campus need to sell used bicycles, calculators, textbooks, and electronics to juniors. Currently these transactions happen through unmoderated chat groups — bidding is opaque, prices are uncertain, and buyers constantly miss listings.

**Campus FairBid** solves this with transparent per-item auctions, server-side bid validation, real-time updates, and a structured campus handover workflow.

---

## ✨ Features

### Core Auction Engine
- **Server-side bid validation** — prices, timestamps, and auction status are *never* trusted from the client
- **Anti-sniping** — a valid bid within the last 30 seconds auto-extends the closing time by 60 seconds
- **Proxy auto-bidding** — set your maximum amount and the engine bids on your behalf (private, tie-broken by earliest registration)
- **Row-level locking** — SELECT FOR UPDATE inside Prisma transactions prevents concurrent double-bids
- **Exact numeric types** — monetary values stored as PostgreSQL DECIMAL, never floating point

### Real-Time
- **Socket.IO** — every bid, extension, auction close, and Q&A answer is pushed live to all connected clients
- **Notification system** — outbid alerts, new bids on watched items, saved search matches

### Auction Workflow
| Status | Description |
|--------|-------------|
| ACTIVE | Bidding open |
| CLOSED_UNSOLD | Closed with zero bids |
| PENDING_SELLER_DECISION | Seller must approve/reject winning bid |
| RESERVED_FOR_WINNER | Approved — arranging campus handover |
| SOLD | Handover confirmed by both parties |
| REJECTED | Seller rejected winning bid |
| CANCELLED | Seller cancelled (only if no bids) |
| FAILED_PICKUP | Buyer didn't collect — reopens for re-auction |

### Fair-Play Insights
Every listing exposes a fair-play endpoint that shows:
- Starting price, current price, minimum next bid
- Extension count and original vs current deadline
- Bid-by-bid transparency log
- Market price comparison from similar campus listings

### AI Buying Assistant
- Rule-based NLP intent parser — no external API key required
- Understands: category, budget, condition, closing window
- Returns ranked real listings with suggested bid amounts
- Bid confirmation modal prevents accidental orders

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 8, Vanilla CSS |
| Routing | React Router v6 |
| Real-time | Socket.IO client |
| HTTP client | Axios |
| Backend | Node.js 26, Express 4, TypeScript |
| ORM | Prisma 5 |
| Database | PostgreSQL 18 |
| Auth | JWT + bcryptjs |
| Validation | Zod |
| Scheduling | node-cron (auction closer every minute) |
| Testing | Jest + ts-jest |

---

## 🗂 Project Structure

```
campus-fairbid/
├── src/                         # React frontend
│   ├── components/
│   │   ├── Navbar.jsx           # Search, notifications, user menu
│   │   ├── ListingCard.jsx      # Auction card with countdown
│   │   └── CountdownTimer.jsx   # Live countdown with urgency colours
│   ├── contexts/
│   │   ├── AuthContext.jsx      # JWT auth state + socket connect/disconnect
│   │   └── ToastContext.jsx     # Global toast notifications
│   ├── lib/
│   │   ├── api.js               # Axios instance with JWT interceptor
│   │   └── socket.js            # Socket.IO client + room helpers
│   └── pages/
│       ├── HomePage.jsx         # Browse + category filter + closing soon
│       ├── ListingDetailPage.jsx
│       ├── CreateListingPage.jsx
│       ├── DashboardPage.jsx    # Seller dashboard with status tabs
│       ├── AIAssistantPage.jsx
│       ├── WatchlistPage.jsx
│       ├── SavedSearchesPage.jsx
│       ├── LoginPage.jsx
│       └── RegisterPage.jsx
│
└── server/
    ├── prisma/schema.prisma     # 12-model relational schema
    └── src/
        ├── routes/              # auth, listings, bids, questions, notifications,
        │                        # saved-searches, watchlist, seller, ai
        ├── services/
        │   ├── autoBidService.ts        # Proxy bidding engine
        │   ├── auctionCloser.ts         # Cron: close expired auctions
        │   ├── notificationService.ts
        │   └── savedSearchNotifier.ts
        ├── middleware/          # auth (JWT), errorHandler
        └── __tests__/
            └── bidding.test.ts  # 20 unit / integration tests
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18, PostgreSQL running locally, npm >= 8

### 1. Install

```bash
npm install                # frontend
cd server && npm install   # backend
```

### 2. Configure environment

```bash
# server/.env
DATABASE_URL="postgresql://postgres@localhost:5432/campus_fairbid"
JWT_SECRET="your-secret-here"
PORT=3001
FRONTEND_URL="http://localhost:5173"

# .env (root — frontend)
VITE_API_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001
```

### 3. Set up database

```bash
cd server
npx prisma migrate deploy   # run migrations
npm run db:seed             # seed demo data
```

### 4. Start both servers

```bash
# Terminal 1
cd server && npm run dev    # backend on :3001

# Terminal 2
npm run dev                 # frontend on :5173
```

Open **http://localhost:5173**

---

## 🎭 Demo Accounts

| Email | Password | Note |
|-------|----------|------|
| arjun@campus.edu | password123 | Seller: Atlas Bicycle |
| priya@campus.edu | password123 | Seller: Casio Calculator |
| rahul@campus.edu | password123 | Seller: Engineering Books |
| sneha@campus.edu | password123 | Seller: Sony Headphones |
| vikram@campus.edu | password123 | Seller: Hostel Bundle |

> Log in as two different accounts in separate tabs to demo real-time bidding and anti-sniping.

---

## 🧪 Testing

```bash
cd server && npm test
```

**20/20 tests — 8 suites:**

| Suite | Tests |
|-------|-------|
| Core Bidding Rules | 8 |
| Anti-Sniping Extension | 2 |
| Auction Closing Logic | 2 |
| Seller Decision | 2 |
| Concurrent Bid Protection | 1 |
| Automatic Bidding | 1 |
| Authorization Checks | 2 |
| Cancellation Rules | 2 |

Tests run against the real PostgreSQL database with isolated test data cleaned up after each test.

---

## 📡 API Reference

### Auth
```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me
```

### Listings
```
GET    /api/listings            search, filter, paginate
POST   /api/listings            create (auth)
GET    /api/listings/:id        full detail + user-specific fields
PUT    /api/listings/:id        edit (auth, seller, no bids)
DELETE /api/listings/:id        cancel (auth, seller)
```

### Bidding
```
POST   /api/bids/:listingId        place bid
GET    /api/bids/:listingId        bid history
POST   /api/bids/:listingId/auto   set auto-bid proxy
DELETE /api/bids/:listingId/auto   cancel auto-bid
```

### Seller Workflow
```
POST   /api/seller/:id/decide
POST   /api/seller/:id/handover/seller-confirm
POST   /api/seller/:id/handover/buyer-confirm
POST   /api/seller/:id/handover/failed
```

### AI & Insights
```
POST   /api/ai/assistant
GET    /api/ai/fair-play/:id
```

---

## 🔒 Security Rules (All Server-Enforced)

1. Bid amounts re-validated against DB state inside a locked transaction
2. User IDs always from verified JWT — never from request body
3. Auction status always re-read from DB with FOR UPDATE
4. Sellers cannot bid on their own listings
5. Rate limiting: 500/15m global, 20/15m auth, 10/1m bidding
6. All monetary amounts use PostgreSQL DECIMAL(12,2)

---

## 🔌 Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `listing:join` | C → S | Subscribe to listing room |
| `listing:leave` | C → S | Unsubscribe |
| `bid:accepted` | S → C | New bid placed |
| `auction:extended` | S → C | Anti-snipe extension |
| `auction:closed` | S → C | Auction closed by cron |
| `auction:decided` | S → C | Seller approved/rejected |
| `question:new` | S → C | New question |
| `question:answered` | S → C | Answer posted |
| `notification:new` | S → C | User notification |
