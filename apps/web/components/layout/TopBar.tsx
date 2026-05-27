'use client';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AlertTriangle, Shield, TrendingUp, Brain, Wifi } from 'lucide-react';

function StatusPill({ label, ok, warn }: { label: string; ok: boolean; warn?: boolean }) {
  return (
    <span className={cn(
      'px-2 py-0.5 rounded text-xs font-medium',
      ok ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
      warn ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
             'bg-red-500/10 text-red-400 border border-red-500/20'
    )}>
      {label}
    </span>
  );
}

export function TopBar() {
  const { data: status } = useApi(() => api.apiStatus(), []);
  const { data: risk } = useApi(() => api.getRiskStatus(), []);

  const killSwitch = risk?.kill_switch_enabled;
  const liveEnabled = status?.live_trading_enabled;
  const alpacaOk = status?.configured_integrations?.alpaca;
  const aiOk = status?.configured_integrations?.anthropic;

  return (
    <header className="h-11 border-b border-border bg-card flex items-center px-4 gap-3 shrink-0">
      <div className="flex items-center gap-2 mr-auto text-xs text-muted-foreground">
        <Wifi size={12} />
        <span>Trading OS</span>
      </div>

      <StatusPill label={`Mode: ${status?.trading_mode?.toUpperCase() ?? '...'}`} ok={status?.trading_mode === 'paper'} />
      <StatusPill label={liveEnabled ? 'LIVE ACTIEF' : 'LIVE GEBLOKKEERD'} ok={!liveEnabled} warn={false} />
      {killSwitch && <StatusPill label="KILL SWITCH" ok={false} />}

      <div className="h-4 border-l border-border mx-1" />

      <span className="flex items-center gap-1 text-xs">
        <Shield size={12} className="text-muted-foreground" />
        <span className={cn('text-xs', killSwitch ? 'text-red-400' : 'text-green-400')}>
          Risk {killSwitch ? 'GEBLOKKEERD' : 'OK'}
        </span>
      </span>

      <span className="flex items-center gap-1 text-xs">
        <TrendingUp size={12} className="text-muted-foreground" />
        <span className={cn('text-xs', alpacaOk ? 'text-green-400' : 'text-muted-foreground')}>
          Alpaca {alpacaOk ? 'OK' : 'N/C'}
        </span>
      </span>

      <span className="flex items-center gap-1 text-xs">
        <Brain size={12} className="text-muted-foreground" />
        <span className={cn('text-xs', aiOk ? 'text-green-400' : 'text-muted-foreground')}>
          AI {aiOk ? 'OK' : 'N/C'}
        </span>
      </span>
    </header>
  );
}
