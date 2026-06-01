'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { RefreshCw, AlertCircle, CheckCircle, Info, XCircle, Filter } from 'lucide-react';

type Event = {
  kind: 'audit' | 'notification';
  type: string;
  severity: string;
  title: string;
  message: string;
  created_at: string;
};

function severityIcon(severity: string) {
  if (severity === 'error')   return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  if (severity === 'warning') return <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  if (severity === 'success') return <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />;
  return <Info className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
}

function severityColor(severity: string) {
  if (severity === 'error')   return 'border-l-red-500/60';
  if (severity === 'warning') return 'border-l-amber-500/60';
  if (severity === 'success') return 'border-l-green-500/60';
  return 'border-l-zinc-600';
}

function timeLabel(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('nl-NL', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const ALL_SEVERITIES = ['error', 'warning', 'success', 'skipped'];

export default function ActivityLogPage() {
  const [filter, setFilter] = useState<string>('all');
  const [limit, setLimit] = useState(100);
  const { data, loading, reload } = useApi(
    () => (api as any).getSystemActivity(limit),
    [limit],
    { pollIntervalMs: 10000 }
  );

  const events: Event[] = Array.isArray(data) ? data : [];
  const filtered = filter === 'all' ? events : events.filter(e => e.severity === filter);

  const counts = ALL_SEVERITIES.reduce((acc, s) => {
    acc[s] = events.filter(e => e.severity === s).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-zinc-400" />
          <h1 className="text-lg font-semibold">Activiteiten Log</h1>
          <span className="text-xs text-muted-foreground">({filtered.length} events)</span>
        </div>
        <button
          onClick={() => reload(true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Ververs
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('all')}
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
            filter === 'all'
              ? 'bg-zinc-700 border-zinc-500 text-white'
              : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white'
          )}
        >
          Alles ({events.length})
        </button>
        {[
          { key: 'error',   label: 'Fouten',      color: 'text-red-400' },
          { key: 'warning', label: 'Waarschuwing', color: 'text-amber-400' },
          { key: 'success', label: 'Succesvol',    color: 'text-green-400' },
          { key: 'skipped', label: 'Overgeslagen', color: 'text-zinc-400' },
        ].map(({ key, label, color }) => (counts[key] ?? 0) > 0 && (
          <button
            key={key}
            onClick={() => setFilter(filter === key ? 'all' : key)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
              filter === key
                ? 'bg-zinc-700 border-zinc-500 text-white'
                : 'bg-zinc-900 border-zinc-700 hover:text-white',
              color
            )}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      {/* Log list */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 divide-y divide-zinc-800 overflow-hidden">
        {filtered.length === 0 && (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {loading ? 'Laden...' : 'Geen events gevonden.'}
          </div>
        )}
        {filtered.map((e, i) => (
          <div key={i} className={cn('flex items-start gap-3 px-4 py-2.5 border-l-2', severityColor(e.severity))}>
            <div className="mt-0.5">{severityIcon(e.severity)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-zinc-300">{e.type}</span>
                {e.kind && (
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded font-medium',
                    e.kind === 'audit' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
                  )}>
                    {e.kind}
                  </span>
                )}
              </div>
              {e.message && (
                <p className="text-xs text-zinc-400 mt-0.5 break-words">{e.message}</p>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
              {timeLabel(e.created_at)}
            </span>
          </div>
        ))}
      </div>

      {/* Load more */}
      {events.length >= limit && (
        <button
          onClick={() => setLimit(l => l + 100)}
          className="w-full py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-lg hover:bg-zinc-800"
        >
          Meer laden ({limit} geladen)...
        </button>
      )}

    </div>
  );
}
