'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, TrendingUp, ShoppingCart, Zap, Radio,
  Newspaper, MessageSquare, Brain, Database, Settings, Activity,
  Cpu, LogOut, MonitorPlay, BarChart3, Bell, ShieldCheck, Moon, ScrollText
} from 'lucide-react';
import { api, clearPin } from '@/lib/api';
import { useApi } from '@/hooks/useApi';

const navGroups = [
  {
    label: 'Handelen',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/live', label: 'Live Sessie', icon: MonitorPlay },
      { href: '/crypto-session', label: 'Crypto Sessie', icon: Moon },
      { href: '/signals', label: 'Signalen', icon: Zap },
      { href: '/orders', label: 'Orders', icon: ShoppingCart },
      { href: '/portfolio', label: 'Portfolio', icon: TrendingUp },
    ],
  },
  {
    label: 'Monitoring',
    items: [
      { href: '/performance', label: 'Prestaties', icon: BarChart3 },
      { href: '/notifications', label: 'Meldingen', icon: Bell },
      { href: '/activity-log', label: 'Live Log', icon: ScrollText },
    ],
  },
  {
    label: 'Informatie',
    items: [
      { href: '/rumour-radar', label: 'Geruchten Radar', icon: Radio },
      { href: '/news', label: 'Nieuws', icon: Newspaper },
      { href: '/social', label: 'Social Media', icon: MessageSquare },
      { href: '/ai-war-room', label: 'AI War Room', icon: Brain },
    ],
  },
  {
    label: 'Systeem',
    items: [
      { href: '/pipeline', label: 'Pipeline', icon: Cpu },
      { href: '/memory', label: 'Geheugen', icon: Database },
      { href: '/audit', label: 'Audit', icon: Activity },
      { href: '/settings', label: 'Instellingen', icon: Settings },
    ],
  },
];

const mobileNav = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/live', label: 'Live', icon: MonitorPlay },
  { href: '/signals', label: 'Signalen', icon: Zap },
  { href: '/activity-log', label: 'Log', icon: ScrollText },
  { href: '/portfolio', label: 'Portfolio', icon: TrendingUp },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: status } = useApi(() => api.apiStatus(), []);
  const { data: botHealth } = useApi(() => api.getBotHealth(), []);

  const marketSession = status?.market_session || botHealth?.market_session;
  const aiPaused = !!botHealth?.ai_guard?.paused;
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
              <span className="text-muted-foreground">Markt</span>
              <span className={cn('font-medium', marketSession?.crypto_only ? 'text-amber-700' : 'text-green-700')}>
                {marketSession?.crypto_only ? 'Crypto' : 'Aandelen'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/35 px-2 py-1.5">
              <span className="flex items-center gap-1 text-muted-foreground">
                <ShieldCheck size={12} />
                Auto-trade
              </span>
              <span className={cn('font-medium', autoBlocked ? 'text-amber-700' : 'text-green-700')}>
                {autoBlocked ? 'Geblokkeerd' : 'Actief'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/35 px-2 py-1.5">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Brain size={12} />
                AI
              </span>
              <span className={cn('font-medium', aiPaused ? 'text-red-700' : 'text-green-700')}>
                {aiPaused ? 'Gepauzeerd' : 'Actief'}
              </span>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/55">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => (
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
              </div>
            </div>
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
          <p className="text-xs text-muted-foreground">v1.1.0 · Paper Mode</p>
        </div>
      </aside>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex z-50 safe-area-pb">
        {mobileNav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex-1 flex flex-col items-center justify-center py-2 gap-1 transition-colors',
              pathname === href
                ? 'text-primary'
                : 'text-muted-foreground'
            )}
          >
            <Icon size={18} />
            <span className="text-[11px]">{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
