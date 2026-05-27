'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AlertTriangle, Shield, TrendingUp, Brain, Wifi, Menu, X } from 'lucide-react';
import {
  LayoutDashboard, Zap, ShoppingCart, Cpu, Settings, Database, Activity,
  Radio, Newspaper, MessageSquare
} from 'lucide-react';

function StatusPill({ label, ok, warn }: { label: string; ok: boolean; warn?: boolean }) {
  return (
    <span className={cn(
      'hidden md:inline-flex px-2 py-0.5 rounded text-xs font-medium',
      ok ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
      warn ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
             'bg-red-500/10 text-red-400 border border-red-500/20'
    )}>
      {label}
    </span>
  );
}

const mobileMenuItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/signals', label: 'Signals', icon: Zap },
  { href: '/portfolio', label: 'Portfolio', icon: TrendingUp },
  { href: '/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/pipeline', label: 'Pipeline', icon: Cpu },
  { href: '/ai-war-room', label: 'AI War Room', icon: Brain },
  { href: '/rumour-radar', label: 'Rumour Radar', icon: Radio },
  { href: '/news', label: 'Nieuws', icon: Newspaper },
  { href: '/social', label: 'Social', icon: MessageSquare },
  { href: '/memory', label: 'Memory', icon: Database },
  { href: '/audit', label: 'Audit', icon: Activity },
  { href: '/settings', label: 'Instellingen', icon: Settings },
];

export function TopBar() {
  const { data: status } = useApi(() => api.apiStatus(), []);
  const { data: risk } = useApi(() => api.getRiskStatus(), []);
  const [mobileOpen, setMobileOpen] = useState(false);

  const killSwitch = risk?.kill_switch_enabled;
  const liveEnabled = risk?.live_trading_enabled;
  const alpacaOk = status?.configured_integrations?.alpaca;
  const aiOk = status?.configured_integrations?.anthropic;

  return (
    <>
      <header className="h-11 border-b border-border bg-card flex items-center px-3 md:px-4 gap-2 md:gap-3 shrink-0 z-40">
        {/* Mobile menu button */}
        <button
          className="md:hidden p-1.5 rounded hover:bg-accent transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={16} /> : <Menu size={16} />}
        </button>

        <div className="flex items-center gap-2 mr-auto text-xs text-muted-foreground">
          <Wifi size={12} />
          <span className="font-medium">Trading OS</span>
        </div>

        {/* Status pills (desktop only) */}
        <StatusPill
          label={`${status?.trading_mode?.toUpperCase() ?? '...'}`}
          ok={status?.trading_mode === 'paper'}
        />
        <StatusPill
          label={liveEnabled ? '🔴 LIVE' : 'paper'}
          ok={!liveEnabled}
        />
        {killSwitch && <StatusPill label="🛑 KILL SWITCH" ok={false} />}

        <div className="hidden md:block h-4 border-l border-border mx-1" />

        <span className="hidden md:flex items-center gap-1 text-xs">
          <Shield size={12} className="text-muted-foreground" />
          <span className={cn('text-xs', killSwitch ? 'text-red-400' : 'text-green-400')}>
            {killSwitch ? 'BLOCKED' : 'OK'}
          </span>
        </span>

        <span className="hidden md:flex items-center gap-1 text-xs">
          <TrendingUp size={12} className="text-muted-foreground" />
          <span className={cn('text-xs', alpacaOk ? 'text-green-400' : 'text-muted-foreground')}>
            {alpacaOk ? '●' : '○'}
          </span>
        </span>

        <span className="hidden md:flex items-center gap-1 text-xs">
          <Brain size={12} className="text-muted-foreground" />
          <span className={cn('text-xs', aiOk ? 'text-green-400' : 'text-muted-foreground')}>
            {aiOk ? '●' : '○'}
          </span>
        </span>

        {/* Mobile: compact status */}
        <div className="flex md:hidden items-center gap-2 text-xs">
          {killSwitch && <span className="text-red-400">🛑</span>}
          <span className={cn(alpacaOk ? 'text-green-400' : 'text-muted-foreground')}>
            {alpacaOk ? '●' : '○'}
          </span>
        </div>
      </header>

      {/* Mobile slide-in menu */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="w-64 bg-card border-l border-border flex flex-col overflow-y-auto">
            <div className="px-4 py-4 border-b border-border flex items-center justify-between">
              <span className="font-bold tracking-widest text-sm uppercase">Trading OS</span>
              <button onClick={() => setMobileOpen(false)}><X size={16} /></button>
            </div>
            <nav className="flex-1 py-2 px-2">
              {mobileMenuItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                >
                  <Icon size={16} />
                  {label}
                </Link>
              ))}
            </nav>
            <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
              <div className="flex gap-2">
                <span className={cn(killSwitch ? 'text-red-400' : 'text-green-400')}>
                  Kill Switch: {killSwitch ? 'AAN' : 'UIT'}
                </span>
              </div>
              <p className="mt-1">v1.1.0</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
