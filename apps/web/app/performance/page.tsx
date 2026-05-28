'use client';

import { useState } from 'react';
import { AssetLabel } from '@/components/market/AssetLabel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { cn, fmtDate, fmtUSD } from '@/lib/utils';

function pct(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn('mt-1 text-2xl font-semibold', tone)}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function PerformancePage() {
  const { data: realized, loading: realizedLoading } = useApi(() => api.getPerformance(), []);
  const { data: summary, loading: summaryLoading, reload: reloadSummary } = useApi(() => api.getOutcomeSummary(), []);
  const { data: outcomes, loading: outcomesLoading, reload: reloadOutcomes } = useApi(() => api.getSignalOutcomes(), []);
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleEvaluate() {
    setEvaluating(true);
    setResult(null);
    try {
      const response = await api.evaluateOutcomes();
      setResult(`${response.outcomes_updated} signalen gemeten, ${response.complete} volledig na 5 handelsdagen.`);
      await Promise.all([reloadSummary(), reloadOutcomes()]);
    } catch (error: any) {
      setResult(error?.detail || 'Outcome-evaluatie mislukt.');
    } finally {
      setEvaluating(false);
    }
  }

  const avg5d = summary?.avg_pnl_5d_pct;
  const excess = summary?.avg_excess_return_5d;

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold">Signal Performance</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Objectieve meting na 1 en 5 handelsdagen. Dit zijn signaaluitkomsten, geen uitgevoerde trades.
          </p>
        </div>
        <Button variant="success" size="sm" onClick={handleEvaluate} disabled={evaluating}>
          {evaluating ? 'Evalueren...' : 'Outcomes evalueren'}
        </Button>
      </div>

      {result && <div className="rounded-md border border-border bg-card p-3 text-sm">{result}</div>}

      <div>
        <h2 className="mb-2 text-sm font-medium">Gerealiseerde trade P&amp;L</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Resultaten van daadwerkelijk uitgevoerde en gesloten trades uit Alpaca-sync.
        </p>
        {realizedLoading ? <LoadingSpinner /> : !realized?.total_trades ? (
          <p className="text-xs text-muted-foreground py-2">Nog geen gesloten trades. Sync trades via de Portfolio pagina of wacht tot de bot een trade sluit.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Gesloten trades" value={`${realized?.total_trades ?? 0}`} />
            <StatCard
              label="Win rate"
              value={realized?.total_trades ? `${realized.win_rate.toFixed(1)}%` : '-'}
              tone={!realized?.total_trades ? undefined : realized.win_rate >= 50 ? 'text-green-400' : 'text-red-400'}
            />
            <StatCard
              label="Totaal P&L"
              value={realized?.total_trades ? fmtUSD(realized.total_pnl) : '-'}
              tone={!realized?.total_trades ? undefined : realized.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}
            />
            <StatCard
              label="Profit factor"
              value={realized?.total_trades ? realized.profit_factor?.toFixed(2) || '0.00' : '-'}
              tone={!realized?.total_trades ? undefined : realized.profit_factor >= 1 ? 'text-green-400' : 'text-red-400'}
            />
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Shadow signal outcomes</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Meet alle gegenereerde ideeën, ook wanneer er geen order is uitgevoerd.
        </p>
      {summaryLoading ? <LoadingSpinner /> : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Getraceerde signalen" value={`${summary?.tracked ?? 0}`} />
          <StatCard
            label="5d hit rate"
            value={summary?.hit_rate_5d == null ? '-' : `${summary.hit_rate_5d.toFixed(1)}%`}
            tone={summary?.hit_rate_5d == null ? undefined : summary.hit_rate_5d >= 50 ? 'text-green-400' : 'text-red-400'}
          />
          <StatCard
            label="Gem. 5d resultaat"
            value={pct(avg5d)}
            tone={avg5d == null ? undefined : avg5d >= 0 ? 'text-green-400' : 'text-red-400'}
          />
          <StatCard
            label="Gem. vs SPY"
            value={pct(excess)}
            tone={excess == null ? undefined : excess >= 0 ? 'text-green-400' : 'text-red-400'}
          />
        </div>
      )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Signaaluitkomsten</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {outcomesLoading && <LoadingSpinner />}
          {!outcomesLoading && (!outcomes || outcomes.length === 0) && (
            <div className="p-6 text-center space-y-2">
              <p className="text-sm text-muted-foreground">Nog geen signaaluitkomsten beschikbaar.</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Klik op <strong>Outcomes evalueren</strong> hierboven. Dit vereist candle data — zorg dat de Pipeline minstens 1x gedraaid heeft (elke 15 min automatisch, of handmatig via Pipeline pagina).
              </p>
              <p className="text-xs text-muted-foreground">Na 1 handelsdag verschijnen de 1d-resultaten, na 5 handelsdagen ook de 5d-resultaten vs SPY.</p>
            </div>
          )}
          {outcomes && outcomes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Asset</th>
                    <th className="px-4 py-3 text-left">Richting</th>
                    <th className="px-4 py-3 text-right">Entry</th>
                    <th className="px-4 py-3 text-right">1d</th>
                    <th className="px-4 py-3 text-right">5d</th>
                    <th className="px-4 py-3 text-right">MFE / MAE</th>
                    <th className="px-4 py-3 text-right">vs SPY</th>
                    <th className="px-4 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomes.map((item: any) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <AssetLabel symbol={item.symbol} />
                        <p className="text-xs text-muted-foreground">{fmtDate(item.signal_created_at)}</p>
                      </td>
                      <td className="px-4 py-3 uppercase">{item.direction}</td>
                      <td className="px-4 py-3 text-right">{fmtUSD(item.entry_price)}</td>
                      <td className={cn('px-4 py-3 text-right', item.pnl_1d_pct == null ? 'text-muted-foreground' : item.pnl_1d_pct >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {pct(item.pnl_1d_pct)}
                      </td>
                      <td className={cn('px-4 py-3 text-right', item.pnl_5d_pct == null ? 'text-muted-foreground' : item.pnl_5d_pct >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {pct(item.pnl_5d_pct)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        <span className="text-green-400">{pct(item.mfe_pct)}</span>
                        {' / '}
                        <span className="text-red-400">{pct(item.mae_pct)}</span>
                      </td>
                      <td className={cn('px-4 py-3 text-right', item.excess_return_5d == null ? 'text-muted-foreground' : item.excess_return_5d >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {pct(item.excess_return_5d)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">{item.outcome_status}</td>
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
