import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Upload, X, Plus } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const CATEGORIES = [
  { value: 'BICYCLE', label: '🚲 Bicycle' },
  { value: 'CALCULATOR', label: '🔢 Calculator' },
  { value: 'BOOKS', label: '📚 Books' },
  { value: 'ELECTRONICS', label: '⚡ Electronics' },
  { value: 'HOSTEL_ESSENTIALS', label: '🏠 Hostel Essentials' },
  { value: 'OTHER', label: '📦 Other' },
];

const CONDITIONS = [
  { value: 'NEW', label: 'New', desc: 'Unopened, never used' },
  { value: 'LIKE_NEW', label: 'Like New', desc: 'Used once or twice, no marks' },
  { value: 'GOOD', label: 'Good', desc: 'Normal wear, fully functional' },
  { value: 'FAIR', label: 'Fair', desc: 'Visible use, works fine' },
  { value: 'POOR', label: 'Poor', desc: 'Heavy use or minor damage' },
];

// Default closing time: 48 hours from now
function defaultClosingAt() {
  const d = new Date(Date.now() + 48 * 60 * 60 * 1000);
  // Format for datetime-local input (no seconds)
  return d.toISOString().slice(0, 16);
}

export default function CreateListingPage() {
  const { id } = useParams(); // defined if editing
  const isEditing = !!id;
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'OTHER',
    condition: 'GOOD',
    startingPrice: '',
    minIncrement: '50',
    closingAt: defaultClosingAt(),
    imageUrls: [''],
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadingListing, setLoadingListing] = useState(isEditing);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    if (isEditing) {
      api.get(`/listings/${id}`).then(({ data }) => {
        const l = data.listing;
        setForm({
          title: l.title,
          description: l.description,
          category: l.category,
          condition: l.condition,
          startingPrice: l.startingPrice,
          minIncrement: l.minIncrement,
          closingAt: new Date(l.closingAt).toISOString().slice(0, 16),
          imageUrls: l.images?.map(i => i.url) || [''],
        });
      }).catch(() => toast.error('Failed to load listing')).finally(() => setLoadingListing(false));
    }
  }, [id, user]);

  function setField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  }

  function setImageUrl(index, value) {
    setForm(prev => {
      const urls = [...prev.imageUrls];
      urls[index] = value;
      return { ...prev, imageUrls: urls };
    });
  }

  function addImage() {
    if (form.imageUrls.length < 5) {
      setForm(prev => ({ ...prev, imageUrls: [...prev.imageUrls, ''] }));
    }
  }

  function removeImage(index) {
    setForm(prev => ({ ...prev, imageUrls: prev.imageUrls.filter((_, i) => i !== index) }));
  }

  function validate() {
    const errs = {};
    if (!form.title.trim() || form.title.length < 3) errs.title = 'Title must be at least 3 characters';
    if (!form.description.trim() || form.description.length < 10) errs.description = 'Description must be at least 10 characters';
    if (!form.startingPrice || parseFloat(form.startingPrice) <= 0) errs.startingPrice = 'Starting price must be positive';
    if (!form.minIncrement || parseFloat(form.minIncrement) <= 0) errs.minIncrement = 'Minimum increment must be positive';
    if (!form.closingAt || new Date(form.closingAt) <= new Date()) errs.closingAt = 'Closing time must be in the future';
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setLoading(true);
    const validImageUrls = form.imageUrls.filter(u => u.trim() && u.startsWith('http'));

    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        condition: form.condition,
        startingPrice: parseFloat(form.startingPrice),
        minIncrement: parseFloat(form.minIncrement),
        closingAt: new Date(form.closingAt).toISOString(),
        imageUrls: validImageUrls,
      };

      let listing;
      if (isEditing) {
        const { data } = await api.put(`/listings/${id}`, payload);
        listing = data.listing;
        toast.success('Listing updated successfully!');
      } else {
        const { data } = await api.post('/listings', payload);
        listing = data.listing;
        toast.success('Listing created! Your auction is now live.');
      }
      navigate(`/listing/${listing.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save listing');
    } finally {
      setLoading(false);
    }
  }

  if (loadingListing) {
    return <div className="page container"><div className="loading-center"><div className="spinner" /></div></div>;
  }

  return (
    <div className="page">
      <div className="container-sm">
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ marginBottom: 8 }}>{isEditing ? 'Edit Listing' : 'Create a Listing'}</h1>
          <p>{isEditing ? 'Update your listing details.' : 'List your item for auction. Students across campus can bid fairly.'}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="card card-body" style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 20 }}>Item Details</h3>

            <div className="form-group mb-4">
              <label className="form-label" htmlFor="title">Title <span className="required">*</span></label>
              <input
                id="title"
                type="text"
                className={`form-input ${errors.title ? 'error' : ''}`}
                placeholder="e.g. Atlas Bicycle — 3 years old, well maintained"
                value={form.title}
                onChange={e => setField('title', e.target.value)}
                maxLength={200}
              />
              {errors.title && <span className="form-error">{errors.title}</span>}
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="category">Category <span className="required">*</span></label>
                <select id="category" className="form-select" value={form.category} onChange={e => setField('category', e.target.value)}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="condition">Condition <span className="required">*</span></label>
                <select id="condition" className="form-select" value={form.condition} onChange={e => setField('condition', e.target.value)}>
                  {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label} — {c.desc}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group mt-4">
              <label className="form-label" htmlFor="description">Description <span className="required">*</span></label>
              <textarea
                id="description"
                className={`form-textarea ${errors.description ? 'error' : ''}`}
                placeholder="Describe your item in detail: age, usage, any defects, what's included, reason for selling..."
                value={form.description}
                onChange={e => setField('description', e.target.value)}
                style={{ minHeight: 140 }}
                maxLength={5000}
              />
              {errors.description && <span className="form-error">{errors.description}</span>}
              <span className="form-hint">{form.description.length}/5000 characters</span>
            </div>
          </div>

          <div className="card card-body" style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 20 }}>Pricing & Auction</h3>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="startingPrice">Starting Price (₹) <span className="required">*</span></label>
                <input
                  id="startingPrice"
                  type="number"
                  className={`form-input ${errors.startingPrice ? 'error' : ''}`}
                  placeholder="500"
                  value={form.startingPrice}
                  onChange={e => setField('startingPrice', e.target.value)}
                  min={1}
                  max={1000000}
                />
                {errors.startingPrice && <span className="form-error">{errors.startingPrice}</span>}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="minIncrement">Min. Bid Increment (₹) <span className="required">*</span></label>
                <input
                  id="minIncrement"
                  type="number"
                  className={`form-input ${errors.minIncrement ? 'error' : ''}`}
                  placeholder="50"
                  value={form.minIncrement}
                  onChange={e => setField('minIncrement', e.target.value)}
                  min={1}
                  max={10000}
                />
                {errors.minIncrement && <span className="form-error">{errors.minIncrement}</span>}
                <span className="form-hint">Each bid must exceed current by this amount</span>
              </div>
            </div>

            <div className="form-group mt-4">
              <label className="form-label" htmlFor="closingAt">Auction Closing Date & Time <span className="required">*</span></label>
              <input
                id="closingAt"
                type="datetime-local"
                className={`form-input ${errors.closingAt ? 'error' : ''}`}
                value={form.closingAt}
                onChange={e => setField('closingAt', e.target.value)}
                min={new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)}
              />
              {errors.closingAt && <span className="form-error">{errors.closingAt}</span>}
              <span className="form-hint">⚡ Anti-sniping: if a bid comes in the last 30 seconds, deadline auto-extends by 60 seconds</span>
            </div>
          </div>

          <div className="card card-body" style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 8 }}>Photos</h3>
            <p style={{ fontSize: 14, marginBottom: 16 }}>Add URLs for your item photos (Unsplash, Google Drive, etc.) — up to 5 images</p>

            {form.imageUrls.map((url, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  type="url"
                  className="form-input"
                  placeholder={`Image ${i + 1} URL (https://...)`}
                  value={url}
                  onChange={e => setImageUrl(i, e.target.value)}
                />
                {i > 0 && (
                  <button type="button" className="btn btn-secondary btn-icon" onClick={() => removeImage(i)}>
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
            {form.imageUrls.length < 5 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={addImage} style={{ width: 'fit-content' }}>
                <Plus size={14} /> Add Another Image
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
              {loading ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Saving...</> : (isEditing ? 'Update Listing' : 'Launch Auction')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
