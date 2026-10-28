import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ListingDetailPage from './pages/ListingDetailPage';
import CreateListingPage from './pages/CreateListingPage';
import DashboardPage from './pages/DashboardPage';
import MyBidsPage from './pages/MyBidsPage';
import WatchlistPage from './pages/WatchlistPage';
import SavedSearchesPage from './pages/SavedSearchesPage';
import AIAssistantPage from './pages/AIAssistantPage';
import './index.css';

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function HomeWrapper() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('search') || '';
  const closingSoon = searchParams.get('closingSoon') === 'true';

  function handleSearch(q) {
    if (q) navigate(`/?search=${encodeURIComponent(q)}`);
    else navigate('/');
  }

  return (
    <>
      <Navbar onSearch={handleSearch} searchValue={query} />
      <HomePage searchQuery={query} closingSoonOnly={closingSoon} />
    </>
  );
}

function AppLayout({ children, hideNavSearch }) {
  const navigate = useNavigate();
  return (
    <>
      <Navbar onSearch={q => navigate(`/?search=${encodeURIComponent(q)}`)} />
      {children}
    </>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeWrapper />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/listing/:id" element={
        <AppLayout>
          <ListingDetailPage />
        </AppLayout>
      } />
      <Route path="/create" element={
        <AppLayout>
          <ProtectedRoute><CreateListingPage /></ProtectedRoute>
        </AppLayout>
      } />
      <Route path="/edit/:id" element={
        <AppLayout>
          <ProtectedRoute><CreateListingPage /></ProtectedRoute>
        </AppLayout>
      } />
      <Route path="/dashboard" element={
        <AppLayout>
          <ProtectedRoute><DashboardPage /></ProtectedRoute>
        </AppLayout>
      } />
      <Route path="/my-bids" element={
        <AppLayout>
          <ProtectedRoute><MyBidsPage /></ProtectedRoute>
        </AppLayout>
      } />
      <Route path="/watchlist" element={
        <AppLayout>
          <ProtectedRoute><WatchlistPage /></ProtectedRoute>
        </AppLayout>
      } />
      <Route path="/saved-searches" element={
        <AppLayout>
          <ProtectedRoute><SavedSearchesPage /></ProtectedRoute>
        </AppLayout>
      } />
      <Route path="/assistant" element={
        <AppLayout>
          <AIAssistantPage />
        </AppLayout>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
