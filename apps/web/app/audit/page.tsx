'use client';
import { useState, useMemo } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtDate, cn } from '@/lib/utils';

const ACTION_CATEGORIES: Record<string, { color: string; label: string }> = {
  auto_trade_executed: { color: 'text-green-400', label: '🤖 Auto Trade' },
  auto_trade_risk_rejected: { color: 'text-yellow-400', label: '⚠️ Risk Rejected' },
  auto_trade_broker_error: { color: 'text-red-400', label: '❌ Broker Error' },
  signal_generated: { color: 'text-purple-400', label: '⚡ Signaal' },
  order_submitted: { color: 'text-blue-400', label: '📤 Order' },
  order_rejected: { color: 'text-yellow-400', label: '⛔ Order Rejected' },
  order_cancelled: { color: 'text-muted-foreground', label: '✖️ Cancelled' },
  position_closed_manually: { color: 'text-orange-400', label: '🔒 Positie Gesloten' },
  all_positions_closed: { color: 'text-red-400', label: '🛑 Alles Gesloten' },
  kill_switch_enabled: { color: 'text-red-400', label: '🛑 Kill Switch AAN' },
  kill_switch_disabled: { color: 'text-green-400', label: '✅ Kill Switch UIT' },
  settings_updated: { color: 'text-blue-400', label: '⚙️ Instellingen' },
  trade_reflection_written: { color: 'text-purple-400', label: '💡 Trade Les' },
  trade_synced_from_alpaca: { color: 'text-muted-foreground', label: '🔄 Trade Sync' },
  pipeline_task_triggered: { color: 'text-blue-400', label: '▶ Pipeline' },
  app_startup: { color: 'text-muted-foreground', label: '🚀 Startup' },
};

type FilterType = 'all' | 'trades' | 'signals' | 'system' | 'errors';

const FILTER_ACTIONS: Record<FilterType, string[]> = {
  all: [],
  trades: ['auto_trade_executed', 'order_submitted', 'position_closed_manually', 'all_positions_closed', 'trade_reflection_written'],
  signals: ['signal_generated', 'auto_trade_risk_rejected'],
  system: ['kill_switch_enabled', 'kill_switch_disabled', 'settings_updated', 'pipeline_task_triggered', 'app_startup'],
  errors: [],
};

export default function AuditPage() {
  const { data: logs, loading, reload } = useApi(() => api.getAuditLogs(500), [], { pollIntervalMs: 5000 });
  const [filter, setFilter] = useState<FilterType>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!logs) return [];
    if (filter === 'errors') return logs.filter((e: any) => e.status === 'error' || e.status === 'rejected');
    if (filter === 'all') return logs;
    const actions = FILTER_ACTIONS[filter];
    return logs.filter((e: any) => actions.includes(e.action));
  }, [logs, filter]);

  const counts = useMemo(() => ({
    all: logs?.length || 0,
    trades: logs?.filter((e: any) => FILTER_ACTIONS.trades.includes(e.action)).length || 0,
    signals: logs?.filter((e: any) => FILTER_ACTIONS.signals.includes(e.action)).length || 0,
    system: logs?.filter((e: any) => FILTER_ACTIONS.system.includes(e.action)).length || 0,
    errors: logs?.filter((e: any) => e.status === 'error' || e.status === 'rejected').length || 0,
  }), [logs]);

  const tabs: { key: FilterType; label: string }[] = [
    { key: 'all', label: `Alles (${counts.all})` },
    { key: 'trades', label: `Trades (${counts.trades})` },
    { key: 'signals', label: `Signals (${counts.signals})` },
    { key: 'system', label: `Systeem (${counts.system})` },
    { key: 'errors', label: `Fouten (${counts.errors})` },
  ];

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-base font-semibold">Audit Log</h1>
        <Button variant="outline" size="sm" onClick={reload}>Vernieuwen</Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-md transition-colors',
              filter === key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {!loading && filtered.length === 0 && <EmptyState message="Geen audit events voor dit filter" />}
          {filtered.map((e: any) => {
            const cat = ACTION_CATEGORIES[e.action];
            const isExpanded = expanded === e.id;
            const hasDetails = e.details && Object.keys(e.details).length > 0;

            return (
              <div
                key={e.id}
                className={cn(
                  'border-b border-border last:border-0',
                  hasDetails ? 'cursor-pointer hover:bg-muted/20' : ''
                )}
                onClick={() => hasDetails && setExpanded(isExpanded ? null : e.id)}
              >
                <div className="flex items-start gap-3 px-4 py-2.5">
                  <span className="text-xs text-muted-foreground shrink-0 w-28 mt-0.5">
                    {fmtDate(e.created_at)}
                  </span>
                  <Badge variant={
                    e.status === 'error' ? 'danger' :
                    e.status === 'rejected' ? 'warning' :
                    'muted'
                  } className="shrink-0 mt-0.5">{e.status}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('text-xs font-medium', cat?.color || 'text-foreground')}>
                        {cat?.label || e.action}
                      </span>
                      {e.actor && e.actor !== 'system' && (
                        <span className="text-xs text-muted-foreground">({e.actor})</span>
                      )}
                    </div>
                    {e.message && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{e.message}</p>
                    )}
                  </div>
                  {hasDetails && (
                    <span className="text-xs text-muted-foreground shrink-0">{isExpanded ? '▲' : '▼'}</span>
                  )}
                </div>

                {/* Expanded details */}
                {isExpanded && hasDetails && (
                  <div className="px-4 pb-3 ml-28">
                    <div className="bg-muted/30 rounded p-2 text-xs font-mono space-y-1">
                      {Object.entries(e.details).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-muted-foreground shrink-0">{k}:</span>
                          <span className="text-foreground break-all">
                            {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
