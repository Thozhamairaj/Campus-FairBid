import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Heart, HeartOff, ChevronLeft, User, AlertCircle, Info, CheckCircle, XCircle, Zap, Bot, Edit2, Trash2, Check, X } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import api from '../lib/api';
import socket, { joinListing, leaveListing } from '../lib/socket';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { CountdownTimer, FormatINR } from '../components/CountdownTimer';

const CONDITION_LABELS = { NEW: 'New', LIKE_NEW: 'Like New', GOOD: 'Good', FAIR: 'Fair', POOR: 'Poor' };
const CATEGORY_LABELS = { BICYCLE: '🚲 Bicycle', CALCULATOR: '🔢 Calculator', BOOKS: '📚 Books', ELECTRONICS: '⚡ Electronics', HOSTEL_ESSENTIALS: '🏠 Hostel Essentials', OTHER: '📦 Other' };
const PLACEHOLDER = 'https://images.unsplash.com/photo-1558618047-3cc0f9d9d9b0?w=800&q=80';

function StatusBanner({ listing }) {
  const statusMap = {
    CLOSED_UNSOLD: { cls: 'cancelled', icon: <XCircle size={18} />, msg: 'Auction closed with no bids.' },
    PENDING_SELLER_DECISION: { cls: 'pending', icon: <AlertCircle size={18} />, msg: 'Auction ended. Waiting for seller\'s decision.' },
    RESERVED_FOR_WINNER: { cls: 'reserved', icon: <CheckCircle size={18} />, msg: 'Item reserved for winner. Arranging campus handover.' },
    SOLD: { cls: 'sold', icon: <CheckCircle size={18} />, msg: '🎉 Item sold and successfully handed over!' },
    REJECTED: { cls: 'cancelled', icon: <XCircle size={18} />, msg: 'Seller rejected the winning bid.' },
    CANCELLED: { cls: 'cancelled', icon: <XCircle size={18} />, msg: `Auction cancelled. ${listing.cancelReason || ''}` },
    FAILED_PICKUP: { cls: 'cancelled', icon: <XCircle size={18} />, msg: 'Pickup failed. Contact the seller directly.' },
  };
  const info = statusMap[listing.status];
  if (!info) return null;
  return (
    <div className={`status-banner ${info.cls}`}>
      {info.icon}
      <span>{info.msg}</span>
    </div>
  );
}

