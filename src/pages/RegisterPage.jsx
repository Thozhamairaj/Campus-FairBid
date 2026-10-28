import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Gavel } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState({ name: '', email: '', password: '', college: 'IIT Campus', hostel: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function setField(f, v) { setForm(prev => ({ ...prev, [f]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    const result = await register(form.name, form.email, form.password, form.college, form.hostel);
    setLoading(false);
    if (result.success) {
      toast.success(`Welcome to Campus FairBid, ${result.user.name.split(' ')[0]}!`);
      navigate('/');
    } else {
      setError(result.error);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Gavel size={28} color="var(--color-green)" />
            <span style={{ fontSize: 24, fontWeight: 800 }}>
              Campus<span style={{ color: 'var(--color-green)' }}>FairBid</span>
            </span>
          </div>
          <p style={{ color: 'var(--color-navy-muted)', fontSize: 14 }}>Join thousands of students buying and selling fairly.</p>
        </div>

        <div className="card card-body">
          <h2 style={{ marginBottom: 24, fontSize: 22 }}>Create your account</h2>

          {error && <div className="alert alert-error mb-4">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group mb-4">
              <label className="form-label" htmlFor="name">Full Name <span className="required">*</span></label>
              <input id="name" type="text" className="form-input" placeholder="Arjun Kumar"
                value={form.name} onChange={e => setField('name', e.target.value)} required minLength={2} maxLength={100} />
            </div>
            <div className="form-group mb-4">
              <label className="form-label" htmlFor="reg-email">College Email <span className="required">*</span></label>
              <input id="reg-email" type="email" className="form-input" placeholder="you@campus.edu"
                value={form.email} onChange={e => setField('email', e.target.value)} required autoComplete="email" />
            </div>
            <div className="form-group mb-4">
              <label className="form-label" htmlFor="reg-password">Password <span className="required">*</span></label>
              <input id="reg-password" type="password" className="form-input" placeholder="At least 6 characters"
                value={form.password} onChange={e => setField('password', e.target.value)} required minLength={6} autoComplete="new-password" />
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="college">College / Institute</label>
                <input id="college" type="text" className="form-input" placeholder="IIT Campus"
                  value={form.college} onChange={e => setField('college', e.target.value)} maxLength={100} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="hostel">Hostel (optional)</label>
                <input id="hostel" type="text" className="form-input" placeholder="Ganga Hostel"
                  value={form.hostel} onChange={e => setField('hostel', e.target.value)} maxLength={100} />
              </div>
            </div>
            <button className="btn btn-primary w-full mt-6" type="submit" disabled={loading} style={{ justifyContent: 'center', padding: '12px' }}>
              {loading ? <><span className="spinner" style={{ width: 16, height: 16, borderTopColor: 'white' }} /> Creating Account...</> : 'Create Account'}
            </button>
          </form>

          <div style={{ marginTop: 20, textAlign: 'center', fontSize: 14, color: 'var(--color-navy-muted)' }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: 'var(--color-green)', fontWeight: 600 }}>Sign in</Link>
          </div>

          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--color-navy-muted)', textAlign: 'center', lineHeight: 1.5 }}>
            🔒 Demo mode: authentication is functional but not email-verified. Do not use real sensitive passwords.
          </div>
        </div>
      </div>
    </div>
  );
}
