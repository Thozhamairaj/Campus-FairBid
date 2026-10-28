import { useState, useEffect } from 'react';
import { Heart } from 'lucide-react';
import api from '../lib/api';
import ListingCard from '../components/ListingCard';
import { useToast } from '../contexts/ToastContext';

export default function WatchlistPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    fetchWatchlist();
  }, []);

  async function fetchWatchlist() {
    try {
      const { data } = await api.get('/watchlist');
      setItems(data.items);
    } catch {
      toast.error('Failed to load watchlist');
    } finally {
      setLoading(false);
    }
  }

  async function toggleWatch(listingId) {
    try {
      await api.delete(`/watchlist/${listingId}`);
      setItems(prev => prev.filter(item => item.listingId !== listingId));
      toast.info('Removed from watchlist');
    } catch {
      toast.error('Failed to remove');
    }
  }

  if (loading) {
    return <div className="page container"><div className="loading-center"><div className="spinner" /></div></div>;
  }

  return (
    <div className="page">
      <div className="container">
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ marginBottom: 8 }}>My Watchlist</h1>
          <p>Auctions you're tracking — {items.length} item{items.length !== 1 ? 's' : ''}</p>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Heart size={48} /></div>
            <h3>Your watchlist is empty</h3>
            <p>Add items you're interested in by clicking the heart icon on any listing</p>
          </div>
        ) : (
          <div className="grid-cards">
            {items.map(item => (
              <ListingCard
                key={item.id}
                listing={item.listing}
                isWatched={true}
                onWatchToggle={toggleWatch}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
