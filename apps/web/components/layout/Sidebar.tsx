'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, TrendingUp, Zap, Dice5, Rss,
  Brain, MonitorPlay, Settings, LogOut,
} from 'lucide-react';
import { api, clearPin } from '@/lib/api';
import { useApi } from '@/hooks/useApi';

const nav = [
  { href: '/',          label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/posities',  label: 'Posities',     icon: TrendingUp },
  { href: '/signals',   label: 'Signalen',     icon: Zap },
  { href: '/gok',       label: 'Gok',          icon: Dice5 },
  { href: '/feed',      label: 'Feed',         icon: Rss },
  { href: '/ai',        label: 'AI Brein',     icon: Brain },
  { href: '/live',      label: 'Live',         icon: MonitorPlay },
  { href: '/settings',  label: 'Instellingen', icon: Settings },
];

const mobileNav = [
  { href: '/',         label: 'Home',     icon: LayoutDashboard },
  { href: '/posities', label: 'Posities', icon: TrendingUp },
  { href: '/signals',  label: 'Signalen', icon: Zap },
  { href: '/gok',      label: 'Gok',      icon: Dice5 },
  { href: '/feed',     label: 'Feed',     icon: Rss },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: status } = useApi(() => api.apiStatus(), []);
  const { data: botHealth } = useApi(() => api.getBotHealth(), []);

  const aiPaused = !!(botHealth as any)?.ai_guard?.paused;
  const killSwitch = !!(status as any)?.kill_switch_enabled;
  const marketSession = (status as any)?.market_session || (botHealth as any)?.market_session;
  const cryptoOnly = marketSession?.crypto_only;
  const blockers: string[] = (botHealth as any)?.blockers ?? [];
  const botActive = !killSwitch && !aiPaused && blockers.length === 0;

  function handleLogout() {
    clearPin();
    window.location.reload();
  }

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-52 shrink-0 bg-card border-r border-border flex-col min-h-screen">
        {/* Brand + status */}
        <div className="px-4 py-5 border-b border-border">
          <p className="text-[11px] font-bold tracking-[0.2em] text-foreground/50 uppercase mb-4">Trading OS</p>
          <div className="space-y-1.5">
            <Row label="Bot" value={botActive ? 'Actief' : killSwitch ? 'Kill switch' : 'Gepauzeerd'} ok={botActive} bad={killSwitch} />
            <Row label="Markt" value={cryptoOnly ? 'Crypto only' : 'Open'} ok={!cryptoOnly} />
            <Row label="AI" value={aiPaused ? 'Gepauzeerd' : 'Actief'} ok={!aiPaused} />
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors',
                  active
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                )}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border">
          <button onClick={handleLogout} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <LogOut size={12} />
            Uitloggen
          </button>
          <p className="text-[10px] text-muted-foreground mt-1.5">v1.2.0</p>
        </div>
      </aside>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex z-50">
        {mobileNav.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon size={18} />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function Row({ label, value, ok, bad }: { label: string; value: string; ok: boolean; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-semibold',
        bad ? 'text-red-400' : ok ? 'text-green-400' : 'text-amber-400')}>
        {value}
      </span>
    </div>
  );
}
