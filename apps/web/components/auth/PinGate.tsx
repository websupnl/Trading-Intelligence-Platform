'use client';
import { useState, useEffect } from 'react';
import { setPin } from '@/lib/api';

export function PinGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [pin, setInputPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if already authenticated (PIN in sessionStorage)
    const stored = sessionStorage.getItem('dashboard_pin');
    if (stored) {
      setAuthenticated(true);
    } else {
      // If no DASHBOARD_PIN env set, skip auth
      fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/health`)
        .then(r => {
          if (r.status === 401) setAuthenticated(false);
          else setAuthenticated(true); // No PIN required
        })
        .catch(() => setAuthenticated(true));
    }

    // Listen for PIN_REQUIRED events
    const handler = () => setAuthenticated(false);
    window.addEventListener('pin_required', handler);
    return () => window.removeEventListener('pin_required', handler);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/settings`,
        { headers: { 'X-Dashboard-Pin': pin, 'Content-Type': 'application/json' } }
      );
      if (res.status === 401) {
        setError('Verkeerde PIN. Probeer opnieuw.');
      } else {
        setPin(pin);
        setAuthenticated(true);
      }
    } catch {
      setError('Verbinding mislukt.');
    } finally {
      setLoading(false);
    }
  }

  if (authenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-4 h-4 rounded-full bg-primary animate-pulse" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-xs">
          <div className="text-center mb-8">
            <div className="text-2xl font-bold tracking-widest mb-1">TRADING OS</div>
            <p className="text-sm text-muted-foreground">Voer PIN in om toegang te krijgen</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              inputMode="numeric"
              maxLength={10}
              value={pin}
              onChange={e => setInputPin(e.target.value)}
              placeholder="••••••"
              className="w-full h-12 px-4 text-center text-xl tracking-widest rounded-lg bg-card border border-border text-foreground focus:outline-none focus:border-primary"
              autoFocus
            />
            {error && (
              <p className="text-sm text-red-400 text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !pin}
              className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium text-sm disabled:opacity-50 transition-opacity"
            >
              {loading ? 'Controleren...' : 'Inloggen'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
