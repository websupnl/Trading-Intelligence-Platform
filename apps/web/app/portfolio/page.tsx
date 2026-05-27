'use client';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtUSD, fmtDate, cn } from '@/lib/utils';

export default function PortfolioPage() {
  const { data: account, loading: acctLoading, error: acctError } = useApi(() => api.getAccount(), []);
  const { data: positions, loading: posLoading } = useApi(() => api.getPositions(), []);

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">Portfolio</h1>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Account</CardTitle></CardHeader>
          <CardContent>
            {acctLoading && <LoadingSpinner />}
            {acctError && <ErrorState message="Alpaca niet geconfigureerd" />}
            {account && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Portfolio Value</p>
                  <p className="text-2xl font-bold">{fmtUSD(parseFloat(account.portfolio_value))}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Buying Power</p>
                    <p className="font-medium">{fmtUSD(parseFloat(account.buying_power))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cash</p>
                    <p className="font-medium">{fmtUSD(parseFloat(account.cash))}</p>
                  </div>
                </div>
                <Badge variant={account.status === 'ACTIVE' ? 'success' : 'warning'}>{account.status}</Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Open Posities</CardTitle></CardHeader>
        <CardContent className="p-0">
          {posLoading && <LoadingSpinner />}
          {!posLoading && (!positions || positions.length === 0) && (
            <EmptyState message="Geen open posities" />
          )}
          {positions?.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2">Symbool</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-right px-4 py-2">Gem. Prijs</th>
                  <th className="text-right px-4 py-2">Huidige Prijs</th>
                  <th className="text-right px-4 py-2">Marktwaarde</th>
                  <th className="text-right px-4 py-2">Unrealized P/L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p: any) => {
                  const pnl = parseFloat(p.unrealized_pl ?? p.unrealized_plpc ?? 0);
                  return (
                    <tr key={p.asset_id ?? p.symbol} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">{p.symbol}</td>
                      <td className="px-4 py-2 text-right">{p.qty}</td>
                      <td className="px-4 py-2 text-right">{fmtUSD(parseFloat(p.avg_entry_price))}</td>
                      <td className="px-4 py-2 text-right">{fmtUSD(parseFloat(p.current_price))}</td>
                      <td className="px-4 py-2 text-right">{fmtUSD(parseFloat(p.market_value))}</td>
                      <td className={cn('px-4 py-2 text-right font-medium', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {fmtUSD(parseFloat(p.unrealized_pl))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
