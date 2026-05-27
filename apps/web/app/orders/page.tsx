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
import { fmtDate, fmtUSD } from '@/lib/utils';
import { AssetLabel } from '@/components/market/AssetLabel';

export default function OrdersPage() {
  const { data: orders, loading, error, reload } = useApi(() => api.getOrders('all'), []);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ symbol: '', side: 'buy', notional: '', order_type: 'market' });
  const [result, setResult] = useState<any>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const request = {
        symbol: form.symbol.toUpperCase(),
        side: form.side,
        notional: form.notional ? parseFloat(form.notional) : undefined,
        order_type: form.order_type,
      };
      let r = await api.submitPaperOrder(request);
      if (r.status === 'requires_manual_approval') {
        if (!confirm('Risk check vereist bevestiging. Deze paper order uitvoeren?')) {
          setResult({ type: 'success', data: r });
          return;
        }
        r = await api.submitPaperOrder({ ...request, confirmed: true });
      }
      setResult({ type: 'success', data: r });
      reload();
    } catch (e: any) {
      setResult({ type: 'error', data: e?.detail || e });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(alpacaId: string) {
    await api.cancelOrder(alpacaId).catch(() => null);
    reload();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">Orders</h1>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Paper Order Plaatsen</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Symbool</label>
                  <input
                    className="w-full h-9 px-3 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none"
                    value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
                    placeholder="AAPL" required
                  />
                  {form.symbol && <AssetLabel symbol={form.symbol} compact className="mt-1 text-xs" />}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Richting</label>
                  <select
                    className="w-full h-9 px-3 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none"
                    value={form.side} onChange={e => setForm(f => ({ ...f, side: e.target.value }))}
                  >
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Notional ($)</label>
                  <input
                    className="w-full h-9 px-3 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none"
                    type="number" value={form.notional}
                    onChange={e => setForm(f => ({ ...f, notional: e.target.value }))}
                    placeholder="100"
                  />
                </div>
              </div>
              <Button type="submit" disabled={submitting} size="sm">
                {submitting ? 'Verwerken...' : 'Paper Order Plaatsen'}
              </Button>
            </form>

            {result && (
              <div className={`mt-3 p-3 rounded text-xs ${result.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
                {result.type === 'error'
                  ? (result.data?.reasons?.join(', ') || JSON.stringify(result.data))
                  : `Status: ${result.data?.status}`
                }
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Orders</CardTitle>
          <Button variant="outline" size="sm" onClick={reload}>Vernieuwen</Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {error && <div className="p-4"><ErrorState message="Alpaca niet geconfigureerd" /></div>}
          {!loading && (!orders || orders.length === 0) && <EmptyState message="Geen orders" />}
          {orders?.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2">Symbool</th>
                  <th className="text-left px-4 py-2">Richting</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-right px-4 py-2">Aangemaakt</th>
                  <th className="text-right px-4 py-2">Actie</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any) => (
                  <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2"><AssetLabel symbol={o.symbol} /></td>
                    <td className={`px-4 py-2 font-medium ${o.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>{o.side?.toUpperCase()}</td>
                    <td className="px-4 py-2 text-right">{o.qty ?? o.notional}</td>
                    <td className="px-4 py-2">
                      <Badge variant={o.status === 'filled' ? 'success' : o.status === 'canceled' ? 'muted' : 'warning'}>{o.status}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground">{fmtDate(o.created_at)}</td>
                    <td className="px-4 py-2 text-right">
                      {(o.status === 'open' || o.status === 'pending_new' || o.status === 'new') && (
                        <Button variant="destructive" size="sm" onClick={() => handleCancel(o.id)}>Annuleer</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
