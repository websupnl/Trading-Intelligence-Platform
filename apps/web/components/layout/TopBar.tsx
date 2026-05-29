'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Brain, Wifi, Menu, X, Bell, StopCircle, PlayCircle, AlertTriangle } from 'lucide-react';
import {
  LayoutDashboard, Zap, ShoppingCart, TrendingUp, Cpu, Settings, Database, Activity,
  Radio, Newspaper, MessageSquare, BarChart3, Moon, ScrollText, MonitorPlay
} from 'lucide-react';

function StatusPill({ label, ok, warn }: { label: string; ok: boolean; warn?: boolean }) {
  return (
    <span className={cn(
      'hidden md:inline-flex px-2 py-0.5 rounded text-xs font-medium',
      ok ? 'bg-green-50 text-green-700 border border-green-200' :
      warn ? 'bg-amber-50 text-amber-700 border border-amber-200' :
             'bg-red-50 text-red-700 border border-red-200'
    )}>
      {label}
    </span>
  );
}

const mobileMenuItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Handelen' },
  { href: '/live', label: 'Live Sessie', icon: MonitorPlay, group: 'Handelen' },
  { href: '/crypto-session', label: 'Crypto Sessie', icon: Moon, group: 'Handelen' },
  { href: '/signals', label: 'Signalen', icon: Zap, group: 'Handelen' },
  { href: '/orders', label: 'Orders', icon: ShoppingCart, group: 'Handelen' },
  { href: '/portfolio', label: 'Portfolio', icon: TrendingUp, group: 'Handelen' },
  { href: '/performance', label: 'Prestaties', icon: BarChart3, group: 'Monitoring' },
  { href: '/notifications', label: 'Meldingen', icon: Bell, group: 'Monitoring' },
  { href: '/activity-log', label: 'Live Log', icon: ScrollText, group: 'Monitoring' },
  { href: '/rumour-radar', label: 'Geruchten Radar', icon: Radio, group: 'Informatie' },
  { href: '/news', label: 'Nieuws', icon: Newspaper, group: 'Informatie' },
  { href: '/social', label: 'Social Media', icon: MessageSquare, group: 'Informatie' },
  { href: '/ai-war-room', label: 'AI War Room', icon: Brain, group: 'Informatie' },
  { href: '/pipeline', label: 'Pipeline', icon: Cpu, group: 'Systeem' },
  { href: '/memory', label: 'Geheugen', icon: Database, group: 'Systeem' },
  { href: '/audit', label: 'Audit', icon: Activity, group: 'Systeem' },
  { href: '/settings', label: 'Instellingen', icon: Settings, group: 'Systeem' },
];

const menuGroups = ['Handelen', 'Monitoring', 'Informatie', 'Systeem'] as const;

