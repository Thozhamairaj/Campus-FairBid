import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { CountdownTimer, FormatINR } from './CountdownTimer';

const CONDITION_LABELS = { NEW: 'New', LIKE_NEW: 'Like New', GOOD: 'Good', FAIR: 'Fair', POOR: 'Poor' };
const CATEGORY_LABELS = { BICYCLE: '🚲 Bicycle', CALCULATOR: '🔢 Calculator', BOOKS: '📚 Books', ELECTRONICS: '⚡ Electronics', HOSTEL_ESSENTIALS: '🏠 Hostel', OTHER: '📦 Other' };
const CONDITION_CLASS = { NEW: 'badge-green', LIKE_NEW: 'badge-blue', GOOD: 'badge-amber', FAIR: 'badge-gray', POOR: 'badge-gray' };

const PLACEHOLDER_IMAGES = {
  BICYCLE: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=400&q=75',
  CALCULATOR: 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=400&q=75',
  BOOKS: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=400&q=75',
  ELECTRONICS: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&q=75',
  HOSTEL_ESSENTIALS: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=75',
  OTHER: 'https://images.unsplash.com/photo-1558618047-3cc0f9d9d9b0?w=400&q=75',
};

export default function ListingCard({ listing, onWatchToggle, isWatched }) {
  const navigate = useNavigate();
  const currentPrice = listing.currentPrice || listing.startingPrice;
  const bidCount = listing._count?.bids ?? 0;
  const imageUrl = listing.images?.[0]?.url || PLACEHOLDER_IMAGES[listing.category] || PLACEHOLDER_IMAGES.OTHER;

  return (
    <div className="listing-card" onClick={() => navigate(`/listing/${listing.id}`)}>
      <div className="listing-card-image">
        <img
          src={imageUrl}
          alt={listing.title}
          loading="lazy"
          onError={e => { e.target.src = PLACEHOLDER_IMAGES[listing.category] || PLACEHOLDER_IMAGES.OTHER; }}
        />
        {onWatchToggle && (
          <button
            className="btn btn-icon"
            style={{
              position: 'absolute', top: 8, right: 8,
              background: 'rgba(255,255,255,0.9)',
              backdropFilter: 'blur(4px)',
              border: '1px solid var(--color-border)',
              color: isWatched ? 'var(--color-red)' : 'var(--color-navy-muted)',
            }}
            onClick={e => { e.stopPropagation(); onWatchToggle(listing.id, isWatched); }}
            aria-label={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            <Heart size={16} fill={isWatched ? 'currentColor' : 'none'} />
          </button>
        )}
        {listing.status !== 'ACTIVE' && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(26,31,54,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span className="badge badge-navy" style={{ fontSize: 12 }}>{listing.status.replace(/_/g, ' ')}</span>
          </div>
        )}
      </div>

      <div className="listing-card-body">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="badge badge-gray">{CATEGORY_LABELS[listing.category]}</span>
          <span className={`badge ${CONDITION_CLASS[listing.condition]}`}>{CONDITION_LABELS[listing.condition]}</span>
        </div>

        <div className="listing-card-title">{listing.title}</div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--color-navy-muted)', marginBottom: 2 }}>
            {bidCount === 0 ? 'Starting at' : 'Current bid'}
          </div>
          <div className="listing-card-price">
            <FormatINR amount={currentPrice} />
          </div>
        </div>

        <div className="listing-card-meta">
          <CountdownTimer closingAt={listing.closingAt} compact />
          {bidCount > 0 && (
            <span className="text-xs text-muted">{bidCount} bid{bidCount !== 1 ? 's' : ''}</span>
          )}
          <span className="text-xs text-muted" style={{ marginLeft: 'auto' }}>{listing.seller?.name}</span>
        </div>
      </div>
    </div>
  );
}
