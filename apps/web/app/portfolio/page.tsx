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
import { TrendingUp, TrendingDown, RefreshCw, XCircle, BarChart2, Wallet, Zap } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

// ── Custom tooltips ────────────────────────────────────────────────────────────

function EquityTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card/95 px-3 py-2 text-[11px] font-mono shadow-xl">
      <p className="text-muted-foreground text-[10px]">{payload[0]?.payload?.label}</p>
      <p className="font-bold text-foreground">{fmtUSD(payload[0]?.value)}</p>
    </div>
  );
}

function PnlTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value as number;
  return (
    <div className="rounded-lg border border-border bg-card/95 px-3 py-2 text-[11px] font-mono shadow-xl">
      <p className="text-muted-foreground text-[10px]">{payload[0]?.payload?.label}</p>
      <p className={cn('font-bold', v >= 0 ? 'text-green-400' : 'text-red-400')}>
        {v >= 0 ? '+' : ''}{fmtUSD(v)}
      </p>
    </div>
  );
}

// ── PositionCard ───────────────────────────────────────────────────────────────

function PositionCard({ pos, onClose, closing }: { pos: any; onClose: (s: string) => void; closing: string | null }) {
  const pnl = parseFloat(pos.unrealized_pl ?? 0);
  const pnlPct = parseFloat(pos.unrealized_plpc ?? 0) * 100;
  const entry = parseFloat(pos.avg_entry_price ?? 0);
  const current = parseFloat(pos.current_price ?? 0);
  const qty = parseFloat(pos.qty ?? 0);
  const sym = (pos.symbol ?? '').split('/')[0];
  const isUp = pnl >= 0;

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/10 transition-colors',
    )}>
      <div className={cn('w-1 self-stretch rounded-full shrink-0', isUp ? 'bg-green-500' : 'bg-red-400')} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold">{sym}</span>
          <span className={cn(
            'text-[9px] font-bold px-1.5 py-0.5 rounded font-mono',
            pos.side === 'long' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-400',
          )}>{(pos.side ?? 'LONG').toUpperCase()}</span>
        </div>
        <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
          {qty < 1 ? qty.toFixed(4) : qty.toFixed(2)} @ ${entry.toFixed(2)}
          <span className="mx-1.5 opacity-40">·</span>
          Nu ${current.toFixed(2)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={cn('font-mono font-bold tabular-nums', isUp ? 'text-green-400' : 'text-red-400')}>
          {isUp ? '+' : ''}{fmtUSD(pnl)}
        </p>
        <p className={cn('text-[10px] font-mono', isUp ? 'text-green-400' : 'text-red-400')}>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { data: account, loading: acctLoading } = useApi(() => api.getAccount(), [], { pollIntervalMs: 10000 });
  const { data: positions, loading: posLoading, reload: reloadPositions } = useApi(() => api.getPositions(), [], { pollIntervalMs: 10000 });
  const { data: perf, reload: reloadPerf } = useApi(() => api.getPerformance(), [], { pollIntervalMs: 15000 });
  const { data: trades } = useApi(() => api.getTrades(50), [], { pollIntervalMs: 15000 });
  const { data: history } = useApi(() => api.getPortfolioHistory('1M'), [], { pollIntervalMs: 60000 });

  const [closing, setClosing] = useState<string | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const flash = (text: string, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  const totalUnrealizedPnl = useMemo(() =>
    (positions as any[] ?? []).reduce((s: number, p: any) => s + parseFloat(p.unrealized_pl ?? 0), 0),
    [positions]);

  // Build recharts-friendly equity history
  const equityData = useMemo(() => {
    if (!history?.equity || !(history.equity as number[]).length) return [];
    const equities = history.equity as number[];
    const timestamps = (history.timestamp as number[] | undefined) ?? [];
    return equities.map((e, i) => ({
      label: timestamps[i]
        ? new Date(timestamps[i] * 1000).toLocaleDateString('nl-NL', { month: 'short', day: 'numeric' })
        : `D${i + 1}`,
      equity: Math.round(e * 100) / 100,
    }));
  }, [history]);

  const equityIsUp = useMemo(() => {
    if (equityData.length < 2) return true;
    return equityData[equityData.length - 1].equity >= equityData[0].equity;
  }, [equityData]);

  const equityChange = useMemo(() => {
    if (equityData.length < 2) return null;
    const first = equityData[0].equity;
    const last = equityData[equityData.length - 1].equity;
    if (!first) return null;
    return { abs: last - first, pct: ((last - first) / first) * 100 };
  }, [equityData]);

  // Build cumulative P&L from trade history
  const pnlData = useMemo(() => {
    const closedTrades = (trades as any[] ?? [])
      .filter((t: any) => t.status === 'closed' && t.pnl != null)
      .sort((a: any, b: any) => new Date(a.closed_at).getTime() - new Date(b.closed_at).getTime());
    let cum = 0;
    return closedTrades.map((t: any) => {
      cum += t.pnl;
      return {
        label: new Date(t.closed_at).toLocaleDateString('nl-NL', { month: 'short', day: 'numeric' }),
        cum: Math.round(cum * 100) / 100,
        pnl: Math.round(t.pnl * 100) / 100,
        symbol: t.symbol,
      };
    });
  }, [trades]);

  const pnlIsUp = pnlData.length > 0 ? pnlData[pnlData.length - 1].cum >= 0 : true;
  const perfData = perf as any;
  const hasTrades = perfData?.total_trades > 0;

  async function handleClose(symbol: string) {
    setClosing(symbol);
    try {
      await api.closePosition(symbol);
      flash(`${symbol} gesloten`);
      reloadPositions();
    } catch (e: any) { flash(e?.detail || 'Fout', false); }
    finally { setClosing(null); }
  }

  async function handleCloseAll() {
    if (!confirm('Alle posities sluiten?')) return;
    setClosingAll(true);
    try {
      const r = await api.closeAllPositions();
      flash(`${r.closed} posities gesloten`);
      reloadPositions();
    } catch (e: any) { flash(e?.detail || 'Fout', false); }
    finally { setClosingAll(false); }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await api.syncTrades();
      flash(`Sync: ${r.created} nieuw, ${r.closed} gesloten`);
      reloadPerf();
    } catch (e: any) { flash(e?.detail || 'Fout', false); }
    finally { setSyncing(false); }
  }

  return (
    <div className="space-y-4 pb-6 max-w-7xl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-base font-semibold flex items-center gap-2">
          <Wallet size={16} className="text-blue-400" /> Portfolio
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="h-7 text-[11px] gap-1">
            <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} /> Sync
          </Button>
          <Button variant="outline" size="sm" onClick={handleCloseAll} disabled={closingAll} className="h-7 text-[11px] gap-1 text-red-400 hover:text-red-500 border-red-400/30">
            <XCircle size={11} /> Sluit Alles
          </Button>
        </div>
      </div>

      {msg && (
        <div className={cn('px-3 py-2 rounded-lg text-[11px] font-mono border', msg.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-400/30 text-red-400')}>
          {msg.text}
        </div>
      )}

      {/* ── Account stats ─────────────────────────────────────────────────── */}
      {!acctLoading && account && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: 'Portfolio Value',
              value: fmtUSD(parseFloat(account.portfolio_value)),
              sub: equityChange ? `${equityChange.pct >= 0 ? '+' : ''}${equityChange.pct.toFixed(2)}% (1M)` : '1 maand',
              tone: equityChange ? (equityChange.pct >= 0 ? 'text-green-400' : 'text-red-400') : 'text-foreground',
            },
            {
              label: 'Unrealized P&L',
              value: `${totalUnrealizedPnl >= 0 ? '+' : ''}${fmtUSD(totalUnrealizedPnl)}`,
              sub: `${(positions as any[] ?? []).length} open posities`,
              tone: totalUnrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400',
            },
            { label: 'Buying Power', value: fmtUSD(parseFloat(account.buying_power)), sub: 'beschikbaar', tone: 'text-foreground' },
            { label: 'Cash', value: fmtUSD(parseFloat(account.cash)), sub: 'liquide', tone: 'text-foreground' },
          ].map(item => (
            <div key={item.label} className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
              <p className={cn('text-xl font-bold font-mono mt-0.5 tabular-nums', item.tone)}>{item.value}</p>
              <p className={cn('text-[10px] font-mono', item.tone === 'text-foreground' ? 'text-muted-foreground' : item.tone)}>{item.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Equity curve ──────────────────────────────────────────────────── */}
      {equityData.length > 2 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
              Equity curve — 1 maand
            </p>
            {equityChange && (
              <span className={cn('text-sm font-mono font-bold', equityIsUp ? 'text-green-400' : 'text-red-400')}>
                {equityChange.pct >= 0 ? '+' : ''}{equityChange.pct.toFixed(2)}%
                <span className="text-muted-foreground font-normal text-[11px] ml-1">
                  ({equityChange.abs >= 0 ? '+' : ''}{fmtUSD(equityChange.abs)})
                </span>
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={equityData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={equityIsUp ? '#22c55e' : '#ef4444'} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={equityIsUp ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'monospace' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'monospace' }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} domain={['auto', 'auto']} />
              <Tooltip content={<EquityTooltip />} />
              <Area
                type="monotone"
                dataKey="equity"
                stroke={equityIsUp ? '#22c55e' : '#ef4444'}
                strokeWidth={2}
                fill="url(#eq-grad)"
                dot={false}
                activeDot={{ r: 4, fill: equityIsUp ? '#22c55e' : '#ef4444', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Performance stats + P&L curve ─────────────────────────────────── */}
      {hasTrades && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
            Trade Performance
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Win Rate', value: `${perfData.win_rate.toFixed(1)}%`, tone: perfData.win_rate >= 50 ? 'text-green-400' : 'text-red-400', sub: `${perfData.winning_trades}W · ${perfData.losing_trades}L` },
              { label: 'Totaal P&L', value: fmtUSD(perfData.total_pnl), tone: perfData.total_pnl >= 0 ? 'text-green-400' : 'text-red-400' },
              { label: 'Gem. P&L', value: fmtUSD(perfData.avg_pnl), tone: perfData.avg_pnl >= 0 ? 'text-green-400' : 'text-red-400', sub: `${perfData.total_trades} trades` },
              { label: 'Profit Factor', value: perfData.profit_factor?.toFixed(2) ?? '—', tone: (perfData.profit_factor ?? 0) >= 1 ? 'text-green-400' : 'text-red-400' },
            ].map(item => (
              <div key={item.label} className="bg-muted/30 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                <p className={cn('text-lg font-bold font-mono mt-0.5 tabular-nums', item.tone)}>{item.value}</p>
                {item.sub && <p className="text-[10px] text-muted-foreground font-mono">{item.sub}</p>}
              </div>
            ))}
          </div>

          {/* Cumulative P&L curve from trade history */}
          {pnlData.length > 1 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  Cumulatief P&L ({pnlData.length} trades)
                </p>
                <span className={cn('text-sm font-mono font-bold', pnlIsUp ? 'text-green-400' : 'text-red-400')}>
                  {pnlData[pnlData.length - 1].cum >= 0 ? '+' : ''}{fmtUSD(pnlData[pnlData.length - 1].cum)}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={pnlData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cum-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={pnlIsUp ? '#22c55e' : '#ef4444'} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={pnlIsUp ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#64748b', fontFamily: 'monospace' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: '#64748b', fontFamily: 'monospace' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} domain={['auto', 'auto']} />
                  <Tooltip content={<PnlTooltip />} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4" />
                  <Area
                    type="monotone"
                    dataKey="cum"
                    stroke={pnlIsUp ? '#22c55e' : '#ef4444'}
                    strokeWidth={2}
                    fill="url(#cum-grad)"
                    dot={false}
                    activeDot={{ r: 3, fill: pnlIsUp ? '#22c55e' : '#ef4444', strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ── Open positions ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Wallet size={12} /> Open Posities
          </p>
          <div className="flex items-center gap-2">
            {(positions as any[] ?? []).length > 0 && (
              <span className={cn('text-sm font-mono font-bold', totalUnrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                {totalUnrealizedPnl >= 0 ? '+' : ''}{fmtUSD(totalUnrealizedPnl)}
              </span>
            )}
            <Badge variant={(positions as any[] ?? []).length > 0 ? 'success' : 'muted'}>
              {(positions as any[] ?? []).length}
            </Badge>
          </div>
        </div>
        {posLoading && <div className="p-4"><LoadingSpinner /></div>}
        {!posLoading && (!(positions as any[])?.length) && (
          <div className="py-10 text-center text-muted-foreground text-sm">Geen open posities</div>
        )}
        {(positions as any[] ?? []).map((p: any) => (
          <PositionCard key={p.asset_id ?? p.symbol} pos={p} onClose={handleClose} closing={closing} />
        ))}
      </div>

      {/* ── Trade history ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Zap size={12} /> Trade Geschiedenis
          </p>
          <Badge variant="muted">{(trades as any[] ?? []).length}</Badge>
        </div>
        {!trades || !(trades as any[]).length ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            Geen trades gevonden. Klik <strong>Sync</strong> om Alpaca orders te importeren.
          </div>
        ) : (
          (trades as any[]).slice(0, 30).map((t: any) => (
            <div key={t.id} className="px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/10 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm">{t.symbol}</span>
                  <span className={cn(
                    'text-[9px] font-bold px-1.5 py-0.5 rounded font-mono',
                    t.side === 'buy' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-400',
                  )}>{t.side?.toUpperCase()}</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono">{t.status}</span>
                  {t.mode === 'paper' && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-500 font-mono">paper</span>}
                </div>
                {t.pnl != null && (
                  <span className={cn('font-mono font-bold text-sm tabular-nums', t.pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {t.pnl >= 0 ? '+' : ''}{fmtUSD(t.pnl)}
                    {t.pnl_pct != null && (
                      <span className="text-[10px] font-normal opacity-60 ml-1">
                        ({t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct?.toFixed(1)}%)
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex gap-3 mt-1 text-[10px] font-mono text-muted-foreground">
                {t.entry_price && <span>In ${t.entry_price.toFixed(2)}</span>}
                {t.exit_price && <span>Uit ${t.exit_price.toFixed(2)}</span>}
                {t.quantity && <span>{t.quantity < 1 ? t.quantity.toFixed(4) : t.quantity.toFixed(2)} stk</span>}
                {t.opened_at && <span>{fmtDate(t.opened_at)}</span>}
              </div>
              {t.ai_reflection?.lesson && (
                <p className="mt-1.5 text-[10px] text-muted-foreground border-l-2 border-primary/30 pl-2">
                  {t.ai_reflection.lesson}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
