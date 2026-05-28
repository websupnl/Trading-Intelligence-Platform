'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtUSD, fmtDate, cn } from '@/lib/utils';
import { AssetLabel } from '@/components/market/AssetLabel';
import { knownAssetName } from '@/lib/assets';

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-card rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-bold', color)}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function PortfolioPage() {
  const { data: account, loading: acctLoading, error: acctError } = useApi(() => api.getAccount(), [], { pollIntervalMs: 10000 });
  const { data: positions, loading: posLoading, reload: reloadPositions } = useApi(() => api.getPositions(), [], { pollIntervalMs: 10000 });
  const { data: perf, loading: perfLoading, reload: reloadPerf } = useApi(() => api.getPerformance(), [], { pollIntervalMs: 15000 });
  const { data: trades, loading: tradesLoading } = useApi(() => api.getTrades(50), [], { pollIntervalMs: 15000 });

  const [closing, setClosing] = useState<string | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [closeResult, setCloseResult] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function handleClose(symbol: string) {
    if (!confirm(`Positie ${symbol} sluiten?`)) return;
    setClosing(symbol);
    try {
      await api.closePosition(symbol);
      setCloseResult(`✅ ${symbol} positie gesloten`);
      reloadPositions();
    } catch (e: any) {
      setCloseResult(`❌ ${symbol}: ${e?.detail || 'Fout'}`);
    } finally {
      setClosing(null);
      setTimeout(() => setCloseResult(null), 5000);
    }
  }

  async function handleCloseAll() {
    if (!confirm('ALLE posities sluiten? Dit kan niet ongedaan gemaakt worden.')) return;
    setClosingAll(true);
    try {
      const r = await api.closeAllPositions();
      setCloseResult(`✅ ${r.closed} posities gesloten`);
      reloadPositions();
    } catch (e: any) {
      setCloseResult(`❌ ${e?.detail || 'Fout'}`);
    } finally {
      setClosingAll(false);
      setTimeout(() => setCloseResult(null), 5000);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await api.syncTrades();
      setCloseResult(`✅ Trade sync: ${r.created} nieuw, ${r.closed} gesloten`);
      reloadPerf();
    } catch (e: any) {
      setCloseResult(`❌ ${e?.detail || 'Fout'}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setCloseResult(null), 5000);
    }
  }

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-base font-semibold">Portfolio</h1>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? '⏳...' : '🔄 Sync Trades'}
          </Button>
          <Button variant="destructive" size="sm" onClick={handleCloseAll} disabled={closingAll}>
            {closingAll ? 'Sluiten...' : '⛔ Sluit Alles'}
          </Button>
        </div>
      </div>

      {closeResult && (
        <div className="p-3 rounded-md bg-card border border-border text-sm">{closeResult}</div>
      )}

      {/* Account */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {acctLoading && <div className="col-span-4"><LoadingSpinner /></div>}
        {acctError && <div className="col-span-4"><ErrorState message="Alpaca niet geconfigureerd" /></div>}
        {account && (
          <>
            <StatCard label="Portfolio Value" value={fmtUSD(parseFloat(account.portfolio_value))} />
            <StatCard label="Buying Power" value={fmtUSD(parseFloat(account.buying_power))} />
            <StatCard label="Cash" value={fmtUSD(parseFloat(account.cash))} />
            <StatCard
              label="Status"
              value={account.status}
              color={account.status === 'ACTIVE' ? 'text-green-400' : 'text-yellow-400'}
            />
          </>
        )}
      </div>

      {/* Performance stats */}
      {!perfLoading && perf && perf.total_trades > 0 && (
        <Card>
          <CardHeader><CardTitle>📊 Performance Statistieken</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <StatCard
                label="Win Rate"
                value={`${perf.win_rate}%`}
                sub={`${perf.winning_trades}W / ${perf.losing_trades}L`}
                color={perf.win_rate >= 50 ? 'text-green-400' : 'text-red-400'}
              />
              <StatCard
                label="Totaal P&L"
                value={fmtUSD(perf.total_pnl)}
                color={perf.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}
              />
              <StatCard
                label="Gem. P&L"
                value={fmtUSD(perf.avg_pnl)}
                sub={`Win: ${fmtUSD(perf.avg_win)} | Loss: ${fmtUSD(perf.avg_loss)}`}
                color={perf.avg_pnl >= 0 ? 'text-green-400' : 'text-red-400'}
              />
              <StatCard
                label="Profit Factor"
                value={perf.profit_factor?.toFixed(2) || '0.00'}
                color={perf.profit_factor >= 1 ? 'text-green-400' : 'text-red-400'}
              />
            </div>

            {(perf.best_trade || perf.worst_trade) && (
              <div className="grid grid-cols-2 gap-3">
                {perf.best_trade && (
                  <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">🏆 Beste Trade</p>
                    <AssetLabel symbol={perf.best_trade.symbol} className="text-green-400" />
                    <p className="text-sm text-green-400">{fmtUSD(perf.best_trade.pnl)}</p>
                  </div>
                )}
                {perf.worst_trade && (
                  <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">📉 Slechtste Trade</p>
                    <AssetLabel symbol={perf.worst_trade.symbol} className="text-red-400" />
                    <p className="text-sm text-red-400">{fmtUSD(perf.worst_trade.pnl)}</p>
                  </div>
                )}
              </div>
            )}

            {/* P&L timeline */}
            {perf.pnl_series?.length > 1 && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground mb-2">Cumulatief P&L</p>
                <div className="h-16 flex items-end gap-0.5">
                  {perf.pnl_series.slice(-30).map((p: any, i: number) => {
                    const maxAbs = Math.max(...perf.pnl_series.slice(-30).map((x: any) => Math.abs(x.cumulative)));
                    const height = maxAbs > 0 ? Math.abs(p.cumulative) / maxAbs * 100 : 50;
                    return (
                      <div
                        key={i}
                        className={cn('flex-1 rounded-sm min-w-[2px]', p.cumulative >= 0 ? 'bg-green-500/70' : 'bg-red-500/70')}
                        style={{ height: `${height}%` }}
                        title={`${p.symbol} - ${knownAssetName(p.symbol) || p.symbol}: ${fmtUSD(p.pnl)} (cum: ${fmtUSD(p.cumulative)})`}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Open positions */}
      <Card>
        <CardHeader>
          <CardTitle>Open Posities</CardTitle>
          <Button variant="outline" size="sm" onClick={reloadPositions}>Vernieuwen</Button>
        </CardHeader>
        <CardContent className="p-0">
          {posLoading && <LoadingSpinner />}
          {!posLoading && (!positions || positions.length === 0) && (
            <EmptyState message="Geen open posities" />
          )}
          {positions?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left px-4 py-2">Symbool</th>
                    <th className="text-right px-4 py-2">Qty</th>
                    <th className="text-right px-4 py-2">Entry</th>
                    <th className="text-right px-4 py-2">Nu</th>
                    <th className="text-right px-4 py-2">P&L</th>
                    <th className="text-right px-4 py-2">Actie</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p: any) => {
                    const pnl = parseFloat(p.unrealized_pl ?? 0);
                    return (
                      <tr key={p.asset_id ?? p.symbol} className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-2"><AssetLabel symbol={p.symbol} /></td>
                        <td className="px-4 py-2 text-right">{p.qty}</td>
                        <td className="px-4 py-2 text-right">{fmtUSD(parseFloat(p.avg_entry_price))}</td>
                        <td className="px-4 py-2 text-right">{fmtUSD(parseFloat(p.current_price))}</td>
                        <td className={cn('px-4 py-2 text-right font-medium', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {fmtUSD(pnl)}
                          <span className="text-xs ml-1 opacity-70">
                            ({parseFloat(p.unrealized_plpc ?? 0) >= 0 ? '+' : ''}{(parseFloat(p.unrealized_plpc ?? 0) * 100).toFixed(1)}%)
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleClose(p.symbol)}
                            disabled={closing === p.symbol}
                          >
                            {closing === p.symbol ? '...' : 'Sluit'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trade history with AI reflection */}
      <Card>
        <CardHeader><CardTitle>Trade Geschiedenis</CardTitle></CardHeader>
        <CardContent className="p-0">
          {tradesLoading && <LoadingSpinner />}
          {!tradesLoading && (!trades || trades.length === 0) && (
            <EmptyState message="Geen trades. Klik 'Sync Trades' om Alpaca orders te importeren." />
          )}
          {trades?.slice(0, 20).map((t: any) => (
            <div key={t.id} className="border-b border-border last:border-0 px-4 py-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <AssetLabel symbol={t.symbol} />
                  <Badge variant={t.side === 'buy' ? 'success' : 'danger'}>{t.side?.toUpperCase()}</Badge>
                  <Badge variant={t.status === 'closed' ? 'muted' : 'warning'}>{t.status}</Badge>
                  {t.mode === 'paper' && <Badge variant="muted">paper</Badge>}
                </div>
                {t.pnl !== null && t.pnl !== undefined && (
                  <span className={cn('font-semibold text-sm', t.pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {t.pnl >= 0 ? '+' : ''}{fmtUSD(t.pnl)}
                    {t.pnl_pct !== null && ` (${t.pnl_pct >= 0 ? '+' : ''}${t.pnl_pct?.toFixed(1)}%)`}
                  </span>
                )}
              </div>
              <div className="flex gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                {t.entry_price && <span>Entry: {fmtUSD(t.entry_price)}</span>}
                {t.exit_price && <span>Exit: {fmtUSD(t.exit_price)}</span>}
                {t.quantity && <span>Qty: {t.quantity}</span>}
                {t.opened_at && <span>{fmtDate(t.opened_at)}</span>}
              </div>
              {t.ai_reflection?.lesson && (
                <div className="mt-2 p-2 rounded bg-muted/30 text-xs text-muted-foreground border-l-2 border-primary/30">
                  <span className="text-primary/70">💡 Les: </span>{t.ai_reflection.lesson}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
