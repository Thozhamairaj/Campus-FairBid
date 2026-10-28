import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Search, Bell, Plus, User, LogOut, LayoutDashboard, Heart, BookMarked, Bot, Gavel } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import socket from '../lib/socket';

export default function Navbar({ onSearch, searchValue }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchInput, setSearchInput] = useState(searchValue || '');
  const menuRef = useRef(null);
  const notifRef = useRef(null);

  useEffect(() => {
    if (user) fetchNotifications();
  }, [user]);

  useEffect(() => {
    // Real-time notifications
    const handler = ({ notification }) => {
      setNotifications(prev => [notification, ...prev].slice(0, 50));
      setUnreadCount(c => c + 1);
    };
    socket.on('notification:new', handler);
    return () => socket.off('notification:new', handler);
  }, []);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setUserMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function fetchNotifications() {
    try {
      const { data } = await api.get('/notifications?limit=10');
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {}
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all');
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch {}
  }

  function handleSearch(e) {
    e.preventDefault();
    if (onSearch) onSearch(searchInput);
    else navigate(`/?search=${encodeURIComponent(searchInput)}`);
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-logo">
          <Gavel size={22} color="var(--color-green)" />
          Campus<span>FairBid</span>
        </Link>

        <form className="navbar-search" onSubmit={handleSearch}>
          <Search className="navbar-search-icon" size={16} />
          <input
            type="text"
            placeholder="Search bicycles, calculators, books..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            aria-label="Search listings"
          />
        </form>

        <div className="navbar-actions">
          <Link
            to="/"
            className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
          >
            Browse
          </Link>

          {user ? (
            <>
              <Link to="/create" className="btn btn-primary btn-sm" style={{ gap: 6 }}>
                <Plus size={16} /> List Item
              </Link>

              {/* Notifications */}
              <div className="dropdown notif-trigger" ref={notifRef}>
                <button
                  className="btn btn-secondary btn-icon"
                  onClick={() => { setNotifOpen(o => !o); if (!notifOpen) markAllRead(); }}
                  aria-label="Notifications"
                >
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                  )}
                </button>
                {notifOpen && (
                  <div className="dropdown-menu" style={{ width: 320 }}>
                    <div style={{ padding: '12px 16px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>
                      Notifications
                    </div>
                    {notifications.length === 0 ? (
                      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-navy-muted)', fontSize: 14 }}>
                        No notifications yet
                      </div>
                    ) : (
                      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                        {notifications.map((n, i) => (
                          <div
                            key={i}
                            className="dropdown-item"
                            style={{ flexDirection: 'column', alignItems: 'flex-start', opacity: n.isRead ? 0.6 : 1 }}
                            onClick={() => { if (n.listingId) navigate(`/listing/${n.listingId}`); setNotifOpen(false); }}
                          >
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</span>
                            <span style={{ fontSize: 12, color: 'var(--color-navy-muted)', marginTop: 2 }}>{n.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* User Menu */}
              <div className="dropdown" ref={menuRef}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setUserMenuOpen(o => !o)}
                  style={{ gap: 6 }}
                >
                  <User size={16} />
                  {user.name.split(' ')[0]}
                </button>
                {userMenuOpen && (
                  <div className="dropdown-menu">
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
                      <div style={{ fontWeight: 700 }}>{user.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-navy-muted)' }}>{user.email}</div>
                    </div>
                    <Link to="/dashboard" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                      <LayoutDashboard size={16} /> My Listings
                    </Link>
                    <Link to="/my-bids" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                      <Gavel size={16} /> My Bids
                    </Link>
                    <Link to="/watchlist" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                      <Heart size={16} /> Watchlist
                    </Link>
                    <Link to="/saved-searches" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                      <BookMarked size={16} /> Saved Searches
                    </Link>
                    <Link to="/assistant" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                      <Bot size={16} /> AI Assistant
                    </Link>
                    <div className="dropdown-divider" />
                    <button className="dropdown-item danger" onClick={() => { logout(); setUserMenuOpen(false); navigate('/'); }}>
                      <LogOut size={16} /> Sign Out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-secondary btn-sm">Sign In</Link>
              <Link to="/register" className="btn btn-primary btn-sm">Join Free</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
