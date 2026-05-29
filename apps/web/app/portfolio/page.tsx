'use client';
import { useState, useMemo } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtUSD, fmtDate, cn } from '@/lib/utils';
import { AssetLabel } from '@/components/market/AssetLabel';
import { TrendingUp, TrendingDown, RefreshCw, XCircle, BarChart2, Wallet, Zap } from 'lucide-react';

// ── SVG equity line chart ───────────────────────────────────────────────────

function EquityChart({ data }: { data: { timestamp: number; equity: number }[] }) {
  const W = 600, H = 80, PAD = 4;
  if (!data || data.length < 2) return null;
  const equities = data.map(d => d.equity);
  const min = Math.min(...equities), max = Math.max(...equities);
  const range = max - min || 1;
  const pts = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((d.equity - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const isUp = equities[equities.length - 1] >= equities[0];
  const color = isUp ? '#22c55e' : '#ef4444';
  const firstPt = pts[0], lastPt = pts[pts.length - 1];
  const area = `M${PAD},${H} L${firstPt} ${pts.map(p => `L${p}`).join(' ')} L${W - PAD},${H} Z`;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
      <defs>
        <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#eq-grad)" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* Current value dot */}
      <circle cx={lastPt.split(',')[0]} cy={lastPt.split(',')[1]} r="3" fill={color} />
    </svg>
  );
}

// ── Position card ───────────────────────────────────────────────────────────

function PositionCard({ pos, onClose, closing }: { pos: any; onClose: (s: string) => void; closing: string | null }) {
  const pnl = parseFloat(pos.unrealized_pl ?? 0);
  const pnlPct = parseFloat(pos.unrealized_plpc ?? 0) * 100;
  const entry = parseFloat(pos.avg_entry_price ?? 0);
  const current = parseFloat(pos.current_price ?? 0);
  const qty = parseFloat(pos.qty ?? 0);
  const isUp = pnl >= 0;
  const sym = (pos.symbol ?? '').split('/')[0];

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 transition-colors hover:bg-muted/20',
      isUp ? 'border-l-2 border-l-green-500/30' : 'border-l-2 border-l-red-400/30',
    )}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-sm">{sym}</span>
          <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded font-mono',
            pos.side === 'long' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'
          )}>{(pos.side ?? 'LONG').toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] font-mono text-muted-foreground">
          <span>{qty < 1 ? qty.toFixed(4) : qty.toFixed(2)} @ ${entry.toFixed(2)}</span>
          <span className="text-foreground/70">Nu: ${current.toFixed(2)}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={cn('flex items-center gap-1 justify-end font-mono font-bold text-sm tabular-nums', isUp ? 'text-green-500' : 'text-red-400')}>
          {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {isUp ? '+' : ''}{fmtUSD(pnl)}
        </div>
        <p className={cn('text-[10px] font-mono tabular-nums', isUp ? 'text-green-400' : 'text-red-400')}>
          {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
        </p>
      </div>
      <button
        onClick={() => onClose(sym)}
        disabled={closing === sym}
        className="h-7 px-2.5 text-[10px] font-mono rounded border border-border text-muted-foreground hover:border-red-400/60 hover:text-red-400 transition-colors disabled:opacity-40 shrink-0"
      >
        {closing === sym ? '…' : 'Sluit'}
      </button>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { data: account, loading: acctLoading } = useApi(() => api.getAccount(), [], { pollIntervalMs: 10000 });
  const { data: positions, loading: posLoading, reload: reloadPositions } = useApi(() => api.getPositions(), [], { pollIntervalMs: 10000 });
  const { data: perf, reload: reloadPerf } = useApi(() => api.getPerformance(), [], { pollIntervalMs: 15000 });
  const { data: trades } = useApi(() => api.getTrades(50), [], { pollIntervalMs: 15000 });
  const { data: history } = useApi(() => api.getPortfolioHistory('1M'), [], { pollIntervalMs: 60000 });

  const [closing, setClosing] = useState<string | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000); };

  const totalUnrealizedPnl = useMemo(() =>
    (positions as any[] ?? []).reduce((s: number, p: any) => s + parseFloat(p.unrealized_pl ?? 0), 0), [positions]);

  const equityData = useMemo(() => {
    if (!history?.equity) return [];
    return (history.equity as number[]).map((e: number, i: number) => ({
      timestamp: i,
      equity: e,
    }));
  }, [history]);

  const equityChange = useMemo(() => {
    if (equityData.length < 2) return null;
    const first = equityData[0].equity, last = equityData[equityData.length - 1].equity;
    if (!first) return null;
    return { abs: last - first, pct: ((last - first) / first) * 100 };
  }, [equityData]);

  async function handleClose(symbol: string) {
    setClosing(symbol);
    try {
      await api.closePosition(symbol);
      flash(`✓ ${symbol} gesloten`);
      reloadPositions();
    } catch (e: any) { flash(`✗ ${e?.detail || 'Fout'}`); }
    finally { setClosing(null); }
  }

  async function handleCloseAll() {
    if (!confirm('ALLE posities sluiten?')) return;
    setClosingAll(true);
    try {
      const r = await api.closeAllPositions();
      flash(`✓ ${r.closed} posities gesloten`);
      reloadPositions();
    } catch (e: any) { flash(`✗ ${e?.detail || 'Fout'}`); }
    finally { setClosingAll(false); }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await api.syncTrades();
      flash(`✓ Sync: ${r.created} nieuw, ${r.closed} gesloten`);
      reloadPerf();
    } catch (e: any) { flash(`✗ ${e?.detail || 'Fout'}`); }
    finally { setSyncing(false); }
  }

  return (
    <div className="space-y-4 pb-20 md:pb-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-base font-semibold">Portfolio</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="gap-1.5">
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> Sync
          </Button>
          <Button variant="outline" size="sm" onClick={handleCloseAll} disabled={closingAll} className="gap-1.5 text-red-500 hover:text-red-600 border-red-200">
            <XCircle size={12} /> Sluit Alles
          </Button>
        </div>
      </div>

      {msg && <div className={cn('px-3 py-2 rounded-lg text-sm border', msg.startsWith('✓') ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700')}>{msg}</div>}

      {/* Account stats + equity chart */}
      {!acctLoading && account && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-border border-b border-border">
              {[
                { label: 'Portfolio Value', value: fmtUSD(parseFloat(account.portfolio_value)), sub: equityChange ? `${equityChange.pct >= 0 ? '+' : ''}${equityChange.pct.toFixed(2)}% (1M)` : undefined, color: equityChange ? (equityChange.pct >= 0 ? 'text-green-500' : 'text-red-400') : undefined },
                { label: 'Unrealized P&L', value: `${totalUnrealizedPnl >= 0 ? '+' : ''}${fmtUSD(totalUnrealizedPnl)}`, color: totalUnrealizedPnl >= 0 ? 'text-green-500' : 'text-red-400' },
                { label: 'Buying Power', value: fmtUSD(parseFloat(account.buying_power)) },
                { label: 'Cash', value: fmtUSD(parseFloat(account.cash)) },
              ].map(item => (
                <div key={item.label} className="px-4 py-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                  <p className={cn('text-lg font-bold font-mono mt-0.5 tabular-nums', item.color ?? 'text-foreground')}>{item.value}</p>
                  {item.sub && <p className={cn('text-[10px] font-mono', item.color ?? 'text-muted-foreground')}>{item.sub}</p>}
                </div>
              ))}
            </div>
            {/* Equity chart */}
            {equityData.length > 1 && (
              <div className="px-0 pt-1 pb-0">
                <EquityChart data={equityData} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Performance stats */}
      {perf && perf.total_trades > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2"><BarChart2 size={14} /><CardTitle>Performance</CardTitle></div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Win Rate', value: `${perf.win_rate}%`, sub: `${perf.winning_trades}W / ${perf.losing_trades}L`, color: perf.win_rate >= 50 ? 'text-green-500' : 'text-red-400' },
                { label: 'Totaal P&L', value: fmtUSD(perf.total_pnl), color: perf.total_pnl >= 0 ? 'text-green-500' : 'text-red-400' },
                { label: 'Gem. P&L', value: fmtUSD(perf.avg_pnl), sub: `Win ${fmtUSD(perf.avg_win)} · Loss ${fmtUSD(perf.avg_loss)}`, color: perf.avg_pnl >= 0 ? 'text-green-500' : 'text-red-400' },
                { label: 'Profit Factor', value: perf.profit_factor?.toFixed(2) ?? '—', color: perf.profit_factor >= 1 ? 'text-green-500' : 'text-red-400' },
              ].map(item => (
                <div key={item.label} className="bg-muted/30 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                  <p className={cn('text-lg font-bold font-mono mt-0.5', item.color)}>{item.value}</p>
                  {item.sub && <p className="text-[10px] text-muted-foreground font-mono">{item.sub}</p>}
                </div>
              ))}
            </div>

            {/* P&L cumulative SVG chart */}
            {perf.pnl_series?.length > 1 && (() => {
              const series = perf.pnl_series.slice(-40);
              const vals = series.map((p: any) => p.cumulative);
              const min = Math.min(...vals), max = Math.max(...vals);
              const rng = max - min || 1;
              const W = 600, H = 60, PAD = 4;
              const pts = series.map((p: any, i: number) => {
                const x = PAD + (i / (series.length - 1)) * (W - PAD * 2);
                const y = H - PAD - ((p.cumulative - min) / rng) * (H - PAD * 2);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              });
              const isUp = vals[vals.length - 1] >= 0;
              const color = isUp ? '#22c55e' : '#ef4444';
              return (
                <div className="mt-4">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Cumulatief P&L ({series.length} trades)</p>
                  <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block rounded overflow-hidden">
                    <defs>
                      <linearGradient id="pnl-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.2" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={`M${PAD},${H} L${pts[0]} ${pts.map((p: string) => `L${p}`).join(' ')} L${W - PAD},${H} Z`} fill="url(#pnl-grad)" />
                    <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  </svg>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Open positions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><Wallet size={14} /><CardTitle>Open Posities</CardTitle></div>
          <div className="flex items-center gap-2">
            {positions?.length > 0 && (
              <span className={cn('text-sm font-mono font-bold tabular-nums', totalUnrealizedPnl >= 0 ? 'text-green-500' : 'text-red-400')}>
                {totalUnrealizedPnl >= 0 ? '+' : ''}{fmtUSD(totalUnrealizedPnl)}
              </span>
            )}
            <Badge variant={positions?.length > 0 ? 'success' : 'muted'}>{positions?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {posLoading && <LoadingSpinner />}
          {!posLoading && (!positions || positions.length === 0) && (
            <EmptyState message="Geen open posities" />
          )}
          {(positions as any[] ?? []).map((p: any) => (
            <PositionCard key={p.asset_id ?? p.symbol} pos={p} onClose={handleClose} closing={closing} />
          ))}
        </CardContent>
      </Card>

      {/* Trade history */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><Zap size={14} /><CardTitle>Trade Geschiedenis</CardTitle></div>
          <Badge variant="muted">{(trades as any[] ?? []).length}</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {!trades || (trades as any[]).length === 0 ? (
            <EmptyState message="Geen trades. Klik Sync om Alpaca orders te importeren." />
          ) : (
            (trades as any[]).slice(0, 30).map((t: any) => (
              <div key={t.id} className="px-4 py-3 border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-sm">{t.symbol}</span>
                    <Badge variant={t.side === 'buy' ? 'success' : 'danger'}>{t.side?.toUpperCase()}</Badge>
                    <Badge variant={t.status === 'closed' ? 'muted' : 'warning'}>{t.status}</Badge>
                    {t.mode === 'paper' && <Badge variant="muted">paper</Badge>}
                  </div>
                  {t.pnl != null && (
                    <div className="flex items-center gap-1">
                      {t.pnl >= 0 ? <TrendingUp size={12} className="text-green-500" /> : <TrendingDown size={12} className="text-red-400" />}
                      <span className={cn('font-mono font-bold text-sm tabular-nums', t.pnl >= 0 ? 'text-green-500' : 'text-red-400')}>
                        {t.pnl >= 0 ? '+' : ''}{fmtUSD(t.pnl)}
                        {t.pnl_pct != null && <span className="text-xs font-normal opacity-70 ml-1">({t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct?.toFixed(1)}%)</span>}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex gap-4 mt-1 text-[11px] text-muted-foreground font-mono flex-wrap">
                  {t.entry_price && <span>In ${t.entry_price.toFixed(2)}</span>}
                  {t.exit_price && <span>Uit ${t.exit_price.toFixed(2)}</span>}
                  {t.quantity && <span>{t.quantity} stk</span>}
                  {t.opened_at && <span>{fmtDate(t.opened_at)}</span>}
                </div>
                {t.ai_reflection?.lesson && (
                  <div className="mt-2 px-2 py-1.5 rounded-md bg-primary/5 border-l-2 border-primary/30 text-[11px] text-muted-foreground">
                    💡 {t.ai_reflection.lesson}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
