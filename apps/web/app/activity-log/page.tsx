'use client';

import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { RefreshCw, AlertCircle, CheckCircle, Info, XCircle, ChevronDown, ChevronRight } from 'lucide-react';

type Event = {
  kind: 'audit' | 'notification';
  type: string;
  severity: string;
  title: string;
  message: string;
  entity_type?: string;
  entity_id?: string;
  details?: Record<string, any> | null;
  actor?: string;
  created_at: string;
};

const ACTION_GROUPS = [
  { label: 'Alles', value: '' },
  { label: 'Signal skips', value: 'signal_skipped' },
  { label: 'Trades', value: 'trade' },
  { label: 'AI guard', value: 'ai_provider' },
  { label: 'Startup', value: 'app_startup' },
];

const SEVERITY_FILTERS = [
  { label: 'Alle severity', value: '' },
  { label: 'Fout', value: 'error' },
  { label: 'Waarschuwing', value: 'warning' },
  { label: 'Succesvol', value: 'success' },
  { label: 'Overgeslagen', value: 'skipped' },
];

function severityIcon(severity: string) {
  if (severity === 'error')   return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  if (severity === 'warning') return <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  if (severity === 'success') return <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />;
  return <Info className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
}

function borderColor(severity: string) {
  if (severity === 'error')   return 'border-l-red-500/60';
  if (severity === 'warning') return 'border-l-amber-500/60';
  if (severity === 'success') return 'border-l-green-500/60';
  return 'border-l-zinc-700';
}

function timeLabel(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('nl-NL', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function SignalSkipDetails({ details }: { details: Record<string, any> }) {
  const ta = details.ta_summary || '';
  const taScore = details.ta_score != null ? (details.ta_score as number).toFixed(2) : null;
  return (
    <div className="mt-1.5 space-y-0.5 text-[11px] text-zinc-400">
      {taScore && <span className="mr-2">TA score: <span className={cn('font-mono font-bold', Number(taScore) >= 0 ? 'text-green-400' : 'text-red-400')}>{taScore}</span></span>}
      <span className="mr-2">Nieuws: {details.news_count ?? 0} · Social: {details.social_count ?? 0}</span>
      {ta && <p className="text-[10px] text-zinc-500 mt-0.5 font-mono leading-relaxed">{ta}</p>}
    </div>
  );
}

function LogRow({ e }: { e: Event }) {
  const [open, setOpen] = useState(false);
  const isSignalSkip = e.type === 'signal_skipped';
  const hasDetails = e.details && Object.keys(e.details).length > 0;

  return (
    <div className={cn('border-l-2 px-3 py-2', borderColor(e.severity))}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{severityIcon(e.severity)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-mono font-semibold text-zinc-200">{e.type}</span>
            {e.entity_id && (
              <span className="text-[11px] font-bold text-purple-400">{e.entity_id}</span>
            )}
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded font-medium',
              e.kind === 'audit' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
            )}>
              {e.kind}
            </span>
          </div>
          {e.message && (
            <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{e.message}</p>
          )}
          {isSignalSkip && e.details && !open && (
            <SignalSkipDetails details={e.details} />
          )}
          {open && hasDetails && (
            <pre className="text-[10px] text-zinc-500 font-mono mt-1.5 bg-zinc-950 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(e.details, null, 2)}
            </pre>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground tabular-nums">{timeLabel(e.created_at)}</span>
          {hasDetails && (
            <button onClick={() => setOpen(o => !o)} className="text-zinc-600 hover:text-zinc-400">
              {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ActivityLogPage() {
  const [actionFilter, setActionFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [limit, setLimit] = useState(200);

  const fetcher = useCallback(
    () => (api as any).getSystemActivity(limit, actionFilter || undefined, severityFilter || undefined),
    [limit, actionFilter, severityFilter]
  );

  const { data, loading, reload } = useApi(fetcher, [limit, actionFilter, severityFilter], { pollIntervalMs: 8000 });
  const events: Event[] = Array.isArray(data) ? data : [];

  // Count by severity for quick overview
  const errCount = events.filter(e => e.severity === 'error').length;
  const warnCount = events.filter(e => e.severity === 'warning').length;
  const skipCount = events.filter(e => e.severity === 'skipped').length;

  return (
    <div className="p-4 md:p-6 space-y-3 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Dev Logs</h1>
          <span className="text-xs text-muted-foreground">({events.length})</span>
          {errCount > 0 && <span className="text-xs font-bold text-red-400">{errCount} fouten</span>}
          {warnCount > 0 && <span className="text-xs font-bold text-amber-400">{warnCount} warnings</span>}
          {skipCount > 0 && <span className="text-xs text-zinc-500">{skipCount} skips</span>}
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
        {/* Action type filter */}
        <div className="flex gap-1 flex-wrap">
          {ACTION_GROUPS.map(f => (
            <button
              key={f.value}
              onClick={() => setActionFilter(f.value)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                actionFilter === f.value
                  ? 'bg-zinc-700 border-zinc-500 text-white'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-white hover:border-zinc-700'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Severity filter */}
        <div className="flex gap-1 flex-wrap">
          {SEVERITY_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setSeverityFilter(f.value)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                severityFilter === f.value
                  ? 'bg-zinc-700 border-zinc-500 text-white'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-white hover:border-zinc-700',
                f.value === 'error' && 'hover:text-red-400',
                f.value === 'warning' && 'hover:text-amber-400',
                f.value === 'success' && 'hover:text-green-400',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Log list */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900 overflow-hidden">
        {loading && events.length === 0 && (
          <div className="p-6 text-center text-xs text-zinc-600">Laden...</div>
        )}
        {!loading && events.length === 0 && (
          <div className="p-6 text-center text-xs text-zinc-600">Geen logs gevonden voor deze filter.</div>
        )}
        {events.map((e, i) => <LogRow key={i} e={e} />)}
      </div>

      {/* Load more */}
      {events.length >= limit && (
        <button
          onClick={() => setLimit(l => l + 200)}
          className="w-full py-2 text-xs text-zinc-500 hover:text-white border border-zinc-800 rounded-lg hover:bg-zinc-900"
        >
          Meer laden ({limit} geladen)...
        </button>
      )}

    </div>
  );
}