export function TopBar() {
  const { data: status, reload: reloadStatus } = useApi(() => api.apiStatus(), []);
  const { data: risk, reload: reloadRisk } = useApi(() => api.getRiskStatus(), []);
  const { data: botHealth, reload: reloadBotHealth } = useApi(() => api.getBotHealth(), [], { pollIntervalMs: 10000 });
  const { data: notifications } = useApi(() => api.getNotifications(10), []);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => { reloadStatus(); reloadRisk(); }, 30000);
    return () => clearInterval(t);
  }, [reloadStatus, reloadRisk]);

  const killSwitch = risk?.kill_switch_enabled;
  const liveEnabled = risk?.live_trading_enabled;
  const cryptoOnly = status?.market_session?.crypto_only;
  const aiPaused = !!botHealth?.ai_guard?.paused;
  const autoOn = !killSwitch && !risk?.require_manual_confirmation && !!status?.trading_mode;
  const recentAlerts = notifications?.filter((item: any) => item.status === 'sent').length ?? 0;

  async function handleAiToggle() {
    setAiBusy(true);
    try {
      if (aiPaused) {
        await api.resumeAiGuard();
      } else {
        await api.pauseAiGuard(360, 'Handmatige AI stop via topbar');
      }
      await reloadBotHealth();
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <>
      <header className="h-11 border-b border-border bg-card flex items-center px-3 md:px-4 gap-2 md:gap-3 shrink-0 z-40 shadow-sm">
        {/* Mobile menu button */}
        <button
          className="md:hidden p-1.5 rounded hover:bg-accent transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={16} /> : <Menu size={16} />}
        </button>

        <div className="flex items-center gap-2 mr-auto text-xs text-muted-foreground">
          <Wifi size={12} />
          <span className="font-semibold text-foreground/80 tracking-wider uppercase">Trading OS</span>
        </div>

        {/* Kill switch alert — always visible when active */}
        {killSwitch && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 border border-red-300">
            <AlertTriangle size={11} />
            Kill Switch
          </span>
        )}

        {/* Status pills (desktop only) */}
        {!killSwitch && (
          <StatusPill
            label={autoOn ? 'Auto: Aan' : 'Auto: Uit'}
            ok={autoOn}
            warn={!autoOn}
          />
        )}
        <StatusPill
          label={cryptoOnly ? 'Crypto' : 'Aandelen'}
          ok={!cryptoOnly}
          warn={!!cryptoOnly}
        />
        <StatusPill
          label={liveEnabled ? 'Live' : (status?.trading_mode?.toUpperCase() ?? '...')}
          ok={!liveEnabled && !!status?.trading_mode}
          warn={!!liveEnabled}
        />
        {aiPaused && <StatusPill label="AI Gepauzeerd" ok={false} />}

        <div className="hidden md:block h-4 border-l border-border mx-1" />

        {/* AI toggle (desktop) */}
        <button
          onClick={handleAiToggle}
          disabled={aiBusy}
          title={aiPaused ? 'AI-analyse hervatten' : 'AI-analyse pauzeren'}
          className={cn(
            'hidden md:inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors disabled:opacity-50',
            aiPaused
              ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
              : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
          )}
        >
          {aiPaused ? <PlayCircle size={13} /> : <StopCircle size={13} />}
          {aiPaused ? 'AI hervatten' : 'AI pauzeren'}
        </button>

        {/* Notifications */}
        <Link href="/notifications" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground relative">
          <Bell size={14} />
          {recentAlerts > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
              {recentAlerts > 9 ? '9+' : recentAlerts}
            </span>
          )}
        </Link>

        {/* Mobile: compact status + AI toggle */}
        <div className="flex md:hidden items-center gap-1.5 text-xs">
          {aiPaused && <span className="text-amber-600 font-medium text-[11px]">AI</span>}
          <button
            onClick={handleAiToggle}
            disabled={aiBusy}
            className={cn(
              'rounded border px-1.5 py-0.5 text-[11px] font-medium',
              aiPaused ? 'border-green-200 text-green-700' : 'border-red-200 text-red-700'
            )}
          >
            {aiPaused ? 'Start AI' : 'Stop AI'}
          </button>
        </div>
      </header>

      {/* Mobile slide-in menu */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-slate-900/25"
            onClick={() => setMobileOpen(false)}
          />
          <div className="w-64 bg-card border-l border-border flex flex-col overflow-y-auto">
            <div className="px-4 py-4 border-b border-border flex items-center justify-between">
              <span className="font-bold tracking-widest text-sm uppercase">Trading OS</span>
              <button onClick={() => setMobileOpen(false)}><X size={16} /></button>
            </div>
            <nav className="flex-1 py-2 px-2">
              {menuGroups.map((group) => {
                const items = mobileMenuItems.filter(i => i.group === group);
                return (
                  <div key={group} className="mb-4">
                    <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/55">
                      {group}
                    </p>
                    {items.map(({ href, label, icon: Icon }) => (
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
                  </div>
                );
              })}
            </nav>
            <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground space-y-1">
              <div className="flex gap-3">
                <span className={cn(killSwitch ? 'text-red-500 font-medium' : 'text-green-700')}>
                  Kill Switch: {killSwitch ? 'AAN' : 'Uit'}
                </span>
                <span className={cn(aiPaused ? 'text-amber-600 font-medium' : 'text-green-700')}>
                  AI: {aiPaused ? 'Gepauzeerd' : 'Actief'}
                </span>
              </div>
              <p>v1.1.0</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
