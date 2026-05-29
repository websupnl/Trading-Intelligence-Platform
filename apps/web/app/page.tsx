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
import { CheckCircle, XCircle, AlertTriangle, Bot, ArrowRight } from 'lucide-react';

function formatBlocker(b: string): string {
  if (b.startsWith('anthropic_api_paused_until')) return 'AI-analyse tijdelijk gepauzeerd';
  if (b === 'require_manual_confirmation') return 'Handmatige goedkeuring vereist';
  if (b === 'kill_switch_enabled') return 'Kill switch actief — alle orders geblokkeerd';
  if (b === 'no_trading_mode') return 'Geen trading mode ingesteld';
  if (b === 'alpaca_not_configured') return 'Alpaca niet gekoppeld';
  return b.replace(/_/g, ' ');
}

function BotStatusCard() {
  const { data, loading, reload: refetch } = useApi(() => api.getBotHealth(), []);
  const [resuming, setResuming] = useState(false);

  const ready = data?.ready;
  const blockers: string[] = data?.blockers ?? [];
  const isAiPaused = blockers.some((b) => b.startsWith('anthropic_api_paused_until'));

  async function handleResumeAi() {
    setResuming(true);
    try {
      await api.resumeAiGuard();
      await refetch();
    } finally {
      setResuming(false);
    }
  }

  return (
    <Card className="md:col-span-3">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bot size={16} />
          <CardTitle>Bot Status</CardTitle>
        </div>
        <button onClick={refetch} className="text-xs text-primary hover:underline">Vernieuwen</button>
      </CardHeader>
      <CardContent>
        {loading && <LoadingSpinner />}
        {!loading && data && (
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-center gap-2 shrink-0">
              {ready ? (
                <CheckCircle size={20} className="text-green-500" />
              ) : (
                <XCircle size={20} className="text-red-500" />
              )}
              <span className={cn('font-semibold text-sm', ready ? 'text-green-500' : 'text-red-500')}>
                {ready ? 'Bot actief — auto-trading aan' : 'Bot geblokkeerd'}
              </span>
            </div>

            {blockers.length > 0 && (
              <div className="flex flex-wrap gap-2 items-center">
                {blockers.map((b) => (
                  <span key={b} className="flex items-center gap-1 text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-1 rounded">
                    <AlertTriangle size={11} />
                    {formatBlocker(b)}
                  </span>
                ))}
                {isAiPaused && (
                  <button
                    onClick={handleResumeAi}
                    disabled={resuming}
                    className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 px-2 py-1 rounded disabled:opacity-50"
                  >
                    {resuming ? 'Bezig…' : 'AI pauze opheffen'}
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-4 text-xs text-muted-foreground md:ml-auto flex-wrap">
              <span>Modus: <b className="text-foreground">{data.trading_mode}</b></span>
              <span>Signalen (1u): <b className="text-foreground">{data.recent_signals_1h}</b></span>
              <span>Trades (1u): <b className="text-foreground">{data.recent_trades_1h}</b></span>
              <span>Open posities: <b className="text-foreground">{data.open_trades}</b></span>
              {data.last_signal_at && (
                <span>Laatste signaal: <b className="text-foreground">{new Date(data.last_signal_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</b></span>
              )}
              {data.last_auto_trade_at && (
                <span>Laatste trade: <b className="text-foreground">{new Date(data.last_auto_trade_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</b></span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const { data, loading, error } = useApi(() => api.getAccount(), []);
  return (
    <Card>
      <CardHeader><CardTitle>Account</CardTitle></CardHeader>
      <CardContent>
        {loading && <LoadingSpinner />}
        {error && <ErrorState message={typeof error === 'string' ? error : 'Alpaca niet gekoppeld'} />}
        {data && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Portfoliowaarde</p>
              <p className="font-semibold text-lg">{fmtUSD(parseFloat(data.portfolio_value))}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Beschikbaar</p>
              <p className="font-semibold">{fmtUSD(parseFloat(data.buying_power))}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Contant</p>
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
  const pendingCount = (data || []).filter((s: any) => s.status === 'pending').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recente Signalen</CardTitle>
        {pendingCount > 0 && (
          <Link href="/signals" className="flex items-center gap-1 text-xs text-amber-600 font-medium hover:underline">
            {pendingCount} wachtend <ArrowRight size={11} />
          </Link>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {loading && <LoadingSpinner />}
        {error && <div className="p-4"><ErrorState message="Signalen niet beschikbaar" /></div>}
        {data?.length === 0 && <EmptyState message="Geen actieve signalen" />}
        {data?.map((s: any) => (
          <div key={s.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0">
            <div>
              <AssetLabel symbol={s.asset} className="text-sm" />
              <span className={cn('ml-2 text-xs', s.direction === 'buy' ? 'text-green-400' : 'text-red-400')}>
                {s.direction === 'buy' ? 'KOOP' : 'VERKOOP'}
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
      <CardHeader>
        <CardTitle>Actieve Geruchten</CardTitle>
        <Link href="/rumour-radar" className="text-xs text-primary hover:underline">Alles</Link>
      </CardHeader>
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
      <CardHeader>
        <CardTitle>Laatste Nieuws</CardTitle>
        <Link href="/news" className="text-xs text-primary hover:underline">Alles</Link>
      </CardHeader>
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
      <CardHeader>
        <CardTitle>Recente Activiteit</CardTitle>
        <Link href="/activity-log" className="text-xs text-primary hover:underline">Live Log</Link>
      </CardHeader>
      <CardContent className="p-0">
        {loading && <LoadingSpinner />}
        {data?.length === 0 && <EmptyState message="Geen activiteit" />}
        {data?.map((e: any) => (
          <div key={e.id} className="flex items-center justify-between px-4 py-2 border-b border-border last:border-0">
            <div>
              <span className="text-xs font-medium">{e.action.replace(/_/g, ' ')}</span>
              {e.message && <span className="text-xs text-muted-foreground ml-2 line-clamp-1">{e.message}</span>}
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
        <CardTitle>Prestaties</CardTitle>
        <Link href="/performance" className="text-xs text-primary hover:underline">Details</Link>
      </CardHeader>
      <CardContent>
        {loading && <LoadingSpinner />}
        {!loading && (
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Gemeten (5d)</p>
              <p className="text-lg font-semibold">{data?.evaluated_5d ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Hit rate</p>
              <p className={cn('text-lg font-semibold', data?.hit_rate_5d >= 50 ? 'text-green-400' : 'text-muted-foreground')}>
                {data?.hit_rate_5d == null ? '—' : `${data.hit_rate_5d.toFixed(1)}%`}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Gem. 5d</p>
              <p className={cn('text-lg font-semibold', data?.avg_pnl_5d_pct >= 0 ? 'text-green-400' : 'text-red-400')}>
                {data?.avg_pnl_5d_pct == null ? '—' : `${data.avg_pnl_5d_pct >= 0 ? '+' : ''}${data.avg_pnl_5d_pct.toFixed(2)}%`}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PnlCard() {
  const { data, loading } = useApi(() => api.getPnlSummary(), []);
  const pnlColor = (v: number) => v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-muted-foreground';
  return (
    <Card>
      <CardHeader>
        <CardTitle>P&amp;L Overzicht</CardTitle>
        <Link href="/performance" className="text-xs text-primary hover:underline">Details</Link>
      </CardHeader>
      <CardContent>
        {loading && <LoadingSpinner />}
        {!loading && (
          <>
            <div className="grid grid-cols-3 gap-3 text-sm mb-3">
              <div>
                <p className="text-xs text-muted-foreground">Vandaag</p>
                <p className={cn('text-lg font-semibold', pnlColor(data?.today_pnl ?? 0))}>
                  {data?.today_pnl == null ? '—' : `${data.today_pnl >= 0 ? '+' : ''}$${data.today_pnl.toFixed(2)}`}
                </p>
                <p className="text-xs text-muted-foreground">{data?.today_trades ?? 0} trades</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Deze week</p>
                <p className={cn('text-lg font-semibold', pnlColor(data?.week_pnl ?? 0))}>
                  {data?.week_pnl == null ? '—' : `${data.week_pnl >= 0 ? '+' : ''}$${data.week_pnl.toFixed(2)}`}
                </p>
                <p className="text-xs text-muted-foreground">{data?.week_trades ?? 0} trades</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Totaal</p>
                <p className={cn('text-lg font-semibold', pnlColor(data?.total_pnl ?? 0))}>
                  {data?.total_pnl == null ? '—' : `${data.total_pnl >= 0 ? '+' : ''}$${data.total_pnl.toFixed(2)}`}
                </p>
                <p className="text-xs text-muted-foreground">{data?.open_trades ?? 0} open</p>
              </div>
            </div>
            {data?.daily?.length > 0 && (
              <div className="space-y-1">
                {data.daily.map((d: any) => (
                  <div key={d.date} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{d.date}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">{d.trade_count} trades</span>
                      <span className={cn('font-medium', pnlColor(d.pnl))}>
                        {d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && !data?.daily?.length && (
              <p className="text-xs text-muted-foreground text-center py-2">Nog geen gesloten trades</p>
            )}
          </>
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
        <CardTitle>AI Feedback</CardTitle>
        <span className="text-xs text-muted-foreground">Ververst elke 30 sec</span>
      </CardHeader>
      <CardContent className="p-0">
        {loading && <LoadingSpinner />}
        {!loading && feedback.length === 0 && <EmptyState message="Nog geen AI feedback of gemeten uitkomsten." />}
        {feedback.map(item => (
          <div key={`${item.kind}-${item.id}`} className="border-b border-border px-4 py-2.5 last:border-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={item.kind === 'outcome' ? 'success' : item.kind === 'lesson' ? 'default' : 'muted'}>
                  {item.kind === 'outcome' ? 'uitkomst' : item.kind === 'lesson' ? 'les' : item.kind}
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

      {/* Bot status — volledige breedte */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BotStatusCard />
      </div>

      {/* Account + P&L + Prestaties */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AccountCard />
        <PnlCard />
        <PerformanceSnapshot />
      </div>

      {/* Signalen + Systeemstatus */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatusGrid />
        <SignalsCard />
        <RumoursCard />
      </div>

      {/* AI Feedback + Audit */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AiFeedbackCard />
        <AuditCard />
      </div>

      {/* Nieuws onderaan */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <NewsCard />
      </div>
    </div>
  );
}
