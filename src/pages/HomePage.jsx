import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Zap, Shield, Clock, TrendingUp } from 'lucide-react';
import api from '../lib/api';
import ListingCard from '../components/ListingCard';
import { CountdownTimer } from '../components/CountdownTimer';
import { useAuth } from '../contexts/AuthContext';

const CATEGORY_LABELS = {
  BICYCLE: '🚲 Bicycles',
  CALCULATOR: '🔢 Calculators',
  BOOKS: '📚 Books',
  ELECTRONICS: '⚡ Electronics',
  HOSTEL_ESSENTIALS: '🏠 Hostel Essentials',
  OTHER: '📦 Other',
};

export default function HomePage({ searchQuery }) {
  const { user } = useAuth();
  const [listings, setListings] = useState([]);
  const [closingSoon, setClosingSoon] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [stats, setStats] = useState({ total: 0, categories: 0, bids: 0 });

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '12', sortBy: 'createdAt', sortOrder: 'desc' });
      if (selectedCategory) params.set('category', selectedCategory);
      if (searchQuery) params.set('search', searchQuery);

      const [listingsRes, closingRes] = await Promise.all([
        api.get(`/listings?${params}`),
        api.get('/listings?closingSoon=true&limit=4&sortBy=closingAt&sortOrder=asc'),
      ]);

      setListings(listingsRes.data.listings);
      setClosingSoon(closingRes.data.listings);
      setStats({
        total: listingsRes.data.pagination.total,
        categories: Object.keys(CATEGORY_LABELS).length,
        bids: listingsRes.data.listings.reduce((s, l) => s + (l._count?.bids || 0), 0),
      });
    } catch (err) {
      console.error('Failed to fetch listings:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, searchQuery]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  return (
    <>
      {/* Hero Section */}
      <section className="hero-section">
        <div className="container">
          <div style={{ maxWidth: 600 }}>
            <p className="hero-tagline">Campus Marketplace</p>
            <h1 className="hero-title">
              Every item deserves a <span>fair</span> next owner.
            </h1>
            <p className="hero-desc">
              Transparent auctions for campus students. Bid fairly, sell confidently, and complete hassle-free campus handovers.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {user ? (
                <Link to="/create" className="btn btn-primary btn-lg">
                  List Your Item <ArrowRight size={18} />
                </Link>
              ) : (
                <Link to="/register" className="btn btn-primary btn-lg">
                  Join Campus FairBid <ArrowRight size={18} />
                </Link>
              )}
              <Link to="/assistant" className="btn btn-lg" style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1.5px solid rgba(255,255,255,0.3)' }}>
                🤖 AI Assistant
              </Link>
            </div>
          </div>

          <div className="hero-stats">
            <div>
              <div className="hero-stat-value">{stats.total}+</div>
              <div className="hero-stat-label">Active Auctions</div>
            </div>
            <div>
              <div className="hero-stat-value">{stats.categories}</div>
              <div className="hero-stat-label">Categories</div>
            </div>
            <div>
              <div className="hero-stat-value">{stats.bids}+</div>
              <div className="hero-stat-label">Bids Placed</div>
            </div>
          </div>
        </div>
      </section>

      <div className="container">
        {/* Features */}
        <section style={{ paddingTop: 48, paddingBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            {[
              { icon: <Shield size={20} />, title: 'Server-side Validation', desc: 'Every bid verified on the backend. No cheating.' },
              { icon: <Zap size={20} />, title: 'Anti-Sniping', desc: 'Last-second bids auto-extend the deadline.' },
              { icon: <TrendingUp size={20} />, title: 'Auto-Bidding', desc: 'Set your max and let the engine bid for you.' },
              { icon: <Clock size={20} />, title: 'Real-Time Updates', desc: 'Live bids and prices via Socket.IO.' },
            ].map(f => (
              <div key={f.title} className="card card-body" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ color: 'var(--color-green)', marginTop: 2 }}>{f.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{f.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-navy-muted)' }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Closing Soon */}
        {closingSoon.length > 0 && (
          <section style={{ paddingTop: 40 }}>
            <div className="section-header">
              <h2 className="section-title">⏰ Closing Soon</h2>
              <Link to="/?closingSoon=true" className="btn btn-secondary btn-sm">View All</Link>
            </div>
            <div className="grid-cards">
              {closingSoon.map(listing => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          </section>
        )}

        {/* Browse All */}
        <section style={{ paddingTop: 40, paddingBottom: 40 }}>
          <div className="section-header">
            <h2 className="section-title">
              {searchQuery ? `Results for "${searchQuery}"` : 'Browse Auctions'}
            </h2>
          </div>

          {/* Category Filter */}
          <div className="filter-strip">
            <button
              className={`filter-chip ${selectedCategory === '' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('')}
            >
              All Items
            </button>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <button
                key={key}
                className={`filter-chip ${selectedCategory === key ? 'active' : ''}`}
                onClick={() => setSelectedCategory(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="grid-cards">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card" style={{ overflow: 'hidden' }}>
                  <div className="skeleton" style={{ height: 200 }} />
                  <div style={{ padding: 16 }}>
                    <div className="skeleton" style={{ height: 14, marginBottom: 8, width: '60%' }} />
                    <div className="skeleton" style={{ height: 24, marginBottom: 8, width: '40%' }} />
                    <div className="skeleton" style={{ height: 12, width: '80%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : listings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔍</div>
              <h3>No listings found</h3>
              <p>Try a different search or category, or be the first to list!</p>
              <Link to="/create" className="btn btn-primary mt-4">Create Listing</Link>
            </div>
          ) : (
            <div className="grid-cards">
              {listings.map(listing => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
