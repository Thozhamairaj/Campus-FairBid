import { PrismaClient, ListingCategory, ListingCondition } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Campus FairBid database...');

  // Clean up existing data
  await prisma.handoverConfirmation.deleteMany();
  await prisma.sellerDecision.deleteMany();
  await prisma.auctionStatusHistory.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.question.deleteMany();
  await prisma.autoBid.deleteMany();
  await prisma.bid.deleteMany();
  await prisma.listingImage.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.watchlist.deleteMany();
  await prisma.savedSearch.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.user.deleteMany();

  // Create demo users
  const hash = (pw: string) => bcrypt.hash(pw, 10);

  const [arjun, priya, rahul, sneha, vikram] = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Arjun Kumar',
        email: 'arjun@campus.edu',
        passwordHash: await hash('password123'),
        college: 'IIT Campus',
        hostel: 'Brahmaputra Hostel',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Priya Sharma',
        email: 'priya@campus.edu',
        passwordHash: await hash('password123'),
        college: 'IIT Campus',
        hostel: 'Saraswati Hostel',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Rahul Verma',
        email: 'rahul@campus.edu',
        passwordHash: await hash('password123'),
        college: 'IIT Campus',
        hostel: 'Ganga Hostel',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Sneha Patel',
        email: 'sneha@campus.edu',
        passwordHash: await hash('password123'),
        college: 'IIT Campus',
        hostel: 'Yamuna Hostel',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Vikram Singh',
        email: 'vikram@campus.edu',
        passwordHash: await hash('password123'),
        college: 'IIT Campus',
        hostel: 'Kaveri Hostel',
      },
    }),
  ]);

  console.log('✅ Created 5 demo users');

  const now = new Date();
  const inMinutes = (m: number) => new Date(now.getTime() + m * 60 * 1000);
  const inHours = (h: number) => new Date(now.getTime() + h * 60 * 60 * 1000);
  const inDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

  // Helper to create listing with status history
  async function createListing(data: {
    sellerId: string;
    title: string;
    description: string;
    category: ListingCategory;
    condition: ListingCondition;
    startingPrice: number;
    minIncrement: number;
    closingAt: Date;
    imageUrls?: string[];
  }) {
    const listing = await prisma.listing.create({
      data: {
        sellerId: data.sellerId,
        title: data.title,
        description: data.description,
        category: data.category,
        condition: data.condition,
        startingPrice: new Decimal(data.startingPrice),
        minIncrement: new Decimal(data.minIncrement),
        closingAt: data.closingAt,
        originalClosingAt: data.closingAt,
      },
    });

    if (data.imageUrls && data.imageUrls.length > 0) {
      await prisma.listingImage.createMany({
        data: data.imageUrls.map((url, i) => ({ listingId: listing.id, url, order: i })),
      });
    }

    await prisma.auctionStatusHistory.create({
      data: { listingId: listing.id, status: 'ACTIVE', reason: 'Listing created' },
    });

    return listing;
  }

  // Listing 1: Bicycle — closing in 5 minutes (for quick demo)
  const bicycle = await createListing({
    sellerId: arjun.id,
    title: 'Atlas Bicycle - Perfect for Campus Commute',
    description: `Selling my trusty Atlas cycle after 3 years of campus use. Tires replaced 6 months ago, brakes work perfectly, chain oiled and maintained. Has a headlight, rear reflector, and a carrier. Great for getting around campus quickly. Reason for selling: graduating and can't take it home.`,
    category: 'BICYCLE',
    condition: 'GOOD',
    startingPrice: 800,
    minIncrement: 50,
    closingAt: inMinutes(6), // Closes in 6 min for demo
    imageUrls: [
      'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=600&q=80',
    ],
  });

  // Listing 2: Calculator — closes in 2 hours
  const calculator = await createListing({
    sellerId: priya.id,
    title: 'Casio FX-991ES Plus Scientific Calculator',
    description: `Used for 2 semesters. In excellent condition — all keys responsive, screen crystal clear, no scratches. Comes with original case and manual. Perfect for all engineering entrance and university exams. Selling because I'm shifting to the FX-991CW.`,
    category: 'CALCULATOR',
    condition: 'LIKE_NEW',
    startingPrice: 200,
    minIncrement: 20,
    closingAt: inHours(2),
    imageUrls: [
      'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=600&q=80',
    ],
  });

  // Listing 3: Books — closes in 6 hours
  const books = await createListing({
    sellerId: rahul.id,
    title: 'Engineering Mathematics Bundle — 3rd Year Complete Set',
    description: `Selling complete set of 3rd year engineering mathematics books:\n- Higher Engineering Mathematics by B.S. Grewal (47th Ed.)\n- Advanced Engineering Mathematics by Kreyszig (10th Ed.)\n- Numerical Methods by S.S. Shastry\n\nAll in good condition. Some pencil marks in Grewal which can be erased. Perfect for CSE/ECE students.`,
    category: 'BOOKS',
    condition: 'GOOD',
    startingPrice: 350,
    minIncrement: 25,
    closingAt: inHours(6),
    imageUrls: [
      'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=600&q=80',
    ],
  });

  // Listing 4: Electronics — closes in 1 day
  const electronics = await createListing({
    sellerId: sneha.id,
    title: 'BoAt Rockerz 450 Bluetooth Headphones — Excellent Sound',
    description: `Selling my BoAt Rockerz 450 after upgrading to ANC headphones. Battery holds charge for ~12 hours, which is close to the advertised 15h (after 1 year of use). 40mm drivers deliver excellent bass. Comes with original charging cable and aux cable. Minor scuff on the headband — barely visible.`,
    category: 'ELECTRONICS',
    condition: 'GOOD',
    startingPrice: 500,
    minIncrement: 50,
    closingAt: inDays(1),
    imageUrls: [
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80',
    ],
  });

  // Listing 5: Hostel Essentials — closes in 3 days
  const hostel = await createListing({
    sellerId: vikram.id,
    title: 'Hostel Essentials Bundle — Bucket, Mug, Hangers, Curtains',
    description: `Leaving campus after 4 years! Selling everything I don't need:\n- 2 Plastic buckets with mugs\n- 10 cloth hangers\n- Window curtains (blue, 2 panels, 4x5 ft)\n- Extension board (3 pin, 2m wire)\n- Small table fan (Usha Maxx Air) — works perfectly\n\nAll items in good to fair condition. Selling as a bundle for ₹600 or best offer.`,
    category: 'HOSTEL_ESSENTIALS',
    condition: 'FAIR',
    startingPrice: 300,
    minIncrement: 30,
    closingAt: inDays(3),
    imageUrls: [
      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80',
    ],
  });

  // Listing 6: Calculator — closes in 10 minutes (quick demo)
  const calc2 = await createListing({
    sellerId: rahul.id,
    title: 'Casio FX-82MS Scientific Calculator',
    description: `Basic scientific calculator, used for 2 years. All functions working. Display is clear. Good for basic engineering calculations. Selling because I bought the ES Plus. Battery included and fresh.`,
    category: 'CALCULATOR',
    condition: 'GOOD',
    startingPrice: 120,
    minIncrement: 10,
    closingAt: inMinutes(15),
    imageUrls: [
      'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=600&q=80',
    ],
  });

  console.log('✅ Created 6 demo listings');

  // Add some bids to make things interesting
  // Bids on bicycle
  await prisma.bid.create({ data: { listingId: bicycle.id, bidderId: priya.id, amount: new Decimal(850) } });
  await prisma.listing.update({ where: { id: bicycle.id }, data: { currentPrice: new Decimal(850) } });
  
  await prisma.bid.create({ data: { listingId: bicycle.id, bidderId: rahul.id, amount: new Decimal(950) } });
  await prisma.listing.update({ where: { id: bicycle.id }, data: { currentPrice: new Decimal(950) } });

  // Bids on calculator
  await prisma.bid.create({ data: { listingId: calculator.id, bidderId: arjun.id, amount: new Decimal(220) } });
  await prisma.listing.update({ where: { id: calculator.id }, data: { currentPrice: new Decimal(220) } });

  await prisma.bid.create({ data: { listingId: calculator.id, bidderId: vikram.id, amount: new Decimal(260) } });
  await prisma.listing.update({ where: { id: calculator.id }, data: { currentPrice: new Decimal(260) } });

  // Bid on headphones
  await prisma.bid.create({ data: { listingId: electronics.id, bidderId: rahul.id, amount: new Decimal(550) } });
  await prisma.listing.update({ where: { id: electronics.id }, data: { currentPrice: new Decimal(550) } });

  // Bid on books
  await prisma.bid.create({ data: { listingId: books.id, bidderId: sneha.id, amount: new Decimal(375) } });
  await prisma.listing.update({ where: { id: books.id }, data: { currentPrice: new Decimal(375) } });

  console.log('✅ Added demo bids');

  // Questions & answers on bicycle
  const q1 = await prisma.question.create({
    data: {
      listingId: bicycle.id,
      askerId: priya.id,
      text: 'Are the tires tubeless or tube type? And which hostel are you in?',
    },
  });
  await prisma.answer.create({
    data: {
      questionId: q1.id,
      sellerId: arjun.id,
      text: 'Tube type tires. I am in Brahmaputra Hostel, Room 214. We can meet there for inspection before bidding.',
    },
  });
  await prisma.question.update({ where: { id: q1.id }, data: { isAnswered: true } });

  const q2 = await prisma.question.create({
    data: {
      listingId: bicycle.id,
      askerId: vikram.id,
      text: 'Does it have a lock? And is the seat adjustable?',
    },
  });

  console.log('✅ Added Q&A demo data');

  // Watchlists
  await prisma.watchlist.createMany({
    data: [
      { userId: priya.id, listingId: bicycle.id },
      { userId: rahul.id, listingId: calculator.id },
      { userId: sneha.id, listingId: electronics.id },
      { userId: arjun.id, listingId: books.id },
    ],
  });

  // Saved searches
  await prisma.savedSearch.createMany({
    data: [
      { userId: arjun.id, name: 'Cheap calculator', category: 'CALCULATOR', maxPrice: new Decimal(300) },
      { userId: priya.id, name: 'Campus cycle', category: 'BICYCLE', maxPrice: new Decimal(1500) },
      { userId: rahul.id, name: 'Closing soon deals', closingSoon: true },
    ],
  });

  console.log('✅ Added watchlists and saved searches');

  console.log('\n🎉 Seeding complete! Demo credentials:');
  console.log('Email: arjun@campus.edu   | Password: password123 (Seller: Bicycle)');
  console.log('Email: priya@campus.edu   | Password: password123 (Seller: Calculator)');
  console.log('Email: rahul@campus.edu   | Password: password123 (Seller: Books)');
  console.log('Email: sneha@campus.edu   | Password: password123 (Seller: Headphones)');
  console.log('Email: vikram@campus.edu  | Password: password123 (Seller: Hostel Bundle)');
  console.log('\n📋 Quick demo tips:');
  console.log('- "Atlas Bicycle" closes in ~6 minutes — perfect for demonstrating anti-sniping!');
  console.log('- "Casio FX-82MS" closes in ~15 minutes — good for extended demo');
  console.log('- Log in as different users to test bidding, questions, and seller actions');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
