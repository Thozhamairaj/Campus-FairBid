import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookMarked, Plus, Trash2, Search, Edit2, Bell, BellOff, Check, X } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';

const CATEGORIES = {
  BICYCLE: '🚲 Bicycle',
  CALCULATOR: '🔢 Calculator',
  BOOKS: '📚 Books',
  ELECTRONICS: '⚡ Electronics',
  HOSTEL_ESSENTIALS: '🏠 Hostel Essentials',
  OTHER: '📦 Other',
};

const CONDITIONS = {
  NEW: 'New',
  LIKE_NEW: 'Like New',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
};

export default function SavedSearchesPage() {
  const toast = useToast();
  const [searches, setSearches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: '',
    keywords: '',
    category: '',
    maxPrice: '',
    condition: '',
    closingSoon: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSearches();
  }, []);

  async function fetchSearches() {
    try {
      const { data } = await api.get('/saved-searches');
      setSearches(data.searches);
    } catch {
      toast.error('Failed to load saved searches');
    } finally {
      setLoading(false);
    }
  }

  function startEdit(s) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      keywords: s.keywords || '',
      category: s.category || '',
      maxPrice: s.maxPrice ? parseFloat(s.maxPrice).toString() : '',
      condition: s.condition || '',
      closingSoon: Boolean(s.closingSoon),
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ name: '', keywords: '', category: '', maxPrice: '', condition: '', closingSoon: false });
  }

  async function saveSearch(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Please give this search a name');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        keywords: form.keywords?.trim() || undefined,
        category: form.category || undefined,
        maxPrice: form.maxPrice ? parseFloat(form.maxPrice) : undefined,
        condition: form.condition || undefined,
        closingSoon: form.closingSoon,
      };

      if (editingId) {
        const { data } = await api.put(`/saved-searches/${editingId}`, payload);
        setSearches(prev => prev.map(s => s.id === editingId ? data.search : s));
        toast.success('Saved search updated!');
      } else {
        const { data } = await api.post('/saved-searches', payload);
        if (data.alreadySaved) {
          toast.info('Search already exists in your saved searches.');
        } else {
          setSearches(prev => [data.search, ...prev]);
          toast.success("Saved search created! You'll be notified when matching items appear.");
        }
      }
      cancelForm();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleSearch(id) {
    try {
      const { data } = await api.patch(`/saved-searches/${id}/toggle`);
      setSearches(prev => prev.map(s => s.id === id ? data.search : s));
      toast.info(data.search.isActive ? 'Notifications enabled for this search' : 'Notifications paused for this search');
    } catch {
      toast.error('Failed to update alert setting');
    }
  }

  async function deleteSearch(id) {
    if (!window.confirm('Delete this saved search? You will no longer receive notifications for matching listings.')) return;
    try {
      await api.delete(`/saved-searches/${id}`);
      setSearches(prev => prev.filter(s => s.id !== id));
      toast.info('Saved search deleted');
    } catch {
      toast.error('Failed to delete');
    }
  }

  if (loading) {
    return (
      <div className="page container">
        <div className="loading-center">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container-sm">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>Saved Searches</h1>
            <p>Get notified when new listings match your criteria</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (showForm) cancelForm();
              else {
                setEditingId(null);
                setForm({ name: '', keywords: '', category: '', maxPrice: '', condition: '', closingSoon: false });
                setShowForm(true);
              }
            }}
          >
            <Plus size={16} /> New Search
          </button>
        </div>

        {/* Create / Edit Form */}
        {showForm && (
          <div className="card card-body mb-6" style={{ border: '1.5px solid var(--color-green)' }}>
            <h3 style={{ marginBottom: 16 }}>
              {editingId ? 'Edit Saved Search' : 'Create Saved Search'}
            </h3>
            <form onSubmit={saveSearch}>
              <div className="form-group mb-4">
                <label className="form-label">Search Name <span className="required">*</span></label>
                <input
                  className="form-input"
                  placeholder='e.g. "Cheap scientific calculator"'
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  maxLength={100}
                />
              </div>
              <div className="form-group mb-4">
                <label className="form-label">Keywords</label>
                <input
                  className="form-input"
                  placeholder="atlas, casio, grewal, iphone..."
                  value={form.keywords}
                  onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))}
                  maxLength={100}
                />
              </div>
              <div className="form-grid mb-4">
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select
                    className="form-select"
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  >
                    <option value="">Any category</option>
                    {Object.entries(CATEGORIES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Max Price (₹)</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="500"
                    value={form.maxPrice}
                    onChange={e => setForm(f => ({ ...f, maxPrice: e.target.value }))}
                    min={0}
                  />
                </div>
              </div>
              <div className="form-grid mb-4">
                <div className="form-group">
                  <label className="form-label">Condition</label>
                  <select
                    className="form-select"
                    value={form.condition}
                    onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}
                  >
                    <option value="">Any condition</option>
                    {Object.entries(CONDITIONS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={form.closingSoon}
                      onChange={e => setForm(f => ({ ...f, closingSoon: e.target.checked }))}
                    />
                    Only closing within 24h
                  </label>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={cancelForm}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update Search' : 'Save Search'}
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
              <div
                key={s.id}
                className="card card-body"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                  opacity: s.isActive === false ? 0.65 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 16 }}>{s.name}</span>
                    <span className={`badge ${s.isActive === false ? 'badge-gray' : 'badge-green'}`}>
                      {s.isActive === false ? '🔕 Paused' : '🔔 Active'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {s.category && <span className="badge badge-gray">{CATEGORIES[s.category]}</span>}
                    {s.condition && <span className="badge badge-amber">{CONDITIONS[s.condition]}</span>}
                    {s.maxPrice && <span className="badge badge-green">Max ₹{parseFloat(s.maxPrice).toLocaleString('en-IN')}</span>}
                    {s.keywords && <span className="badge badge-blue">"{s.keywords}"</span>}
                    {s.closingSoon && <span className="badge badge-red">Closing soon</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => toggleSearch(s.id)}
                    title={s.isActive === false ? 'Enable notifications' : 'Pause notifications'}
                    style={{ gap: 6 }}
                  >
                    {s.isActive === false ? <Bell size={14} /> : <BellOff size={14} />}
                    {s.isActive === false ? 'Enable Alerts' : 'Pause Alerts'}
                  </button>

                  <Link
                    to={`/?search=${encodeURIComponent(s.keywords || s.name)}`}
                    className="btn btn-secondary btn-sm"
                    style={{ gap: 6 }}
                  >
                    <Search size={14} /> View Listings
                  </Link>

                  <button
                    className="btn btn-secondary btn-icon"
                    onClick={() => startEdit(s)}
                    title="Edit saved search"
                    aria-label="Edit saved search"
                  >
                    <Edit2 size={15} />
                  </button>

                  <button
                    className="btn btn-secondary btn-icon"
                    onClick={() => deleteSearch(s.id)}
                    title="Delete saved search"
                    aria-label="Delete saved search"
                    style={{ color: 'var(--color-red)' }}
                  >
                    <Trash2 size={15} />
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
