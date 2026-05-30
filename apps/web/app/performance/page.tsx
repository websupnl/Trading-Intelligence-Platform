'use client';

import { useState } from 'react';
import { AssetLabel } from '@/components/market/AssetLabel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { cn, fmtDate, fmtUSD } from '@/lib/utils';
import { useToast } from '@/contexts/toast';
import { TrendingUp, TrendingDown, Trophy, AlertTriangle } from 'lucide-react';

function pct(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function fmtUSDSigned(v: number | null | undefined) {
  if (v == null) return '-';
  return `${v >= 0 ? '+' : ''}${fmtUSD(Math.abs(v))}`;
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn('mt-1 text-xl font-mono font-semibold tabular-nums', tone)}>{value}</p>
        {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// SVG equity curve from cumulative P&L series
function PnLCurve({ series }: { series: { date: string; cumulative: number; pnl: number; symbol: string }[] }) {
  const W = 600, H = 100, PAD = 8;
  if (!series || series.length < 2) return (
    <div className="h-[100px] flex items-center justify-center text-xs text-muted-foreground">
      Niet genoeg data voor grafiek
    </div>
  );
  const vals = series.map(d => d.cumulative);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const range = max - min || 1;
  const pts = series.map((d, i) => {
    const x = PAD + (i / (series.length - 1)) * (W - PAD * 2);
    const y = (H - PAD) - ((d.cumulative - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const zeroY = (H - PAD) - ((0 - min) / range) * (H - PAD * 2);
  const isUp = vals[vals.length - 1] >= 0;
  const color = isUp ? '#22c55e' : '#ef4444';
  const firstPt = pts[0], lastPt = pts[pts.length - 1];
  const area = `M${PAD},${zeroY.toFixed(1)} L${firstPt} ${pts.map(p => `L${p}`).join(' ')} L${W - PAD},${zeroY.toFixed(1)} Z`;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
      <defs>
        <linearGradient id="pnl-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Zero line */}
      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="4 3" />
      <path d={area} fill="url(#pnl-grad)" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastPt.split(',')[0]} cy={lastPt.split(',')[1]} r="3.5" fill={color} />
    </svg>
  );
}

function TradeCard({ trade, icon, label }: { trade: any; icon: React.ReactNode; label: string }) {
  if (!trade) return null;
  const isUp = trade.pnl >= 0;
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
      <div className="shrink-0 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-mono font-semibold text-sm">{trade.symbol}</p>
        <p className="text-[10px] text-muted-foreground">{fmtDate(trade.date)}</p>
      </div>
      <div className={cn('font-mono font-bold text-sm tabular-nums', isUp ? 'text-green-400' : 'text-red-400')}>
        {fmtUSDSigned(trade.pnl)}
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const { data: realized, loading: realizedLoading, reload: reloadRealized } = useApi(() => api.getPerformance(), [], { pollIntervalMs: 20000 });
  const { data: summary, loading: summaryLoading } = useApi(() => api.getOutcomeSummary(), [], { pollIntervalMs: 20000 });
  const { data: outcomes, loading: outcomesLoading } = useApi(() => api.getSignalOutcomes(), [], { pollIntervalMs: 20000 });
  const [syncing, setSyncing] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const { toast } = useToast();

  async function handleSyncTrades() {
    setSyncing(true);
    try {
      const r = await api.syncTrades();
      toast(`✅ Trade sync: ${r.created ?? 0} nieuw, ${r.closed ?? 0} gesloten`, 'success');
      await reloadRealized();
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'Sync mislukt'}`, 'error');
    } finally {
      setSyncing(false);
    }
  }

  async function handleEvaluate() {
    setEvaluating(true);
    try {
      const r = await api.evaluateOutcomes();
      toast(`✅ ${r.outcomes_updated ?? 0} signalen bijgewerkt`, 'success');
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'Evaluatie mislukt'}`, 'error');
    } finally {
      setEvaluating(false);
    }
  }

  const r = realized;
  const winRate = r?.win_rate ?? 0;
  const pnlTone = (v: number | null | undefined) => v == null ? undefined : v >= 0 ? 'text-green-400' : 'text-red-400';
  const rr = r?.avg_win && r?.avg_loss ? Math.abs(r.avg_win / r.avg_loss) : null;

  return (
    <div className="space-y-5 pb-20 md:pb-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold">Performance</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Gerealiseerde trade resultaten</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSyncTrades} disabled={syncing}>
            {syncing ? '⏳' : '🔄'} Sync Trades
          </Button>
          <Button variant="outline" size="sm" onClick={handleEvaluate} disabled={evaluating}>
            {evaluating ? '⏳' : '📊'} Outcomes
          </Button>
        </div>
      </div>

      {/* Stats grid */}
      {realizedLoading ? <LoadingSpinner /> : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Win rate"
            value={r?.total_trades ? `${winRate.toFixed(1)}%` : '-'}
            sub={r?.total_trades ? `${r.winning_trades}W / ${r.losing_trades}L` : undefined}
            tone={!r?.total_trades ? undefined : winRate >= 50 ? 'text-green-400' : 'text-red-400'}
          />
          <StatCard
            label="Totaal P&L"
            value={r?.total_trades ? fmtUSD(r.total_pnl) : '-'}
            tone={pnlTone(r?.total_pnl)}
          />
          <StatCard
            label="Gem. win / verlies"
            value={r?.avg_win != null ? `${fmtUSD(r.avg_win)} / ${fmtUSD(Math.abs(r.avg_loss ?? 0))}` : '-'}
            sub={rr != null ? `R/R: ${rr.toFixed(2)}` : undefined}
            tone={rr != null ? (rr >= 1.5 ? 'text-green-400' : rr >= 1 ? 'text-yellow-400' : 'text-red-400') : undefined}
          />
          <StatCard
            label="Profit factor"
            value={r?.profit_factor != null && r.total_trades ? r.profit_factor.toFixed(2) : '-'}
            sub={r?.avg_pnl != null ? `Gem. per trade: ${fmtUSD(r.avg_pnl)}` : undefined}
            tone={r?.profit_factor != null && r.total_trades ? (r.profit_factor >= 1 ? 'text-green-400' : 'text-red-400') : undefined}
          />
        </div>
      )}

      {/* P&L equity curve */}
      {r?.pnl_series && r.pnl_series.length >= 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Equity curve (gerealiseerd)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <PnLCurve series={r.pnl_series} />
            <div className="mt-2 flex justify-between text-[10px] font-mono text-muted-foreground">
              <span>{fmtDate(r.pnl_series[0]?.date)}</span>
              <span className={cn('font-semibold', r.total_pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                {fmtUSDSigned(r.total_pnl)}
              </span>
              <span>{fmtDate(r.pnl_series[r.pnl_series.length - 1]?.date)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Best / worst trade */}
      {(r?.best_trade || r?.worst_trade) && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TradeCard trade={r.best_trade} icon={<Trophy size={16} className="text-yellow-400" />} label="Beste trade" />
          <TradeCard trade={r.worst_trade} icon={<AlertTriangle size={16} className="text-red-400" />} label="Slechtste trade" />
        </div>
      )}

      {/* Shadow signal outcomes */}
      <div>
        <h2 className="mb-2 text-sm font-medium">Shadow signal outcomes</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Alle gegenereerde signalen gemeten na 1 en 5 handelsdagen — ook niet-uitgevoerde.
        </p>
        {summaryLoading ? <LoadingSpinner /> : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Getraceerd" value={`${summary?.tracked ?? 0}`} />
            <StatCard
              label="5d hit rate"
              value={summary?.hit_rate_5d == null ? '-' : `${summary.hit_rate_5d.toFixed(1)}%`}
              tone={summary?.hit_rate_5d == null ? undefined : summary.hit_rate_5d >= 50 ? 'text-green-400' : 'text-red-400'}
            />
            <StatCard
              label="Gem. 5d resultaat"
              value={pct(summary?.avg_pnl_5d_pct)}
              tone={pnlTone(summary?.avg_pnl_5d_pct)}
            />
            <StatCard
              label="Gem. vs SPY"
              value={pct(summary?.avg_excess_return_5d)}
              tone={pnlTone(summary?.avg_excess_return_5d)}
            />
          </div>
        )}
      </div>

      {/* Outcomes table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Signaaluitkomsten</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {outcomesLoading && <LoadingSpinner />}
          {!outcomesLoading && (!outcomes || outcomes.length === 0) && (
            <div className="p-6 text-center space-y-1">
              <p className="text-sm text-muted-foreground">Nog geen signaaluitkomsten.</p>
              <p className="text-xs text-muted-foreground">Klik <strong>Outcomes</strong> na minimaal 1 handelsdag.</p>
            </div>
          )}
          {outcomes && outcomes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Asset</th>
                    <th className="px-4 py-2 text-left">Dir</th>
                    <th className="px-4 py-2 text-right">Entry</th>
                    <th className="px-4 py-2 text-right">1d</th>
                    <th className="px-4 py-2 text-right">5d</th>
                    <th className="px-4 py-2 text-right">MFE/MAE</th>
                    <th className="px-4 py-2 text-right">vs SPY</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomes.map((item: any) => (
                    <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2">
                        <AssetLabel symbol={item.symbol} />
                        <p className="text-[10px] text-muted-foreground">{fmtDate(item.signal_created_at)}</p>
                      </td>
                      <td className="px-4 py-2 uppercase font-mono">{item.direction}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtUSD(item.entry_price)}</td>
                      <td className={cn('px-4 py-2 text-right font-mono tabular-nums', item.pnl_1d_pct == null ? 'text-muted-foreground' : item.pnl_1d_pct >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {pct(item.pnl_1d_pct)}
                      </td>
                      <td className={cn('px-4 py-2 text-right font-mono tabular-nums', item.pnl_5d_pct == null ? 'text-muted-foreground' : item.pnl_5d_pct >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {pct(item.pnl_5d_pct)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-[10px]">
                        <span className="text-green-400">{pct(item.mfe_pct)}</span>
                        {' / '}
                        <span className="text-red-400">{pct(item.mae_pct)}</span>
                      </td>
                      <td className={cn('px-4 py-2 text-right font-mono tabular-nums', item.excess_return_5d == null ? 'text-muted-foreground' : item.excess_return_5d >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {pct(item.excess_return_5d)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
