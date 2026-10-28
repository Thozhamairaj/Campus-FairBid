import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { formatDistanceToNow, differenceInSeconds } from 'date-fns';

export function CountdownTimer({ closingAt, onExpired, compact = false }) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, differenceInSeconds(new Date(closingAt), new Date()))
  );

  useEffect(() => {
    setSecondsLeft(Math.max(0, differenceInSeconds(new Date(closingAt), new Date())));

    const interval = setInterval(() => {
      const secs = Math.max(0, differenceInSeconds(new Date(closingAt), new Date()));
      setSecondsLeft(secs);
      if (secs === 0) {
        clearInterval(interval);
        onExpired?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [closingAt]);

  const isUrgent = secondsLeft <= 60;
  const isVeryUrgent = secondsLeft <= 10;

  if (secondsLeft === 0) {
    return <span style={{ color: 'var(--color-navy-muted)', fontSize: compact ? 12 : 14 }}>Closed</span>;
  }

  function formatTime(secs) {
    if (secs >= 86400) {
      const days = Math.floor(secs / 86400);
      const hours = Math.floor((secs % 86400) / 3600);
      return `${days}d ${hours}h`;
    }
    if (secs >= 3600) {
      const hours = Math.floor(secs / 3600);
      const mins = Math.floor((secs % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${String(s).padStart(2, '0')}`;
  }

  return (
    <span
      className={`countdown${isUrgent ? ' countdown-urgent' : ''}`}
      style={{
        fontSize: compact ? 12 : 14,
        fontWeight: 600,
        color: isVeryUrgent ? 'var(--color-red)' : isUrgent ? 'var(--color-amber)' : 'var(--color-navy-muted)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <Clock size={compact ? 12 : 14} />
      {formatTime(secondsLeft)}
    </span>
  );
}

export function FormatINR({ amount }) {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return <span>₹{num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
}
