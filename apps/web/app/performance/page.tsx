'use client';

import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { cn, fmtDate, fmtUSD } from '@/lib/utils';
import { useToast } from '@/contexts/toast';
import { Button } from '@/components/ui/button';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { RefreshCw, TrendingUp, TrendingDown, Target, Zap, BarChart2 } from 'lucide-react';

// ── helpers ────────────────────────────────────────────────────────────────────

function pct(v: number | null | undefined) {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}
function clr(v: number | null | undefined) {
  if (v == null) return 'text-muted-foreground';
  return v >= 0 ? 'text-green-400' : 'text-red-400';
}

// ── custom tooltip ─────────────────────────────────────────────────────────────

function PnlTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value as number;
  return (
    <div className="rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 text-[11px] font-mono shadow-xl">
      <p className="text-muted-foreground mb-0.5">{label}</p>
      <p className={cn('font-bold text-sm', val >= 0 ? 'text-green-400' : 'text-red-400')}>
        {pct(val)}
      </p>
    </div>
  );
}

function BarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value as number;
  return (
    <div className="rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 text-[11px] font-mono shadow-xl">
      <p className="font-bold">{label}</p>
      <p className={cn('font-bold', v >= 0 ? 'text-green-400' : 'text-red-400')}>{pct(v)}</p>
      <p className="text-muted-foreground text-[10px]">{payload[0]?.payload?.count} signalen</p>
    </div>
  );
}

// ── StatPill ──────────────────────────────────────────────────────────────────