export default function ListingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bidAmount, setBidAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [bidLoading, setBidLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [isWatched, setIsWatched] = useState(false);
  const [userAutoBid, setUserAutoBid] = useState(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [activeTab, setActiveTab] = useState('bids');
  const [questionText, setQuestionText] = useState('');
  const [answerText, setAnswerText] = useState({});
  const [questionLoading, setQuestionLoading] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const [editingQuestionText, setEditingQuestionText] = useState('');
  const [editingAnswerId, setEditingAnswerId] = useState(null);
  const [editingAnswerText, setEditingAnswerText] = useState('');
  const [qaActionLoading, setQaActionLoading] = useState(false);
  const [fairPlay, setFairPlay] = useState(null);
  const [fairPlayLoading, setFairPlayLoading] = useState(false);
  const [extendedMsg, setExtendedMsg] = useState('');
  const [closingAt, setClosingAt] = useState(null);

  const listingRef = useRef(null);

  useEffect(() => {
    fetchListing();
    joinListing(id);

    // Socket events
    socket.on('bid:accepted', handleBidAccepted);
    socket.on('auction:extended', handleExtended);
    socket.on('auction:closed', handleClosed);
    socket.on('auction:decided', handleDecided);
    socket.on('question:new', handleQuestionNew);
    socket.on('question:updated', handleQuestionUpdated);
    socket.on('question:deleted', handleQuestionDeleted);
    socket.on('question:answered', handleAnswered);
    socket.on('answer:updated', handleAnswerUpdated);
    socket.on('answer:deleted', handleAnswerDeleted);

    return () => {
      leaveListing(id);
      socket.off('bid:accepted', handleBidAccepted);
      socket.off('auction:extended', handleExtended);
      socket.off('auction:closed', handleClosed);
      socket.off('auction:decided', handleDecided);
      socket.off('question:new', handleQuestionNew);
      socket.off('question:updated', handleQuestionUpdated);
      socket.off('question:deleted', handleQuestionDeleted);
      socket.off('question:answered', handleAnswered);
      socket.off('answer:updated', handleAnswerUpdated);
      socket.off('answer:deleted', handleAnswerDeleted);
    };
  }, [id]);

  async function fetchListing() {
    try {
      const { data: res } = await api.get(`/listings/${id}`);
      setData(res);
      setIsWatched(res.isWatched);
      setUserAutoBid(res.userAutoBid);
      setClosingAt(res.listing.closingAt);
      if (res.listing.currentPrice) {
        const next = parseFloat(res.listing.currentPrice) + parseFloat(res.listing.minIncrement);
        setBidAmount(next.toFixed(0));
      } else {
        setBidAmount(parseFloat(res.listing.startingPrice).toFixed(0));
      }
    } catch {
      toast.error('Failed to load listing');
    } finally {
      setLoading(false);
    }
  }

  function handleBidAccepted({ listing: updatedListing, bid }) {
    setData(prev => {
      if (!prev) return prev;
      const existingBids = prev.listing.bids || [];
      const alreadyExists = existingBids.some(b => b.id === bid.id);
      return {
        ...prev,
        listing: {
          ...prev.listing,
          currentPrice: updatedListing?.currentPrice || bid.amount,
          bids: alreadyExists ? existingBids : [bid, ...existingBids].slice(0, 50),
        },
      };
    });
    if (data?.listing?.currentPrice) {
      const next = parseFloat(updatedListing?.currentPrice || bid.amount) + parseFloat(data.listing.minIncrement);
      setBidAmount(next.toFixed(0));
    }
    toast.info(`New bid: ₹${parseFloat(bid.amount).toLocaleString('en-IN')} by ${bid.bidder?.name}`);
  }

  function handleExtended({ newDeadline, extensionCount }) {
    setClosingAt(newDeadline);
    setData(prev => prev ? { ...prev, listing: { ...prev.listing, closingAt: newDeadline, extensionCount } } : prev);
    setExtendedMsg(`⚡ Deadline extended to ${format(new Date(newDeadline), 'h:mm:ss a')} (extension #${extensionCount})`);
    setTimeout(() => setExtendedMsg(''), 8000);
  }

  function handleClosed({ status }) {
    setData(prev => prev ? { ...prev, listing: { ...prev.listing, status } } : prev);
    toast.info('Auction has closed');
  }

  function handleDecided({ status }) {
    setData(prev => prev ? { ...prev, listing: { ...prev.listing, status } } : prev);
  }

  function handleQuestionNew({ question }) {
    setData(prev => prev ? {
      ...prev,
      listing: { ...prev.listing, questions: [...(prev.listing.questions || []), question] },
    } : prev);
  }

  function handleAnswered({ questionId, answer }) {
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        listing: {
          ...prev.listing,
          questions: (prev.listing.questions || []).map(q =>
            q.id === questionId ? { ...q, isAnswered: true, answer } : q
          ),
        },
      };
    });
  }

  function handleQuestionUpdated({ question }) {
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        listing: {
          ...prev.listing,
          questions: (prev.listing.questions || []).map(q => q.id === question.id ? question : q),
        },
      };
    });
  }

  function handleQuestionDeleted({ questionId }) {
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        listing: {
          ...prev.listing,
          questions: (prev.listing.questions || []).filter(q => q.id !== questionId),
        },
      };
    });
  }

  function handleAnswerUpdated({ questionId, answer }) {
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        listing: {
          ...prev.listing,
          questions: (prev.listing.questions || []).map(q =>
            q.id === questionId ? { ...q, answer } : q
          ),
        },
      };
    });
  }

  function handleAnswerDeleted({ questionId }) {
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        listing: {
          ...prev.listing,
          questions: (prev.listing.questions || []).map(q =>
            q.id === questionId ? { ...q, isAnswered: false, answer: null } : q
          ),
        },
      };
    });
  }

  async function placeBid(e) {
    e.preventDefault();
    if (!user) { navigate('/login'); return; }
    setBidLoading(true);
    try {
      const { data: res } = await api.post(`/bids/${id}`, { amount: parseFloat(bidAmount) });
      toast.success('Bid placed successfully!');
      const nextMin = parseFloat(res.bid.amount) + parseFloat(data.listing.minIncrement);
      setBidAmount(nextMin.toFixed(0));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to place bid');
    } finally {
      setBidLoading(false);
    }
  }

  async function setupAutoBid(e) {
    e.preventDefault();
    if (!user) { navigate('/login'); return; }
    setAutoLoading(true);
    try {
      const { data: res } = await api.post(`/bids/${id}/auto`, { maxAmount: parseFloat(maxAmount) });
      setUserAutoBid(res.autoBid);
      toast.success(`Auto-bid set! Maximum: ₹${parseFloat(maxAmount).toLocaleString('en-IN')}`);
      setMaxAmount('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to set auto-bid');
    } finally {
      setAutoLoading(false);
    }
  }

  async function cancelAutoBid() {
    try {
      await api.delete(`/bids/${id}/auto`);
      setUserAutoBid(null);
      toast.success('Auto-bid cancelled');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to cancel');
    }
  }

  async function toggleWatch() {
    if (!user) { navigate('/login'); return; }
    try {
      if (isWatched) {
        await api.delete(`/watchlist/${id}`);
        setIsWatched(false);
        toast.info('Removed from watchlist');
      } else {
        await api.post(`/watchlist/${id}`);
        setIsWatched(true);
        toast.success('Added to watchlist');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update watchlist');
    }
  }

  async function submitQuestion(e) {
    e.preventDefault();
    if (!user) { navigate('/login'); return; }
    setQuestionLoading(true);
    try {
      await api.post(`/questions/${id}`, { text: questionText });
      setQuestionText('');
      toast.success('Question submitted');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit question');
    } finally {
      setQuestionLoading(false);
    }
  }

  async function submitAnswer(questionId) {
    if (!answerText[questionId]?.trim() || answerText[questionId].trim().length < 2) {
      toast.error('Answer must be at least 2 characters');
      return;
    }
    try {
      await api.post(`/questions/${id}/${questionId}/answer`, { text: answerText[questionId].trim() });
      setAnswerText(prev => ({ ...prev, [questionId]: '' }));
      toast.success('Answer submitted');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit answer');
    }
  }

  async function submitEditQuestion(qId) {
    if (!editingQuestionText.trim() || editingQuestionText.trim().length < 5) {
      toast.error('Question must be at least 5 characters');
      return;
    }
    setQaActionLoading(true);
    try {
      const { data: res } = await api.put(`/questions/${id}/${qId}`, { text: editingQuestionText.trim() });
      setData(prev => prev ? {
        ...prev,
        listing: {
          ...prev.listing,
          questions: prev.listing.questions.map(q => q.id === qId ? res.question : q),
        },
      } : prev);
      setEditingQuestionId(null);
      toast.success('Question updated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update question');
    } finally {
      setQaActionLoading(false);
    }
  }

  async function deleteQuestion(qId) {
    if (!window.confirm('Are you sure you want to delete this question?')) return;
    setQaActionLoading(true);
    try {
      await api.delete(`/questions/${id}/${qId}`);
      setData(prev => prev ? {
        ...prev,
        listing: {
          ...prev.listing,
          questions: prev.listing.questions.filter(q => q.id !== qId),
        },
      } : prev);
      toast.success('Question deleted');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete question');
    } finally {
      setQaActionLoading(false);
    }
  }

  async function submitEditAnswer(qId) {
    if (!editingAnswerText.trim() || editingAnswerText.trim().length < 2) {
      toast.error('Answer must be at least 2 characters');
      return;
    }
    setQaActionLoading(true);
    try {
      const { data: res } = await api.put(`/questions/${id}/${qId}/answer`, { text: editingAnswerText.trim() });
      setData(prev => prev ? {
        ...prev,
        listing: {
          ...prev.listing,
          questions: prev.listing.questions.map(q => q.id === qId ? { ...q, answer: res.answer } : q),
        },
      } : prev);
      setEditingAnswerId(null);
      toast.success('Answer updated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update answer');
    } finally {
      setQaActionLoading(false);
    }
  }

  async function deleteAnswer(qId) {
    if (!window.confirm('Are you sure you want to delete this answer?')) return;
    setQaActionLoading(true);
    try {
      await api.delete(`/questions/${id}/${qId}/answer`);
      setData(prev => prev ? {
        ...prev,
        listing: {
          ...prev.listing,
          questions: prev.listing.questions.map(q => q.id === qId ? { ...q, isAnswered: false, answer: null } : q),
        },
      } : prev);
      toast.success('Answer deleted');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete answer');
    } finally {
      setQaActionLoading(false);
    }
  }

  async function sellerDecide(approved) {
    const reason = approved ? undefined : window.prompt('Reason for rejection (optional):') || undefined;
    try {
      await api.post(`/seller/${id}/decide`, { approved, reason });
      toast.success(approved ? 'Bid approved! Item reserved.' : 'Bid rejected');
      fetchListing();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  }

  async function loadFairPlay() {
    setFairPlayLoading(true);
    try {
      const { data: res } = await api.get(`/ai/fair-play/${id}`);
      setFairPlay(res);
    } catch {
      toast.error('Failed to load Fair-Play Insights');
    } finally {
      setFairPlayLoading(false);
    }
  }

  async function cancelListing() {
    const reason = window.prompt('Reason for cancellation (optional):') || 'Cancelled by seller';
    try {
      await api.delete(`/listings/${id}`, { data: { reason } });
      toast.success('Listing cancelled');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to cancel');
    }
  }

  if (loading) {
    return (
      <div className="page container">
        <div className="loading-center"><div className="spinner" /></div>
      </div>
    );
  }
  if (!data) {
    return <div className="page container"><div className="empty-state"><h3>Listing not found</h3></div></div>;
  }

  const { listing, userAutoBid: _uab } = data;
  const isActive = listing.status === 'ACTIVE';
  const isSeller = user?.id === listing.seller?.id;
  const currentPrice = listing.currentPrice || listing.startingPrice;
  const minNextBid = parseFloat(currentPrice) + parseFloat(listing.minIncrement);
  const images = listing.images?.length > 0 ? listing.images : [{ url: null }];

  const PLACEHOLDER_CAT = {
    BICYCLE: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=800&q=80',
    CALCULATOR: 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=800&q=80',
    BOOKS: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800&q=80',
    ELECTRONICS: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80',
    HOSTEL_ESSENTIALS: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
    OTHER: PLACEHOLDER,
  };

  return (
    <div className="page">
      <div className="container">
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, fontSize: 14, color: 'var(--color-navy-muted)' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ChevronLeft size={16} /> Browse
          </Link>
          <span>/</span>
          <span>{CATEGORY_LABELS[listing.category]}</span>
          <span>/</span>
          <span style={{ color: 'var(--color-navy)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{listing.title}</span>
        </div>

        {extendedMsg && (
          <div className="alert alert-warning mb-4" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={16} /> {extendedMsg}
          </div>
        )}

        <StatusBanner listing={listing} />

        <div className="detail-layout">
          {/* Left — Images + Details */}
          <div>
            {/* Image Gallery */}
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', overflow: 'hidden', aspectRatio: '16/9' }}>
                <img
                  src={images[selectedImage]?.url || PLACEHOLDER_CAT[listing.category]}
                  alt={listing.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => { e.target.src = PLACEHOLDER_CAT[listing.category]; }}
                />
              </div>
              {images.length > 1 && (
                <div style={{ display: 'flex', gap: 8, padding: '12px 16px', overflowX: 'auto' }}>
                  {images.map((img, i) => (
                    <div
                      key={i}
                      onClick={() => setSelectedImage(i)}
                      style={{
                        width: 64, height: 64, borderRadius: 8, overflow: 'hidden',
                        cursor: 'pointer', border: `2px solid ${i === selectedImage ? 'var(--color-green)' : 'transparent'}`,
                        flexShrink: 0,
                      }}
                    >
                      <img src={img.url || PLACEHOLDER_CAT[listing.category]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Description */}
            <div className="card card-body" style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 22, marginBottom: 8 }}>{listing.title}</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <span className="badge badge-gray">{CATEGORY_LABELS[listing.category]}</span>
                <span className="badge badge-amber">{CONDITION_LABELS[listing.condition]}</span>
                {listing.extensionCount > 0 && (
                  <span className="badge badge-blue">Extended {listing.extensionCount}×</span>
                )}
              </div>
              <p style={{ whiteSpace: 'pre-line', color: 'var(--color-navy)', lineHeight: 1.7, fontSize: 15 }}>
                {listing.description}
              </p>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)', display: 'flex', gap: 16, fontSize: 13, color: 'var(--color-navy-muted)', flexWrap: 'wrap' }}>
                <span><User size={14} style={{ verticalAlign: 'middle' }} /> {listing.seller?.name} · {listing.seller?.college}</span>
                {listing.seller?.hostel && <span>🏠 {listing.seller.hostel}</span>}
                <span>{listing.viewCount} views</span>
              </div>
            </div>

            {/* Tabs: Bids / Q&A / Status / Fair-Play */}
            <div className="card">
              <div className="tabs" style={{ padding: '0 16px', margin: 0 }}>
                {['bids', 'qa', 'status', 'fairplay'].map(t => (
                  <button
                    key={t}
                    className={`tab ${activeTab === t ? 'active' : ''}`}
                    onClick={() => { setActiveTab(t); if (t === 'fairplay' && !fairPlay) loadFairPlay(); }}
                  >
                    {{ bids: `Bids (${listing.bids?.length || 0})`, qa: `Q&A (${listing.questions?.length || 0})`, status: 'Status', fairplay: '📊 Fair-Play' }[t]}
                  </button>
                ))}
              </div>

              <div style={{ padding: 16 }}>
                {/* Bid History */}
                {activeTab === 'bids' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {!listing.bids?.length ? (
                      <div style={{ textAlign: 'center', padding: '32px', color: 'var(--color-navy-muted)' }}>
                        No bids yet. Be the first!
                      </div>
                    ) : (
                      listing.bids.map((bid, i) => (
                        <div key={bid.id} className={`bid-history-item ${i === 0 ? 'leading' : ''} ${bid.isAuto ? 'auto-bid' : ''}`}>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{bid.bidder?.name}</span>
                            {bid.isAuto && <span className="badge badge-blue" style={{ marginLeft: 6, fontSize: 10 }}>Auto</span>}
                            {i === 0 && <span className="badge badge-green" style={{ marginLeft: 6, fontSize: 10 }}>Leading</span>}
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, fontSize: 16, color: i === 0 ? 'var(--color-green)' : 'var(--color-navy)' }}>
                              ₹{parseFloat(bid.amount).toLocaleString('en-IN')}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--color-navy-muted)' }}>
                              {formatDistanceToNow(new Date(bid.createdAt), { addSuffix: true })}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Q&A */}
                {activeTab === 'qa' && (
                  <div>
                    {!listing.questions?.length ? (
                      <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--color-navy-muted)', fontSize: 14 }}>
                        💬 No questions yet. Have a question about this item? Ask the seller below!
                      </div>
                    ) : (
                      listing.questions.map(q => (
                        <div key={q.id} style={{ marginBottom: 16, padding: 14, background: 'var(--color-surface-2)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
                          {/* Question header & actions */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            {editingQuestionId === q.id ? (
                              <div style={{ flex: 1 }}>
                                <textarea
                                  className="form-textarea"
                                  value={editingQuestionText}
                                  onChange={e => setEditingQuestionText(e.target.value)}
                                  style={{ width: '100%', minHeight: 60, fontSize: 13, padding: 8 }}
                                  maxLength={500}
                                />
                                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                  <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => submitEditQuestion(q.id)}
                                    disabled={qaActionLoading || !editingQuestionText.trim()}
                                    style={{ gap: 4 }}
                                  >
                                    <Check size={14} /> Save
                                  </button>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setEditingQuestionId(null)}
                                    style={{ gap: 4 }}
                                  >
                                    <X size={14} /> Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-navy)', flex: 1 }}>
                                Q: {q.text}
                              </div>
                            )}

                            {editingQuestionId !== q.id && (
                              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                {user?.id === q.asker?.id && (
                                  <button
                                    className="btn btn-secondary btn-icon"
                                    style={{ padding: 4, height: 28, width: 28 }}
                                    onClick={() => { setEditingQuestionId(q.id); setEditingQuestionText(q.text); }}
                                    title="Edit your question"
                                  >
                                    <Edit2 size={13} />
                                  </button>
                                )}
                                {(user?.id === q.asker?.id || isSeller || user?.role === 'ADMIN') && (
                                  <button
                                    className="btn btn-secondary btn-icon"
                                    style={{ padding: 4, height: 28, width: 28, color: 'var(--color-red)' }}
                                    onClick={() => deleteQuestion(q.id)}
                                    title="Delete question"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          <div style={{ fontSize: 12, color: 'var(--color-navy-muted)', marginTop: 4, marginBottom: 10 }}>
                            by <strong>{q.asker?.name}</strong> · {formatDistanceToNow(new Date(q.createdAt), { addSuffix: true })}
                          </div>

                          {/* Answer section */}
                          {q.answer ? (
                            <div style={{ marginLeft: 12, paddingLeft: 12, borderLeft: '3px solid var(--color-green)', marginTop: 8 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                {editingAnswerId === q.id ? (
                                  <div style={{ flex: 1 }}>
                                    <textarea
                                      className="form-textarea"
                                      value={editingAnswerText}
                                      onChange={e => setEditingAnswerText(e.target.value)}
                                      style={{ width: '100%', minHeight: 60, fontSize: 13, padding: 8 }}
                                      maxLength={1000}
                                    />
                                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                      <button
                                        className="btn btn-primary btn-sm"
                                        onClick={() => submitEditAnswer(q.id)}
                                        disabled={qaActionLoading || !editingAnswerText.trim()}
                                        style={{ gap: 4 }}
                                      >
                                        <Check size={14} /> Save
                                      </button>
                                      <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setEditingAnswerId(null)}
                                        style={{ gap: 4 }}
                                      >
                                        <X size={14} /> Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-navy)', flex: 1 }}>
                                    A: {q.answer.text}
                                  </div>
                                )}

                                {isSeller && editingAnswerId !== q.id && (
                                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                    <button
                                      className="btn btn-secondary btn-icon"
                                      style={{ padding: 4, height: 26, width: 26 }}
                                      onClick={() => { setEditingAnswerId(q.id); setEditingAnswerText(q.answer.text); }}
                                      title="Edit your answer"
                                    >
                                      <Edit2 size={12} />
                                    </button>
                                    <button
                                      className="btn btn-secondary btn-icon"
                                      style={{ padding: 4, height: 26, width: 26, color: 'var(--color-red)' }}
                                      onClick={() => deleteAnswer(q.id)}
                                      title="Delete answer"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--color-navy-muted)', marginTop: 4 }}>
                                Answered by <strong>{q.answer.seller?.name || listing.seller?.name}</strong> (Seller)
                              </div>
                            </div>
                          ) : (
                            isSeller ? (
                              <div style={{ marginTop: 10, padding: 10, background: 'rgba(34, 197, 94, 0.05)', borderRadius: 6, border: '1px dashed var(--color-border)' }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-green)', marginBottom: 6 }}>
                                  💬 Answer as Seller:
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <input
                                    className="form-input"
                                    style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
                                    placeholder="Type your answer to this question..."
                                    value={answerText[q.id] || ''}
                                    onChange={e => setAnswerText(prev => ({ ...prev, [q.id]: e.target.value }))}
                                  />
                                  <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => submitAnswer(q.id)}
                                    disabled={!answerText[q.id]?.trim()}
                                  >
                                    Answer
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontSize: 12, color: 'var(--color-navy-muted)', fontStyle: 'italic', marginTop: 6 }}>
                                ⏳ Awaiting seller's answer
                              </div>
                            )
                          )}
                        </div>
                      ))
                    )}

                    {/* Ask a question form */}
                    {!isSeller && user && isActive && (
                      <form onSubmit={submitQuestion} style={{ marginTop: 16, padding: 14, background: 'var(--color-surface)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--color-navy)' }}>
                          Ask the Seller a Question
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <textarea
                            className="form-textarea"
                            placeholder="Ask about item specs, condition, pickup location..."
                            value={questionText}
                            onChange={e => setQuestionText(e.target.value)}
                            style={{ width: '100%', minHeight: 65, fontSize: 13 }}
                            maxLength={500}
                          />
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: 'var(--color-navy-muted)' }}>
                              {questionText.length}/500 chars (min 5)
                            </span>
                            <button
                              className="btn btn-primary btn-sm"
                              type="submit"
                              disabled={questionLoading || questionText.trim().length < 5}
                            >
                              {questionLoading ? 'Submitting...' : 'Post Question'}
                            </button>
                          </div>
                        </div>
                      </form>
                    )}

                    {!user && (
                      <div style={{ textAlign: 'center', marginTop: 16, padding: 12, background: 'var(--color-surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--color-navy-muted)' }}>
                        <Link to="/login" style={{ color: 'var(--color-green)', fontWeight: 600 }}>Sign in</Link> to ask a question on this listing.
                      </div>
                    )}

                    {isSeller && (
                      <div style={{ marginTop: 16, padding: 10, background: 'var(--color-surface-2)', borderRadius: 6, fontSize: 12, color: 'var(--color-navy-muted)', fontStyle: 'italic' }}>
                        ℹ️ As the seller, you can answer questions asked by prospective buyers above.
                      </div>
                    )}
                  </div>
                )}

                {/* Status History */}
                {activeTab === 'status' && (
                  <div>
                    {listing.statusHistory?.map((h, i) => (
                      <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                        <div style={{ width: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-green)', flexShrink: 0 }} />
                          {i < (listing.statusHistory?.length || 0) - 1 && (
                            <div style={{ width: 2, flex: 1, background: 'var(--color-border)', margin: '4px 0' }} />
                          )}
                        </div>
                        <div style={{ paddingBottom: 12 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{h.status.replace(/_/g, ' ')}</div>
                          {h.reason && <div style={{ fontSize: 12, color: 'var(--color-navy-muted)' }}>{h.reason}</div>}
                          <div style={{ fontSize: 11, color: 'var(--color-navy-muted)' }}>{format(new Date(h.createdAt), 'MMM d, h:mm a')}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Fair-Play Insights */}
                {activeTab === 'fairplay' && (
                  <div>
                    {fairPlayLoading ? (
                      <div className="loading-center"><div className="spinner" /></div>
                    ) : fairPlay ? (
                      <div>
                        <div className="alert alert-info mb-4">
                          <Info size={16} /> {fairPlay.fairnessNote}
                        </div>
                        <div className="card card-body mb-4">
                          <h4 style={{ marginBottom: 12 }}>Auction Metrics</h4>
                          {[
                            { label: 'Starting Price', value: `₹${parseFloat(fairPlay.startingPrice).toLocaleString('en-IN')}` },
                            { label: 'Current Price', value: fairPlay.currentPrice ? `₹${parseFloat(fairPlay.currentPrice).toLocaleString('en-IN')}` : '—' },
                            { label: 'Minimum Next Bid', value: `₹${parseFloat(fairPlay.minNextBid).toLocaleString('en-IN')}` },
                            { label: 'Minimum Increment', value: `₹${parseFloat(fairPlay.minIncrement).toLocaleString('en-IN')}` },
                            { label: 'Total Bids', value: fairPlay.totalBids },
                            { label: 'Deadline Extensions', value: fairPlay.extensionCount === 0 ? 'None' : `${fairPlay.extensionCount} time(s)` },
                            { label: 'Original Closing', value: fairPlay.originalClosingAt ? format(new Date(fairPlay.originalClosingAt), 'MMM d, h:mm a') : '—' },
                            { label: 'Current Closing', value: format(new Date(fairPlay.currentClosingAt), 'MMM d, h:mm a') },
                          ].map(row => (
                            <div key={row.label} className="insight-row">
                              <span className="insight-label">{row.label}</span>
                              <span className="insight-value">{row.value}</span>
                            </div>
                          ))}
                        </div>

                        {fairPlay.priceRange && (
                          <div className="card card-body mb-4">
                            <h4 style={{ marginBottom: 12 }}>Market Comparison ({fairPlay.comparables.length} similar items)</h4>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: 'var(--color-navy-muted)' }}>Min Seen</div>
                                <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--color-green)' }}>₹{fairPlay.priceRange.min.toLocaleString('en-IN')}</div>
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: 'var(--color-navy-muted)' }}>Average</div>
                                <div style={{ fontWeight: 700, fontSize: 18 }}>₹{Math.round(fairPlay.priceRange.avg).toLocaleString('en-IN')}</div>
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: 'var(--color-navy-muted)' }}>Max Seen</div>
                                <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--color-amber)' }}>₹{fairPlay.priceRange.max.toLocaleString('en-IN')}</div>
                              </div>
                            </div>
                          </div>
                        )}

                        {fairPlay.bidInsights?.length > 0 && (
                          <div>
                            <h4 style={{ marginBottom: 12 }}>Bid Transparency</h4>
                            {fairPlay.bidInsights.map((b, i) => (
                              <div key={i} style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 6, background: b.wasValid ? 'var(--color-green-pale)' : 'var(--color-red-pale)', fontSize: 13 }}>
                                <span style={{ fontWeight: 600 }}>{b.bidderName}</span> bid ₹{parseFloat(b.amount).toLocaleString('en-IN')}
                                {b.isAuto && ' (auto)'} — {b.reason}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: 32 }}>
                        <button className="btn btn-primary" onClick={loadFairPlay}>Load Fair-Play Insights</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right — Bid + Seller Actions */}
          <div>
            {/* Price Card */}
            <div className="card card-body" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--color-navy-muted)' }}>
                {listing.bids?.length ? 'Current bid' : 'Starting price'}
              </div>
              <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--color-green)', marginBottom: 4 }}>
                <FormatINR amount={currentPrice} />
              </div>
              {listing.bids?.length > 0 && (
                <div style={{ fontSize: 13, color: 'var(--color-navy-muted)', marginBottom: 8 }}>
                  Min. next bid: <strong>₹{minNextBid.toLocaleString('en-IN')}</strong>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)', margin: '8px 0' }}>
                <span style={{ fontSize: 13, color: 'var(--color-navy-muted)' }}>Time remaining</span>
                <CountdownTimer closingAt={closingAt || listing.closingAt} onExpired={() => setData(prev => prev ? { ...prev, listing: { ...prev.listing, status: 'CLOSED_UNSOLD' } } : prev)} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-navy-muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Condition: <strong>{CONDITION_LABELS[listing.condition]}</strong></span>
                <span>{listing.bids?.length || 0} bid{listing.bids?.length !== 1 ? 's' : ''}</span>
              </div>
            </div>

            {/* Bid Actions */}
            {isActive && !isSeller && (
              <div className="card card-body" style={{ marginBottom: 16 }}>
                <h4 style={{ marginBottom: 12 }}>Place a Bid</h4>
                {!user ? (
                  <div>
                    <p style={{ marginBottom: 12, fontSize: 14 }}>Sign in to place a bid</p>
                    <Link to="/login" className="btn btn-primary w-full" style={{ justifyContent: 'center' }}>Sign In</Link>
                  </div>
                ) : (
                  <>
                    <form onSubmit={placeBid}>
                      <div className="form-group mb-4">
                        <label className="form-label" htmlFor="bid-amount">
                          Your Bid (₹) — min ₹{minNextBid.toLocaleString('en-IN')}
                        </label>
                        <div className="bid-input-row">
                          <input
                            id="bid-amount"
                            type="number"
                            className="form-input"
                            value={bidAmount}
                            onChange={e => setBidAmount(e.target.value)}
                            min={listing.bids?.length ? minNextBid : parseFloat(listing.startingPrice)}
                            step={parseFloat(listing.minIncrement)}
                            required
                          />
                          <button className="btn btn-primary" type="submit" disabled={bidLoading}>
                            {bidLoading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Bid'}
                          </button>
                        </div>
                      </div>
                    </form>

                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                      <h5 style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Zap size={16} color="var(--color-blue)" /> Auto-Bid
                      </h5>
                      {userAutoBid?.isActive ? (
                        <div>
                          <div className="alert alert-info" style={{ marginBottom: 8 }}>
                            Auto-bid active · Max: ₹{parseFloat(userAutoBid.maxAmount).toLocaleString('en-IN')}
                          </div>
                          <button className="btn btn-secondary btn-sm w-full" onClick={cancelAutoBid} style={{ justifyContent: 'center' }}>Cancel Auto-Bid</button>
                        </div>
                      ) : (
                        <form onSubmit={setupAutoBid}>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                            <input
                              type="number"
                              className="form-input"
                              placeholder={`Max amount (₹)`}
                              value={maxAmount}
                              onChange={e => setMaxAmount(e.target.value)}
                              min={parseFloat(listing.startingPrice)}
                            />
                            <button className="btn btn-outline-green btn-sm" type="submit" disabled={autoLoading || !maxAmount}>
                              Set
                            </button>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--color-navy-muted)' }}>
                            We'll bid on your behalf up to your max. Private — never exposed to others.
                          </div>
                        </form>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Seller Pending Decision */}
            {listing.status === 'PENDING_SELLER_DECISION' && isSeller && (
              <div className="card card-body" style={{ marginBottom: 16 }}>
                <h4 style={{ marginBottom: 8 }}>Winning Bid Decision</h4>
                <div style={{ marginBottom: 12, padding: 12, background: 'var(--color-surface-2)', borderRadius: 8 }}>
                  <div style={{ fontSize: 13, color: 'var(--color-navy-muted)' }}>Highest bid</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-green)' }}>
                    ₹{parseFloat(currentPrice).toLocaleString('en-IN')}
                  </div>
                  <div style={{ fontSize: 13 }}>by {listing.bids?.[0]?.bidder?.name}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => sellerDecide(true)}>
                    ✓ Approve
                  </button>
                  <button className="btn btn-danger" style={{ flex: 1, justifyContent: 'center' }} onClick={() => sellerDecide(false)}>
                    ✕ Reject
                  </button>
                </div>
              </div>
            )}

            {/* Handover Status */}
            {listing.status === 'RESERVED_FOR_WINNER' && listing.handover && (
              <div className="card card-body" style={{ marginBottom: 16 }}>
                <h4 style={{ marginBottom: 12 }}>Campus Handover</h4>
                <div style={{ fontSize: 13, marginBottom: 12 }}>
                  <div>Seller: {listing.handover.seller?.name} {listing.handover.sellerConfirmed ? '✓' : '(pending)'}</div>
                  <div>Buyer: {listing.handover.buyer?.name} {listing.handover.buyerConfirmed ? '✓' : '(pending)'}</div>
                  {listing.handover.location && <div>Location: {listing.handover.location}</div>}
                </div>
                {isSeller && !listing.handover.sellerConfirmed && (
                  <button className="btn btn-primary w-full" style={{ justifyContent: 'center', marginBottom: 8 }}
                    onClick={async () => {
                      const loc = window.prompt('Handover location (optional):') || undefined;
                      await api.post(`/seller/${id}/handover/seller-confirm`, { location: loc });
                      fetchListing(); toast.success('Seller confirmation sent');
                    }}>
                    Confirm Ready to Hand Over
                  </button>
                )}
                {user?.id === listing.handover.buyer?.id && !listing.handover.buyerConfirmed && (
                  <button className="btn btn-primary w-full" style={{ justifyContent: 'center', marginBottom: 8 }}
                    onClick={async () => {
                      await api.post(`/seller/${id}/handover/buyer-confirm`);
                      fetchListing(); toast.success('Sale completed!');
                    }}>
                    Confirm Item Received
                  </button>
                )}
                {(isSeller || user?.id === listing.handover.buyer?.id) && (
                  <button className="btn btn-danger btn-sm w-full" style={{ justifyContent: 'center' }}
                    onClick={async () => {
                      const reason = window.prompt('Reason for failed pickup:') || 'Pickup failed';
                      await api.post(`/seller/${id}/handover/failed`, { reason });
                      fetchListing(); toast.info('Pickup failure recorded');
                    }}>
                    Report Failed Pickup
                  </button>
                )}
              </div>
            )}

            {/* Watchlist / Seller Actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!isSeller && user && (
                <button
                  className={`btn ${isWatched ? 'btn-secondary' : 'btn-outline-green'}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={toggleWatch}
                >
                  <Heart size={16} fill={isWatched ? 'currentColor' : 'none'} />
                  {isWatched ? 'Watching' : 'Watch'}
                </button>
              )}
              {isSeller && isActive && (
                <>
                  <Link to={`/edit/${id}`} className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>
                    Edit
                  </Link>
                  <button className="btn btn-danger btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={cancelListing}>
                    Cancel
                  </button>
                </>
              )}
            </div>

            {/* AI Assistant hint */}
            <div className="card card-body" style={{ marginTop: 16, background: 'var(--color-navy)', color: 'white' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                <Bot size={18} color="#52B788" />
                <span style={{ fontWeight: 600, fontSize: 14 }}>AI Buying Assistant</span>
              </div>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 12 }}>
                Not sure if this is the right price? Ask our AI assistant for market insights.
              </p>
              <Link to="/assistant" className="btn btn-sm" style={{ background: '#52B788', color: 'white', justifyContent: 'center' }}>
                Open Assistant
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
