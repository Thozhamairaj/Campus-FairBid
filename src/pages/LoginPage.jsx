import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Gavel } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const from = location.state?.from || '/';

  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(form.email, form.password);
    setLoading(false);
    if (result.success) {
      toast.success(`Welcome back, ${result.user.name.split(' ')[0]}!`);
      navigate(from, { replace: true });
    } else {
      setError(result.error);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Gavel size={28} color="var(--color-green)" />
            <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-navy)' }}>
              Campus<span style={{ color: 'var(--color-green)' }}>FairBid</span>
            </span>
          </div>
          <p style={{ color: 'var(--color-navy-muted)', fontSize: 14 }}>Every item deserves a fair next owner.</p>
        </div>

        <div className="card card-body">
          <h2 style={{ marginBottom: 24, fontSize: 22 }}>Sign in to your account</h2>

          {error && (
            <div className="alert alert-error mb-4">{error}</div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group mb-4">
              <label className="form-label" htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                className="form-input"
                placeholder="arjun@campus.edu"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
                autoComplete="email"
              />
            </div>
            <div className="form-group mb-6">
              <label className="form-label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                autoComplete="current-password"
              />
            </div>
            <button className="btn btn-primary w-full" type="submit" disabled={loading} style={{ justifyContent: 'center', padding: '12px' }}>
              {loading ? <><span className="spinner" style={{ width: 16, height: 16, borderTopColor: 'white' }} /> Signing in...</> : 'Sign In'}
            </button>
          </form>

          <div style={{ marginTop: 20, textAlign: 'center', fontSize: 14, color: 'var(--color-navy-muted)' }}>
            Don't have an account?{' '}
            <Link to="/register" style={{ color: 'var(--color-green)', fontWeight: 600 }}>Join free</Link>
          </div>

          {/* Demo credentials */}
          <div style={{ marginTop: 20, padding: 12, background: 'var(--color-surface-2)', borderRadius: 8, fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--color-navy)' }}>🎓 Demo Accounts</div>
            {[
              { email: 'arjun@campus.edu', note: 'Seller: Bicycle' },
              { email: 'priya@campus.edu', note: 'Seller: Calculator' },
              { email: 'rahul@campus.edu', note: 'Buyer / Seller' },
            ].map(d => (
              <div key={d.email} style={{ marginBottom: 4 }}>
                <button
                  type="button"
                  style={{ color: 'var(--color-blue)', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12 }}
                  onClick={() => setForm({ email: d.email, password: 'password123' })}
                >
                  {d.email}
                </button>
                <span style={{ color: 'var(--color-navy-muted)' }}> — {d.note} · pw: password123</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
