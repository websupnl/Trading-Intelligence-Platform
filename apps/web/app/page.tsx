'use client';
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

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold text-foreground">Dashboard</h1>
      <div className="grid grid-cols-3 gap-4">
        <StatusGrid />
        <AccountCard />
        <SignalsCard />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <RumoursCard />
        <NewsCard />
        <AuditCard />
      </div>
    </div>
  );
}
