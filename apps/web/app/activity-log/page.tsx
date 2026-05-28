'use client';

import { useMemo, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { cn, fmtDate } from '@/lib/utils';
import { Activity, Bot, Database, Filter, RefreshCw, Search, ShieldCheck, ShoppingCart, Zap } from 'lucide-react';

type ModuleKey = 'all' | 'ai' | 'pipeline' | 'trading' | 'risk' | 'data' | 'session' | 'errors';

const modules: { key: ModuleKey; label: string; icon: any }[] = [
  { key: 'all', label: 'Alles', icon: Activity },
  { key: 'ai', label: 'AI', icon: Bot },
  { key: 'pipeline', label: 'Pipeline', icon: Zap },
  { key: 'trading', label: 'Trades', icon: ShoppingCart },
  { key: 'risk', label: 'Risk', icon: ShieldCheck },
  { key: 'data', label: 'Data', icon: Database },
  { key: 'session', label: 'Sessie', icon: Activity },
  { key: 'errors', label: 'Fouten', icon: Filter },
];

function moduleFor(action: string, actor?: string): ModuleKey {
  const text = `${action} ${actor || ''}`.toLowerCase();
  if (text.includes('ai') || text.includes('signal') || text.includes('anthropic') || text.includes('reflection')) return 'ai';
  if (text.includes('pipeline') || text.includes('task')) return 'pipeline';
  if (text.includes('trade') || text.includes('order') || text.includes('position')) return 'trading';
  if (text.includes('risk') || text.includes('kill') || text.includes('circuit')) return 'risk';
  if (text.includes('news') || text.includes('reddit') || text.includes('market_data') || text.includes('ingest')) return 'data';
  if (text.includes('session') || text.includes('crypto_session')) return 'session';
  return 'all';
}

function tone(status?: string) {
  if (status === 'error') return 'danger';
  if (status === 'rejected' || status === 'skipped') return 'warning';
  if (status === 'success') return 'success';
  return 'muted';
}

function summarizeDetails(details: any) {
  if (!details || typeof details !== 'object') return null;
  const parts = [
    details.asset,
    details.symbol,
    details.direction,
    details.confidence != null ? `${Math.round(details.confidence * 100)}%` : null,
    details.notional != null ? `$${Number(details.notional).toFixed(0)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export default function ActivityLogPage() {
  const { data: logs, loading, reload } = useApi(() => api.getAuditLogs(500), [], { pollIntervalMs: 3000 });
  const [selected, setSelected] = useState<ModuleKey>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const items = logs || [];
    return items.filter((item: any) => {
      const mod = moduleFor(item.action, item.actor);
      const matchesModule =
        selected === 'all' ||
        (selected === 'errors' ? item.status === 'error' || item.status === 'rejected' : mod === selected);
      const haystack = `${item.action} ${item.actor} ${item.message || ''} ${JSON.stringify(item.details || {})}`.toLowerCase();
      return matchesModule && (!query.trim() || haystack.includes(query.toLowerCase()));
    });
  }, [logs, selected, query]);

  const counts = useMemo(() => {
    const out: Record<ModuleKey, number> = { all: logs?.length || 0, ai: 0, pipeline: 0, trading: 0, risk: 0, data: 0, session: 0, errors: 0 };
    (logs || []).forEach((item: any) => {
      const mod = moduleFor(item.action, item.actor);
      if (mod !== 'all') out[mod] += 1;
      if (item.status === 'error' || item.status === 'rejected') out.errors += 1;
    });
    return out;
  }, [logs]);

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-base font-semibold">Streaming Activity Log</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Realtime audit trail van AI, pipeline, risk, orders, sessies en fouten. Ververst automatisch elke 3 sec.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success" className="flow-pulse">Live</Badge>
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw size={13} />
            Nu verversen
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Filter size={15} />
            <CardTitle>Filters</CardTitle>
          </div>
          <div className="relative w-full md:w-72">
            <Search size={13} className="absolute left-2 top-2.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek actie, asset, reden..."
              className="h-8 w-full rounded-md border border-border bg-card pl-7 pr-2 text-xs"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {modules.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                  selected === key ? 'border-primary bg-accent text-primary font-medium' : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon size={13} />
                {label}
                <span className="tabular-nums opacity-70">{counts[key]}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {!loading && filtered.length === 0 && <EmptyState message="Geen events voor deze filter" />}
          {filtered.map((item: any) => {
            const mod = moduleFor(item.action, item.actor);
            const hasDetails = item.details && Object.keys(item.details).length > 0;
            const isExpanded = expanded === item.id;
            const summary = summarizeDetails(item.details);
            return (
              <div
                key={item.id}
                className={cn('border-b border-border last:border-0', hasDetails && 'cursor-pointer hover:bg-muted/25')}
                onClick={() => hasDetails && setExpanded(isExpanded ? null : item.id)}
              >
                <div className="grid grid-cols-[88px_86px_1fr_auto] gap-2 px-3 py-2.5 items-start text-xs">
                  <span className="text-muted-foreground tabular-nums">{fmtDate(item.created_at)}</span>
                  <div className="flex flex-col gap-1">
                    <Badge variant={tone(item.status) as any}>{item.status || 'event'}</Badge>
                    <span className="text-[10px] text-muted-foreground">{mod}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{item.action}</span>
                      {item.actor && <span className="text-muted-foreground">door {item.actor}</span>}
                      {summary && <span className="text-muted-foreground">{summary}</span>}
                    </div>
                    {item.message && <p className="mt-0.5 text-muted-foreground line-clamp-2">{item.message}</p>}
                  </div>
                  {hasDetails && <span className="text-muted-foreground">{isExpanded ? '▲' : '▼'}</span>}
                </div>
                {isExpanded && hasDetails && (
                  <div className="px-3 pb-3">
                    <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/35 p-3 text-[11px] leading-relaxed">
{JSON.stringify(item.details, null, 2)}
                    </pre>
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
