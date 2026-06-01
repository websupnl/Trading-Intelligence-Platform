'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Shield, TrendingUp, Brain, PlayCircle, StopCircle } from 'lucide-react';

const PAGE_TITLES: Record<string, string> = {
  '/':          'Dashboard',
  '/posities':  'Posities',
  '/signals':   'Signalen',
  '/gok':       'Gok',
  '/feed':      'Feed',
  '/ai':        'AI Brein',
  '/live':      'Live',
  '/settings':  'Instellingen',
};

function StatusPill({ label, ok, warn }: { label: string; ok: boolean; warn?: boolean }) {
  return (
    <span className={cn(
      'hidden md:inline-flex px-2 py-0.5 rounded text-xs font-medium',
      ok   ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
      warn ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
             'bg-red-500/10 text-red-400 border border-red-500/20'
    )}>
      {label}
    </span>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const { data: status } = useApi(() => api.apiStatus(), []);
  const { data: risk } = useApi(() => api.getRiskStatus(), []);
  const { data: botHealth, reload: reloadBotHealth } = useApi(
    () => api.getBotHealth(), [], { pollIntervalMs: 10000 }
  );
  const [aiBusy, setAiBusy] = useState(false);

  const killSwitch = (risk as any)?.kill_switch_enabled;
  const liveEnabled = (risk as any)?.live_trading_enabled;
  const alpacaOk = (status as any)?.configured_integrations?.alpaca;
  const aiOk = (status as any)?.configured_integrations?.anthropic;
  const cryptoOnly = (status as any)?.market_session?.crypto_only;
  const aiPaused = !!(botHealth as any)?.ai_guard?.paused;
  const autoOn = !killSwitch && !(risk as any)?.require_manual_confirmation && !!(status as any)?.trading_mode;

  const pageTitle = Object.entries(PAGE_TITLES).find(([path]) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path)
  )?.[1] ?? 'Trading OS';

  const botOk = autoOn && !killSwitch && !aiPaused;

  async function handleAiToggle() {
    setAiBusy(true);
    try {
      if (aiPaused) await api.resumeAiGuard();
      else await api.pauseAiGuard(360, 'Handmatige AI stop via topbar');
      await reloadBotHealth();
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <header className="h-12 border-b border-border bg-card/95 backdrop-blur-sm flex items-center px-4 gap-3 shrink-0 z-40 pt-safe">

      {/* ── Mobile ────────────────────────────────────────────────────────── */}
      <div className="flex md:hidden items-center gap-3 w-full">
        {/* Live bot status dot */}
        <span className={cn(
          'w-2 h-2 rounded-full shrink-0 transition-colors',
          killSwitch ? 'bg-red-500' :
          aiPaused   ? 'bg-amber-400 animate-pulse' :
          botOk      ? 'bg-green-400 animate-pulse' : 'bg-amber-400'
        )} />

        <span className="font-semibold text-sm flex-1">{pageTitle}</span>

        {killSwitch && (
          <span className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">
            STOP
          </span>
        )}
        {liveEnabled && (
          <span className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded animate-pulse">
            LIVE
          </span>
        )}
        {cryptoOnly && !liveEnabled && (
          <span className="text-[10px] font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
            Crypto
          </span>
        )}

        <button
          onClick={handleAiToggle}
          disabled={aiBusy}
          className={cn(
            'flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all disabled:opacity-50',
            aiPaused
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
          )}
        >
          {aiPaused ? <><PlayCircle size={12} /> Start</> : <><StopCircle size={12} /> Stop</>}
        </button>
      </div>

      {/* ── Desktop ───────────────────────────────────────────────────────── */}
      <div className="hidden md:flex items-center gap-3 w-full">
        <span className="text-[11px] font-bold tracking-[0.15em] text-foreground/40 uppercase mr-2">
          Trading OS
        </span>

        <StatusPill label={autoOn ? '🤖 AUTO AAN' : '⏸ AUTO UIT'} ok={autoOn} warn={!autoOn && !killSwitch} />
        <StatusPill label={cryptoOnly ? 'CRYPTO FOCUS' : 'US MARKT OPEN'} ok={!cryptoOnly} warn={cryptoOnly} />
        <StatusPill
          label={liveEnabled ? '🔴 LIVE TRADING' : `${(status as any)?.trading_mode?.toUpperCase() ?? 'PAPER'}`}
          ok={!liveEnabled}
          warn={!!liveEnabled}
        />
        {killSwitch && <StatusPill label="🛑 KILL SWITCH" ok={false} />}
        {aiPaused && <StatusPill label="AI GEPAUZEERD" ok={false} />}

        <div className="flex-1" />

        <button
          onClick={handleAiToggle}
          disabled={aiBusy}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-50',
            aiPaused
              ? 'border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20'
              : 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20'
          )}
        >
          {aiPaused ? <><PlayCircle size={12} /> AI hervatten</> : <><StopCircle size={12} /> Stop AI</>}
        </button>

        <div className="h-4 border-l border-border mx-1" />

        <div className="flex items-center gap-2 text-muted-foreground">
          <TrendingUp size={12} className={alpacaOk ? 'text-green-400' : ''} title="Alpaca" />
          <Brain     size={12} className={aiOk      ? 'text-green-400' : ''} title="Claude AI" />
          <Shield    size={12} className={killSwitch ? 'text-red-400' : 'text-green-400'} title="Kill switch" />
        </div>
      </div>
    </header>
  );
}
