'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, TrendingUp, Zap, Dice5, Rss,
  Brain, MonitorPlay, Settings, LogOut, MoreHorizontal, X, Activity,
} from 'lucide-react';
import { api, clearPin } from '@/lib/api';
import { useApi } from '@/hooks/useApi';

const nav = [
  { href: '/',          label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/posities',  label: 'Posities',     icon: TrendingUp },
  { href: '/signals',   label: 'Signalen',     icon: Zap },
  { href: '/gok',       label: 'Gok',          icon: Dice5 },
  { href: '/feed',      label: 'Feed',         icon: Rss },
  { href: '/regime',    label: 'Regime',       icon: Activity },
  { href: '/ai',        label: 'AI Brein',     icon: Brain },
  { href: '/live',      label: 'Live',         icon: MonitorPlay },
  { href: '/settings',  label: 'Instellingen', icon: Settings },
];

// Bottom nav: 5 primary + "Meer" button
const mobileNav = [
  { href: '/',         label: 'Home',     icon: LayoutDashboard },
  { href: '/posities', label: 'Posities', icon: TrendingUp },
  { href: '/signals',  label: 'Signalen', icon: Zap },
  { href: '/gok',      label: 'Gok',      icon: Dice5 },
  { href: '/feed',     label: 'Feed',     icon: Rss },
];

// Extra items in "Meer" drawer
const moreNav = [
  { href: '/regime',   label: 'Regime',       icon: Activity },
  { href: '/ai',       label: 'AI Brein',     icon: Brain },
  { href: '/live',     label: 'Live',         icon: MonitorPlay },
  { href: '/settings', label: 'Instellingen', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { data: status } = useApi(() => api.apiStatus(), []);
  const { data: botHealth } = useApi(() => api.getBotHealth(), []);

  const aiPaused = !!(botHealth as any)?.ai_guard?.paused;
  const killSwitch = !!(status as any)?.kill_switch_enabled;
  const marketSession = (status as any)?.market_session || (botHealth as any)?.market_session;
  const cryptoOnly = marketSession?.crypto_only;
  const blockers: string[] = (botHealth as any)?.blockers ?? [];
  const botActive = !killSwitch && !aiPaused && blockers.length === 0;

  // Is any "more" item active?
  const moreActive = moreNav.some(({ href }) => pathname.startsWith(href));

  function handleLogout() {
    clearPin();
    window.location.reload();
  }

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-52 shrink-0 bg-card border-r border-border flex-col min-h-screen">
        <div className="px-4 py-5 border-b border-border">
          <p className="text-[11px] font-bold tracking-[0.2em] text-foreground/50 uppercase mb-4">Trading OS</p>
          <div className="space-y-1.5">
            <Row label="Bot" value={botActive ? 'Actief' : killSwitch ? 'Kill switch' : 'Gepauzeerd'} ok={botActive} bad={killSwitch} />
            <Row label="Markt" value={cryptoOnly ? 'Crypto only' : 'Open'} ok={!cryptoOnly} />
            <Row label="AI" value={aiPaused ? 'Gepauzeerd' : 'Actief'} ok={!aiPaused} />
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link key={href} href={href}
                className={cn('flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors',
                  active ? 'bg-primary/10 text-primary font-semibold'
                         : 'text-muted-foreground hover:text-foreground hover:bg-accent/50')}>
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-border">
          <button onClick={handleLogout} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <LogOut size={12} />
            Uitloggen
          </button>
          <p className="text-[10px] text-muted-foreground mt-1.5">v1.2.0</p>
        </div>
      </aside>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border flex z-50 bottom-nav">
        {mobileNav.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link key={href} href={href}
              className={cn('flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors relative',
                active ? 'text-primary' : 'text-muted-foreground')}>
              {active && <span className="absolute top-1 w-1 h-1 rounded-full bg-primary" />}
              <Icon size={active ? 20 : 18} strokeWidth={active ? 2.5 : 1.8} />
              <span className={cn('text-[10px] font-medium', active && 'font-bold')}>{label}</span>
            </Link>
          );
        })}

        {/* Meer button */}
        <button onClick={() => setMoreOpen(true)}
          className={cn('flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors relative',
            moreActive ? 'text-primary' : 'text-muted-foreground')}>
          {moreActive && <span className="absolute top-1 w-1 h-1 rounded-full bg-primary" />}
          <MoreHorizontal size={18} strokeWidth={1.8} />
          <span className="text-[10px] font-medium">Meer</span>
        </button>
      </nav>

      {/* ── "Meer" bottom sheet ──────────────────────────────────────────── */}
      {moreOpen && (
        <>
          {/* Backdrop */}
          <div className="md:hidden fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)} />

          {/* Sheet */}
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-[60] bg-card rounded-t-2xl border-t border-border bottom-nav">
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            <div className="flex items-center justify-between px-5 py-2 border-b border-border">
              <span className="text-sm font-semibold">Meer</span>
              <button onClick={() => setMoreOpen(false)} className="p-1.5 rounded-lg hover:bg-accent">
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>

            <nav className="px-3 py-3 space-y-1">
              {moreNav.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link key={href} href={href} onClick={() => setMoreOpen(false)}
                    className={cn('flex items-center gap-4 px-4 py-3.5 rounded-xl text-sm transition-colors',
                      active ? 'bg-primary/10 text-primary font-semibold'
                             : 'text-foreground hover:bg-accent')}>
                    <Icon size={18} />
                    {label}
                  </Link>
                );
              })}

              <button onClick={() => { setMoreOpen(false); handleLogout(); }}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-sm text-muted-foreground hover:bg-accent transition-colors">
                <LogOut size={18} />
                Uitloggen
              </button>
            </nav>
          </div>
        </>
      )}
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
