import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, TrendingUp, CheckCircle, Clock, XCircle, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { FormatINR } from '../components/CountdownTimer';
import ListingCard from '../components/ListingCard';

const STATUS_INFO = {
  ACTIVE: { icon: <Clock size={14} />, cls: 'badge-green', label: 'Active' },
  CLOSED_UNSOLD: { icon: <XCircle size={14} />, cls: 'badge-gray', label: 'Unsold' },
  PENDING_SELLER_DECISION: { icon: <AlertCircle size={14} />, cls: 'badge-amber', label: 'Pending Decision' },
  RESERVED_FOR_WINNER: { icon: <CheckCircle size={14} />, cls: 'badge-blue', label: 'Reserved' },
  SOLD: { icon: <CheckCircle size={14} />, cls: 'badge-green', label: 'Sold' },
  REJECTED: { icon: <XCircle size={14} />, cls: 'badge-red', label: 'Rejected' },
  CANCELLED: { icon: <XCircle size={14} />, cls: 'badge-red', label: 'Cancelled' },
  FAILED_PICKUP: { icon: <XCircle size={14} />, cls: 'badge-red', label: 'Failed Pickup' },
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ACTIVE');

  const statusTabs = ['ACTIVE', 'PENDING_SELLER_DECISION', 'RESERVED_FOR_WINNER', 'SOLD', 'CLOSED_UNSOLD', 'CANCELLED'];

  useEffect(() => {
    fetchListings();
  }, []);

  async function fetchListings() {
    try {
      const params = new URLSearchParams({ sellerId: user.id, limit: '50' });
      // Fetch all statuses
      const promises = statusTabs.map(s =>
        api.get(`/listings?${new URLSearchParams({ sellerId: user.id, status: s, limit: '20' })}`)
          .then(r => r.data.listings)
          .catch(() => [])
      );
      const results = await Promise.all(promises);
      const all = results.flat();
      setListings(all);
    } catch {
      // fallback: fetch active only
      const { data } = await api.get(`/listings?sellerId=${user.id}&status=ACTIVE&limit=50`);
      setListings(data.listings || []);
    } finally {
      setLoading(false);
    }
  }

  const filteredListings = listings.filter(l => l.status === activeTab);
  const stats = {
    total: listings.length,
    active: listings.filter(l => l.status === 'ACTIVE').length,
    sold: listings.filter(l => l.status === 'SOLD').length,
    pending: listings.filter(l => l.status === 'PENDING_SELLER_DECISION').length,
  };

  return (
    <div className="page">
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>My Listings</h1>
            <p>Manage your auction listings and seller decisions</p>
          </div>
          <Link to="/create" className="btn btn-primary">
            <Plus size={16} /> New Listing
          </Link>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 32 }}>
          {[
            { label: 'Total Listed', value: stats.total, icon: <TrendingUp size={20} />, color: 'var(--color-blue)' },
            { label: 'Active', value: stats.active, icon: <Clock size={20} />, color: 'var(--color-green)' },
            { label: 'Pending Decision', value: stats.pending, icon: <AlertCircle size={20} />, color: 'var(--color-amber)' },
            { label: 'Sold', value: stats.sold, icon: <CheckCircle size={20} />, color: 'var(--color-green)' },
          ].map(s => (
            <div key={s.label} className="card card-body" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ color: s.color }}>{s.icon}</div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'var(--color-navy-muted)' }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Pending Decisions Alert */}
        {stats.pending > 0 && (
          <div className="alert alert-warning mb-4">
            <AlertCircle size={16} />
            You have {stats.pending} auction{stats.pending > 1 ? 's' : ''} awaiting your decision. Please approve or reject the winning bids.
          </div>
        )}

        {/* Tabs */}
        <div className="tabs">
          {statusTabs.map(s => {
            const count = listings.filter(l => l.status === s).length;
            const info = STATUS_INFO[s];
            return (
              <button key={s} className={`tab ${activeTab === s ? 'active' : ''}`} onClick={() => setActiveTab(s)}>
                {info.label} {count > 0 && `(${count})`}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : filteredListings.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">{activeTab === 'ACTIVE' ? '📦' : '📋'}</div>
            <h3>No {STATUS_INFO[activeTab]?.label} listings</h3>
            {activeTab === 'ACTIVE' && (
              <Link to="/create" className="btn btn-primary mt-4">Create Your First Listing</Link>
            )}
          </div>
        ) : (
          <div className="grid-cards">
            {filteredListings.map(listing => (
              <div key={listing.id} style={{ position: 'relative' }}>
                <ListingCard listing={listing} />
                {listing.status === 'PENDING_SELLER_DECISION' && (
                  <div style={{ position: 'absolute', top: 8, left: 8 }}>
                    <span className="badge badge-amber">Action needed</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