function StatPill({ icon: Icon, label, value, tone, sub }: {
  icon: any; label: string; value: string; tone?: string; sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
        <Icon size={14} className={tone || 'text-muted-foreground'} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className={cn('text-lg font-bold font-mono leading-tight tabular-nums', tone)}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

// ── WinRateBar ────────────────────────────────────────────────────────────────

function WinRateBar({ winRate, total }: { winRate: number; total: number }) {
  const wins = Math.round(total * winRate / 100);
  const losses = total - wins;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="text-green-400 font-bold">{wins} wins</span>
        <span className="text-muted-foreground font-bold text-lg">{winRate.toFixed(0)}%</span>
        <span className="text-red-400 font-bold">{losses} losses</span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
        <div
          className="bg-green-500 transition-all duration-700 rounded-l-full"
          style={{ width: `${winRate}%` }}
        />
        <div className="bg-red-500 flex-1 rounded-r-full" />
      </div>
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const [tab, setTab] = useState<'trades' | 'signals'>('trades');
  const [evaluating, setEvaluating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  const { data: realized, loading: rLoading, reload: rReload } = useApi(
    () => api.getPerformance(), [], { pollIntervalMs: 30000 }
  );
  const { data: summary, reload: sReload } = useApi(
    () => api.getOutcomeSummary(), [], { pollIntervalMs: 30000 }
  );
  const { data: outcomes, loading: oLoading, reload: oReload } = useApi(
    () => api.getSignalOutcomes(), [], { pollIntervalMs: 30000 }
  );

  async function handleEvaluate() {
    setEvaluating(true);
    try {
      const r = await api.evaluateOutcomes();
      toast(`${r.outcomes_updated ?? 0} signalen bijgewerkt`, 'success');
      await Promise.all([sReload(), oReload()]);
    } catch (e: any) { toast(e?.detail || 'Mislukt', 'error'); }
    finally { setEvaluating(false); }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await api.syncTrades();
      toast(`${r.created ?? 0} nieuw, ${r.closed ?? 0} gesloten`, 'success');
      await rReload();
    } catch (e: any) { toast(e?.detail || 'Mislukt', 'error'); }
    finally { setSyncing(false); }
  }

  // ── Build cumulative P&L curve from signal outcomes ───────────────────────
  const pnlCurve: { date: string; cumPnl: number; pnl: number }[] = [];
  if (outcomes && (outcomes as any[]).length > 0) {
    let cum = 0;
    const sorted = [...(outcomes as any[])]
      .filter(o => o.pnl_5d_pct != null)
      .sort((a, b) => new Date(a.signal_created_at).getTime() - new Date(b.signal_created_at).getTime());
    for (const o of sorted) {
      cum += o.pnl_5d_pct;
      pnlCurve.push({
        date: new Date(o.signal_created_at).toLocaleDateString('nl-NL', { month: 'short', day: 'numeric' }),
        cumPnl: Math.round(cum * 10) / 10,
        pnl: Math.round(o.pnl_5d_pct * 10) / 10,
      });
    }
  }

  // ── Asset breakdown ────────────────────────────────────────────────────────
  const byAsset: { asset: string; avg: number; count: number }[] = [];
  if (outcomes && (outcomes as any[]).length > 0) {
    const map: Record<string, { sum: number; count: number }> = {};
    for (const o of (outcomes as any[])) {
      if (o.pnl_5d_pct == null) continue;
      const k = o.symbol;
      if (!map[k]) map[k] = { sum: 0, count: 0 };
      map[k].sum += o.pnl_5d_pct;
      map[k].count += 1;
    }
    for (const [asset, d] of Object.entries(map)) {
      byAsset.push({ asset, avg: Math.round(d.sum / d.count * 10) / 10, count: d.count });
    }
    byAsset.sort((a, b) => b.avg - a.avg);
  }

  const hasOutcomes = pnlCurve.length > 0;
  const hasTrades = (realized as any)?.total_trades > 0;
  const lastCum = pnlCurve[pnlCurve.length - 1]?.cumPnl ?? 0;

  return (
    <div className="space-y-4 pb-6 max-w-7xl">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2">
            <BarChart2 size={16} className="text-blue-400" /> Performance
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Gerealiseerde trades + shadow signal outcomes vs SPY
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="h-7 text-[11px] gap-1">
            <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} /> Sync Trades
          </Button>
          <Button size="sm" onClick={handleEvaluate} disabled={evaluating} className="h-7 text-[11px] gap-1">
            <Zap size={11} className={evaluating ? 'animate-spin' : ''} /> Evalueer Outcomes
          </Button>
        </div>
      </div>

      {/* ── Tab switch ─────────────────────────────────────────────────────── */}
      <div className="flex border border-border rounded-lg overflow-hidden w-fit text-[11px] font-mono">
        {(['trades', 'signals'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-1.5 font-medium transition-colors',
              tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/40',
            )}
          >
            {t === 'trades' ? 'Trades' : 'Signal Outcomes'}
          </button>
        ))}
      </div>

      {/* ══ TRADES TAB ══════════════════════════════════════════════════════ */}
      {tab === 'trades' && (
        <div className="space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatPill
              icon={TrendingUp}
              label="Gesloten Trades"
              value={String((realized as any)?.total_trades ?? 0)}
              tone="text-foreground"
            />
            <StatPill
              icon={Target}
              label="Win Rate"
              value={hasTrades ? `${(realized as any).win_rate.toFixed(1)}%` : '—'}
              tone={hasTrades ? ((realized as any).win_rate >= 50 ? 'text-green-400' : 'text-red-400') : undefined}
              sub={hasTrades ? `${Math.round((realized as any).total_trades * (realized as any).win_rate / 100)} wins` : undefined}
            />
            <StatPill
              icon={(realized as any)?.total_pnl >= 0 ? TrendingUp : TrendingDown}
              label="Totaal P&L"
              value={hasTrades ? fmtUSD((realized as any).total_pnl) : '—'}
              tone={hasTrades ? ((realized as any).total_pnl >= 0 ? 'text-green-400' : 'text-red-400') : undefined}
            />
            <StatPill
              icon={BarChart2}
              label="Profit Factor"
              value={hasTrades ? ((realized as any).profit_factor?.toFixed(2) ?? '0.00') : '—'}
              tone={hasTrades ? ((realized as any).profit_factor >= 1 ? 'text-green-400' : 'text-red-400') : undefined}
            />
          </div>

          {hasTrades && (
            <div className="rounded-xl border border-border bg-card p-4">
              <WinRateBar
                winRate={(realized as any).win_rate}
                total={(realized as any).total_trades}
              />
            </div>
          )}

          {!hasTrades && !rLoading && (
            <div className="rounded-xl border border-dashed border-border py-12 text-center">
              <p className="text-muted-foreground text-sm">Nog geen gesloten trades.</p>
              <p className="text-[11px] text-muted-foreground mt-1">Klik <strong>Sync Trades</strong> om Alpaca data op te halen.</p>
            </div>
          )}
        </div>
      )}

      {/* ══ SIGNALS TAB ═════════════════════════════════════════════════════ */}
      {tab === 'signals' && (
        <div className="space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatPill icon={Zap} label="Getraceerde Signalen" value={String((summary as any)?.tracked ?? 0)} tone="text-foreground" />
            <StatPill
              icon={Target}
              label="5d Hit Rate"
              value={(summary as any)?.hit_rate_5d == null ? '—' : `${(summary as any).hit_rate_5d.toFixed(1)}%`}
              tone={(summary as any)?.hit_rate_5d == null ? undefined : (summary as any).hit_rate_5d >= 50 ? 'text-green-400' : 'text-red-400'}
            />
            <StatPill
              icon={TrendingUp}
              label="Gem. 5d Resultaat"
              value={pct((summary as any)?.avg_pnl_5d_pct)}
              tone={clr((summary as any)?.avg_pnl_5d_pct)}
            />
            <StatPill
              icon={BarChart2}
              label="vs SPY (excess)"
              value={pct((summary as any)?.avg_excess_return_5d)}
              tone={clr((summary as any)?.avg_excess_return_5d)}
              sub="alpha vs benchmark"
            />
          </div>

          {/* P&L Curve */}
          {hasOutcomes ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                  Cumulatieve 5d P&L (signal outcomes)
                </p>
                <span className={cn('text-sm font-mono font-bold', lastCum >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {lastCum >= 0 ? '+' : ''}{lastCum.toFixed(1)}%
                </span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={pnlCurve} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnl-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={lastCum >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={lastCum >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'monospace' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip content={<PnlTooltip />} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                  <Area
                    type="monotone"
                    dataKey="cumPnl"
                    stroke={lastCum >= 0 ? '#22c55e' : '#ef4444'}
                    strokeWidth={2}
                    fill="url(#pnl-grad)"
                    dot={false}
                    activeDot={{ r: 4, fill: lastCum >= 0 ? '#22c55e' : '#ef4444' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border py-12 text-center">
              <p className="text-muted-foreground text-sm">Nog geen signal outcomes beschikbaar.</p>
              <p className="text-[11px] text-muted-foreground mt-1">Klik <strong>Evalueer Outcomes</strong> nadat candles beschikbaar zijn.</p>
            </div>
          )}

          {/* Asset breakdown */}
          {byAsset.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Gem. 5d per asset
              </p>
              <ResponsiveContainer width="100%" height={Math.max(140, byAsset.length * 28)}>
                <BarChart data={byAsset} layout="vertical" margin={{ top: 0, right: 8, left: 24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'monospace' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                  <YAxis dataKey="asset" type="category" tick={{ fontSize: 11, fill: '#94a3b8', fontFamily: 'monospace', fontWeight: 600 }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip content={<BarTooltip />} />
                  <ReferenceLine x={0} stroke="rgba(255,255,255,0.15)" />
                  <Bar dataKey="avg" radius={[0, 3, 3, 0]} maxBarSize={18}>
                    {byAsset.map((entry, i) => (
                      <Cell key={i} fill={entry.avg >= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Outcomes table */}
          {!oLoading && outcomes && (outcomes as any[]).length > 0 && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                  Alle signaaluitkomsten
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      {['Asset', 'Richting', 'Entry', '1d', '5d', 'MFE / MAE', 'vs SPY', 'Status'].map(h => (
                        <th key={h} className={cn('px-3 py-2 text-muted-foreground font-medium', h === 'Asset' ? 'text-left' : 'text-right')}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(outcomes as any[]).map((item: any) => (
                      <tr key={item.id} className="border-b border-border/50 last:border-0 hover:bg-muted/10 transition-colors">
                        <td className="px-3 py-2.5">
                          <span className="font-bold">{item.symbol}</span>
                          <span className="text-muted-foreground text-[10px] ml-1.5">
                            {fmtDate(item.signal_created_at)}
                          </span>
                        </td>
                        <td className={cn('px-3 py-2.5 text-right font-bold', item.direction === 'buy' ? 'text-green-400' : 'text-red-400')}>
                          {item.direction?.toUpperCase()}
                        </td>
                        <td className="px-3 py-2.5 text-right">{fmtUSD(item.entry_price)}</td>
                        <td className={cn('px-3 py-2.5 text-right', clr(item.pnl_1d_pct))}>{pct(item.pnl_1d_pct)}</td>
                        <td className={cn('px-3 py-2.5 text-right font-bold', clr(item.pnl_5d_pct))}>{pct(item.pnl_5d_pct)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="text-green-400">{pct(item.mfe_pct)}</span>
                          <span className="text-muted-foreground mx-1">/</span>
                          <span className="text-red-400">{pct(item.mae_pct)}</span>
                        </td>
                        <td className={cn('px-3 py-2.5 text-right', clr(item.excess_return_5d))}>{pct(item.excess_return_5d)}</td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground text-[10px]">{item.outcome_status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
