import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookMarked, Plus, Trash2, Search } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';

const CATEGORIES = { BICYCLE: '🚲 Bicycle', CALCULATOR: '🔢 Calculator', BOOKS: '📚 Books', ELECTRONICS: '⚡ Electronics', HOSTEL_ESSENTIALS: '🏠 Hostel Essentials', OTHER: '📦 Other' };
const CONDITIONS = { NEW: 'New', LIKE_NEW: 'Like New', GOOD: 'Good', FAIR: 'Fair', POOR: 'Poor' };

export default function SavedSearchesPage() {
  const toast = useToast();
  const [searches, setSearches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', keywords: '', category: '', maxPrice: '', condition: '', closingSoon: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchSearches(); }, []);

  async function fetchSearches() {
    try {
      const { data } = await api.get('/saved-searches');
      setSearches(data.searches);
    } catch { toast.error('Failed to load saved searches'); }
    finally { setLoading(false); }
  }

  async function saveSearch(e) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Please give this search a name'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        keywords: form.keywords || undefined,
        category: form.category || undefined,
        maxPrice: form.maxPrice ? parseFloat(form.maxPrice) : undefined,
        condition: form.condition || undefined,
        closingSoon: form.closingSoon,
      };
      const { data } = await api.post('/saved-searches', payload);
      setSearches(prev => [data.search, ...prev]);
      setShowForm(false);
      setForm({ name: '', keywords: '', category: '', maxPrice: '', condition: '', closingSoon: false });
      toast.success('Saved search created! You\'ll be notified when matching items appear.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  }

  async function deleteSearch(id) {
    try {
      await api.delete(`/saved-searches/${id}`);
      setSearches(prev => prev.filter(s => s.id !== id));
      toast.info('Saved search deleted');
    } catch { toast.error('Failed to delete'); }
  }

  if (loading) return <div className="page container"><div className="loading-center"><div className="spinner" /></div></div>;

  return (
    <div className="page">
      <div className="container-sm">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>Saved Searches</h1>
            <p>Get notified when new listings match your criteria</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm(s => !s)}>
            <Plus size={16} /> New Search
          </button>
        </div>

        {/* Create Form */}
        {showForm && (
          <div className="card card-body mb-6">
            <h3 style={{ marginBottom: 16 }}>Create Saved Search</h3>
            <form onSubmit={saveSearch}>
              <div className="form-group mb-4">
                <label className="form-label">Search Name <span className="required">*</span></label>
                <input className="form-input" placeholder='e.g. "Cheap scientific calculator"'
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} maxLength={100} />
              </div>
              <div className="form-group mb-4">
                <label className="form-label">Keywords</label>
                <input className="form-input" placeholder="atlas, casio, grewal..."
                  value={form.keywords} onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))} maxLength={100} />
              </div>
              <div className="form-grid mb-4">
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select className="form-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    <option value="">Any category</option>
                    {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Max Price (₹)</label>
                  <input type="number" className="form-input" placeholder="500"
                    value={form.maxPrice} onChange={e => setForm(f => ({ ...f, maxPrice: e.target.value }))} min={0} />
                </div>
              </div>
              <div className="form-grid mb-4">
                <div className="form-group">
                  <label className="form-label">Condition</label>
                  <select className="form-select" value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                    <option value="">Any condition</option>
                    {Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                    <input type="checkbox" checked={form.closingSoon} onChange={e => setForm(f => ({ ...f, closingSoon: e.target.checked }))} />
                    Only closing within 24h
                  </label>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Search'}
                </button>
              </div>
            </form>
          </div>
        )}

        {searches.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><BookMarked size={48} /></div>
            <h3>No saved searches yet</h3>
            <p>Create a search to get notified when matching items are listed</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {searches.map(s => (
              <div key={s.id} className="card card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{s.name}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {s.category && <span className="badge badge-gray">{CATEGORIES[s.category]}</span>}
                    {s.condition && <span className="badge badge-amber">{CONDITIONS[s.condition]}</span>}
                    {s.maxPrice && <span className="badge badge-green">Max ₹{parseFloat(s.maxPrice).toLocaleString('en-IN')}</span>}
                    {s.keywords && <span className="badge badge-blue">"{s.keywords}"</span>}
                    {s.closingSoon && <span className="badge badge-red">Closing soon</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Link
                    to={`/?search=${encodeURIComponent(s.keywords || s.name)}`}
                    className="btn btn-secondary btn-sm"
                    style={{ gap: 6 }}
                  >
                    <Search size={14} /> View Listings
                  </Link>
                  <button className="btn btn-secondary btn-icon" onClick={() => deleteSearch(s.id)} aria-label="Delete saved search">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
