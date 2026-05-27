'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { StatusGrid } from '@/components/dashboard/StatusGrid';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtUSD, fmtDate, confidenceColor } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { AssetLabel } from '@/components/market/AssetLabel';

function AccountCard() {
  const { data, loading, error } = useApi(() => api.getAccount(), []);
  return (
    <Card>
      <CardHeader><CardTitle>Alpaca Account</CardTitle></CardHeader>
      <CardContent>
        {loading && <LoadingSpinner />}
        {error && <ErrorState message={typeof error === 'string' ? error : 'Alpaca niet geconfigureerd'} />}
        {data && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Portfolio Value</p>
              <p className="font-semibold text-lg">{fmtUSD(parseFloat(data.portfolio_value))}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Buying Power</p>
              <p className="font-semibold">{fmtUSD(parseFloat(data.buying_power))}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Cash</p>
              <p className="text-sm">{fmtUSD(parseFloat(data.cash))}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Status</p>
              <Badge variant={data.status === 'ACTIVE' ? 'success' : 'warning'}>{data.status}</Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SignalsCard() {
  const { data, loading, error } = useApi(() => api.getSignals(5), []);
  return (
    <Card>
      <CardHeader><CardTitle>Recente Signals</CardTitle></CardHeader>
      <CardContent className="p-0">
        {loading && <LoadingSpinner />}
        {error && <div className="p-4"><ErrorState message="Signals niet beschikbaar" /></div>}
        {data?.length === 0 && <EmptyState message="Geen actieve signals" />}
        {data?.map((s: any) => (
          <div key={s.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0">
            <div>
              <AssetLabel symbol={s.asset} className="text-sm" />
              <span className={cn('ml-2 text-xs', s.direction === 'buy' ? 'text-green-400' : 'text-red-400')}>
                {s.direction?.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn('text-xs', confidenceColor(s.confidence))}>{(s.confidence * 100).toFixed(0)}%</span>
              <Badge variant={s.status === 'pending' ? 'warning' : 'muted'}>{s.status}</Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RumoursCard() {
  const { data, loading } = useApi(() => api.getRumours(5), []);
  return (
    <Card>
      <CardHeader><CardTitle>Actieve Geruchten</CardTitle></CardHeader>
      <CardContent className="p-0">
        {loading && <LoadingSpinner />}
        {data?.length === 0 && <EmptyState message="Geen actieve geruchten" />}
        {data?.map((r: any) => (
          <div key={r.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0">
            <div className="min-w-0 mr-2">
              <span className="text-sm truncate block">{r.title}</span>
              {r.related_assets?.slice(0, 2).map((asset: string) => (
                <AssetLabel key={asset} symbol={asset} compact className="text-xs mr-2" />
              ))}
            </div>
            <Badge variant={
              r.recommendation === 'ignore' ? 'muted' :
              r.recommendation === 'watch' ? 'warning' :
              r.recommendation === 'blocked' ? 'danger' : 'default'
            }>{r.recommendation}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function NewsCard() {
  const { data, loading } = useApi(() => api.getNews(5), []);
  return (
    <Card>
      <CardHeader><CardTitle>Laatste Nieuws</CardTitle></CardHeader>
      <CardContent className="p-0">
        {loading && <LoadingSpinner />}
        {data?.length === 0 && <EmptyState message="Geen nieuws beschikbaar" />}
        {data?.map((n: any) => (
          <div key={n.id} className="px-4 py-2.5 border-b border-border last:border-0">
            <p className="text-sm truncate">{n.title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted-foreground">{n.source}</span>
              {n.tickers?.slice(0, 3).map((t: string) => (
                <Badge key={t} variant="muted" className="text-xs px-1"><AssetLabel symbol={t} compact /></Badge>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AuditCard() {
  const { data, loading } = useApi(() => api.getAuditLogs(8), []);
  return (
    <Card>
      <CardHeader><CardTitle>Audit Log</CardTitle></CardHeader>
      <CardContent className="p-0">
        {loading && <LoadingSpinner />}
        {data?.length === 0 && <EmptyState message="Geen audit events" />}
        {data?.map((e: any) => (
          <div key={e.id} className="flex items-center justify-between px-4 py-2 border-b border-border last:border-0">
            <div>
              <span className="text-xs font-medium">{e.action}</span>
              {e.message && <span className="text-xs text-muted-foreground ml-2">{e.message}</span>}
            </div>
            <span className="text-xs text-muted-foreground shrink-0 ml-2">{fmtDate(e.created_at)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PerformanceSnapshot() {
  const { data, loading } = useApi(() => api.getOutcomeSummary(), []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signal Performance</CardTitle>
        <Link href="/performance" className="text-xs text-primary hover:underline">Details</Link>
      </CardHeader>
      <CardContent>
        {loading && <LoadingSpinner />}
        {!loading && (
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Gemeten 5d</p>
              <p className="text-lg font-semibold">{data?.evaluated_5d ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Hit rate</p>
              <p className={cn('text-lg font-semibold', data?.hit_rate_5d >= 50 ? 'text-green-400' : 'text-muted-foreground')}>
                {data?.hit_rate_5d == null ? '-' : `${data.hit_rate_5d.toFixed(1)}%`}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Gem. 5d</p>
              <p className={cn('text-lg font-semibold', data?.avg_pnl_5d_pct >= 0 ? 'text-green-400' : 'text-red-400')}>
                {data?.avg_pnl_5d_pct == null ? '-' : `${data.avg_pnl_5d_pct >= 0 ? '+' : ''}${data.avg_pnl_5d_pct.toFixed(2)}%`}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AiFeedbackCard() {
  const [feedback, setFeedback] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await api.getAiFeedback();
        if (active) setFeedback(result.items || []);
      } catch {
        if (active) setFeedback([]);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  function message(item: any) {
    if (item.kind !== 'lesson') return item.message;
    try {
      const parsed = JSON.parse(item.message);
      return parsed.lesson || parsed.next_time || item.message;
    } catch {
      return item.message;
    }
  }

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>AI Feedback Feed</CardTitle>
        <span className="text-xs text-muted-foreground">ververst elke 30 sec</span>
      </CardHeader>
      <CardContent className="p-0">
        {loading && <LoadingSpinner />}
        {!loading && feedback.length === 0 && <EmptyState message="Nog geen AI feedback of gemeten outcomes." />}
        {feedback.map(item => (
          <div key={`${item.kind}-${item.id}`} className="border-b border-border px-4 py-2.5 last:border-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={item.kind === 'outcome' ? 'success' : item.kind === 'lesson' ? 'default' : 'muted'}>
                  {item.kind}
                </Badge>
                {item.symbol && <AssetLabel symbol={item.symbol} compact className="text-xs" />}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{fmtDate(item.created_at)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{message(item)}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold text-foreground">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatusGrid />
        <AccountCard />
        <SignalsCard />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PerformanceSnapshot />
        <AiFeedbackCard />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <RumoursCard />
        <NewsCard />
        <AuditCard />
      </div>
    </div>
  );
}
