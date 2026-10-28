import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, Bot, Sparkles, Gavel } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { FormatINR, CountdownTimer } from '../components/CountdownTimer';
import { useToast } from '../contexts/ToastContext';

const SUGGESTIONS = [
  'Find me a cycle under ₹1,500 closing today',
  'Show calculators in good condition under ₹300',
  'Engineering textbooks below ₹500',
  'Electronics under ₹1,000',
];

function ResultCard({ item, onBid }) {
  const { listing, explanation, suggestedBid, matchScore } = item;
  const currentPrice = listing.currentPrice || listing.startingPrice;
  const img = listing.images?.[0]?.url || null;

  const PLACEHOLDER = {
    BICYCLE: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=300&q=70',
    CALCULATOR: 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=300&q=70',
    BOOKS: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=300&q=70',
    ELECTRONICS: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&q=70',
    HOSTEL_ESSENTIALS: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=300&q=70',
    OTHER: 'https://images.unsplash.com/photo-1558618047-3cc0f9d9d9b0?w=300&q=70',
  };

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', gap: 12, padding: 12 }}>
        <img
          src={img || PLACEHOLDER[listing.category]}
          alt={listing.title}
          style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
          onError={e => { e.target.src = PLACEHOLDER[listing.category]; }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/listing/${listing.id}`} style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-navy)', display: 'block', marginBottom: 4 }}>
            {listing.title}
          </Link>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-green)', marginBottom: 4 }}>
            ₹{parseFloat(currentPrice).toLocaleString('en-IN')}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <CountdownTimer closingAt={listing.closingAt} compact />
            <span style={{ fontSize: 11, color: 'var(--color-navy-muted)' }}>{listing._count?.bids || 0} bids</span>
          </div>
        </div>
      </div>
      <div style={{ padding: '8px 12px', background: 'var(--color-green-bg)', borderTop: '1px solid var(--color-border)', fontSize: 12, color: 'var(--color-green)' }}>
        ✓ {explanation}
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--color-navy-muted)' }}>
          Suggested bid: <strong>₹{parseFloat(suggestedBid).toLocaleString('en-IN')}</strong>
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Link to={`/listing/${listing.id}`} className="btn btn-secondary btn-sm">View</Link>
          <button className="btn btn-primary btn-sm" onClick={() => onBid(listing, suggestedBid)}>
            <Gavel size={14} /> Bid
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AIAssistantPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Hi! I'm your AI buying assistant. Tell me what you're looking for — category, budget, condition, or when it should close — and I'll search real campus listings for you.\n\nFor example: *"Find a cycle under ₹1,500 closing today"*`,
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingBid, setPendingBid] = useState(null);
  const [bidConfirmLoading, setBidConfirmLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text) {
    const query = text || input.trim();
    if (!query) return;
    setInput('');

    setMessages(prev => [...prev, { role: 'user', content: query }]);
    setLoading(true);

    try {
      const { data } = await api.post('/ai/assistant', { query });

      let responseText = data.summary + '\n\n';
      if (data.intent.category) responseText += `📦 Category: ${data.intent.category}\n`;
      if (data.intent.maxPrice) responseText += `💰 Budget: up to ₹${data.intent.maxPrice.toLocaleString('en-IN')}\n`;
      if (data.intent.condition) responseText += `⭐ Condition: ${data.intent.condition}\n`;
      if (data.intent.closingSoon) responseText += `⏰ Closing: within 24 hours\n`;

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: responseText.trim(),
          results: data.results,
        }
      ]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: err.response?.data?.error || 'Sorry, I encountered an error. Please try again.',
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleBidClick(listing, suggestedBid) {
    if (!user) {
      toast.info('Please sign in to place a bid');
      return;
    }
    setPendingBid({ listing, suggestedBid });
  }

  async function confirmBid() {
    if (!pendingBid) return;
    setBidConfirmLoading(true);
    try {
      await api.post(`/bids/${pendingBid.listing.id}`, { amount: parseFloat(pendingBid.suggestedBid) });
      toast.success(`Bid of ₹${parseFloat(pendingBid.suggestedBid).toLocaleString('en-IN')} placed!`);
      setPendingBid(null);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Bid placed successfully on "${pendingBid.listing.title}" for ₹${parseFloat(pendingBid.suggestedBid).toLocaleString('en-IN')}! You can track it in the listing.`,
      }]);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to place bid');
    } finally {
      setBidConfirmLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="container-sm">
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bot size={20} color="#52B788" />
            </div>
            <div>
              <h1 style={{ fontSize: 24, marginBottom: 0 }}>AI Buying Assistant</h1>
              <p style={{ fontSize: 14, margin: 0 }}>Powered by rule-based intent matching · searches real listings only</p>
            </div>
          </div>
        </div>

        {/* Suggestions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              className="filter-chip"
              onClick={() => sendMessage(s)}
              style={{ fontSize: 12 }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Chat window */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="chat-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`chat-bubble ${msg.role}`}>
                {msg.role === 'assistant' && (
                  <div style={{ fontSize: 11, color: 'var(--color-navy-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Sparkles size={11} color="var(--color-green)" /> Campus FairBid Assistant
                  </div>
                )}
                <div className="chat-bubble-inner" style={{ whiteSpace: 'pre-line' }}>
                  {msg.content}
                </div>
                {msg.results && msg.results.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    {msg.results.map((item, j) => (
                      <ResultCard key={j} item={item} onBid={handleBidClick} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="chat-bubble assistant">
                <div className="chat-bubble-inner" style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--color-navy-muted)' }}>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  Searching campus listings...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-row">
            <input
              className="form-input"
              placeholder='Try: "Find me a cycle under ₹2,000 closing today"'
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              disabled={loading}
            />
            <button className="btn btn-primary" onClick={() => sendMessage()} disabled={loading || !input.trim()}>
              <Send size={16} />
            </button>
          </div>
        </div>

        {/* Bid Confirmation Modal */}
        {pendingBid && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(26,31,54,0.6)', zIndex: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}>
            <div className="card card-body" style={{ maxWidth: 400, width: '100%' }}>
              <h3 style={{ marginBottom: 8 }}>Confirm Your Bid</h3>
              <p style={{ marginBottom: 16, fontSize: 14 }}>
                You're about to bid <strong>₹{parseFloat(pendingBid.suggestedBid).toLocaleString('en-IN')}</strong> on:
              </p>
              <div style={{ padding: 12, background: 'var(--color-surface-2)', borderRadius: 8, marginBottom: 16, fontSize: 14, fontWeight: 600 }}>
                {pendingBid.listing.title}
              </div>
              <div className="alert alert-warning mb-4" style={{ fontSize: 13 }}>
                ⚠️ This action cannot be undone. Bids are binding. The seller must approve the final price.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPendingBid(null)}>
                  Cancel
                </button>
                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={confirmBid} disabled={bidConfirmLoading}>
                  {bidConfirmLoading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : '✓ Confirm Bid'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div style={{ fontSize: 12, color: 'var(--color-navy-muted)', textAlign: 'center', lineHeight: 1.5 }}>
          🤖 This assistant uses rule-based intent matching to search real database records.
          It never invents listings or prices. All bids require explicit confirmation.
          {!import.meta.env?.VITE_OPENAI_KEY && ' (Running in offline mode — no external AI API)'}
        </div>
      </div>
    </div>
  );
}
