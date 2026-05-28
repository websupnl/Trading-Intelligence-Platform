'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, TrendingUp, ShoppingCart, Zap, Radio,
  Newspaper, MessageSquare, Brain, Database, Settings, Activity,
  Cpu, LogOut, MonitorPlay, BarChart3, Bell, ShieldCheck
} from 'lucide-react';
import { api, clearPin } from '@/lib/api';
import { useApi } from '@/hooks/useApi';

const nav = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/live', label: 'Live Session', icon: MonitorPlay },
  { href: '/portfolio', label: 'Portfolio', icon: TrendingUp },
  { href: '/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/signals', label: 'Signals', icon: Zap },
  { href: '/performance', label: 'Performance', icon: BarChart3 },
  { href: '/notifications', label: 'Alerts', icon: Bell },
  { href: '/rumour-radar', label: 'Rumour Radar', icon: Radio },
  { href: '/news', label: 'Nieuws', icon: Newspaper },
  { href: '/social', label: 'Social', icon: MessageSquare },
  { href: '/ai-war-room', label: 'AI War Room', icon: Brain },
  { href: '/pipeline', label: 'Pipeline', icon: Cpu },
  { href: '/memory', label: 'Memory', icon: Database },
  { href: '/audit', label: 'Audit', icon: Activity },
  { href: '/settings', label: 'Instellingen', icon: Settings },
];

// Mobile: show only most important pages
const mobileNav = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/live', label: 'Live', icon: MonitorPlay },
  { href: '/signals', label: 'Signals', icon: Zap },
  { href: '/performance', label: 'Scores', icon: BarChart3 },
  { href: '/portfolio', label: 'Portfolio', icon: TrendingUp },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: status } = useApi(() => api.apiStatus(), []);
  const { data: botHealth } = useApi(() => api.getBotHealth(), []);

  const marketSession = status?.market_session || botHealth?.market_session;
  const blockers: string[] = botHealth?.blockers ?? [];
  const autoBlocked = blockers.length > 0 || !!status?.require_manual_confirmation || !!status?.kill_switch_enabled;

  function handleLogout() {
    clearPin();
    window.location.reload();
  }

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-56 shrink-0 bg-card border-r border-border flex-col min-h-screen shadow-sm">
        <div className="px-4 py-5 border-b border-border">
          <span className="text-sm font-bold tracking-widest text-foreground/80 uppercase">Trading OS</span>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/35 px-2 py-1.5">
              <span className="text-muted-foreground">Market</span>
              <span className={cn('font-medium', marketSession?.crypto_only ? 'text-amber-700' : 'text-green-700')}>
                {marketSession?.crypto_only ? 'Crypto' : 'Open'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/35 px-2 py-1.5">
              <span className="flex items-center gap-1 text-muted-foreground">
                <ShieldCheck size={12} />
                Auto
              </span>
              <span className={cn('font-medium', autoBlocked ? 'text-amber-700' : 'text-green-700')}>
                {autoBlocked ? 'Uit' : 'Klaar'}
              </span>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                pathname === href
                  ? 'bg-accent text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-border space-y-2">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut size={12} />
            Uitloggen
          </button>
          <p className="text-xs text-muted-foreground">v1.1.0 • Paper Mode</p>
        </div>
      </aside>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex z-50 safe-area-pb">
        {mobileNav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex-1 flex flex-col items-center justify-center py-2 gap-1 text-xs transition-colors',
              pathname === href
                ? 'text-primary'
                : 'text-muted-foreground'
            )}
          >
            <Icon size={18} />
            <span className="text-[10px]">{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
