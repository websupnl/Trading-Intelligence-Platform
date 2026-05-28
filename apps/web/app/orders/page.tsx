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
import { fmtDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { AssetLabel } from '@/components/market/AssetLabel';
import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

const STATUS_CONFIG: Record<string, { label: string; variant: 'success' | 'warning' | 'muted' | 'destructive' }> = {
  filled: { label: 'Gevuld', variant: 'success' },
  partially_filled: { label: 'Deels gevuld', variant: 'warning' },
  new: { label: 'Nieuw', variant: 'warning' },
  pending_new: { label: 'In behandeling', variant: 'warning' },
  open: { label: 'Open', variant: 'warning' },
  canceled: { label: 'Geannuleerd', variant: 'muted' },
  cancelled: { label: 'Geannuleerd', variant: 'muted' },
  expired: { label: 'Verlopen', variant: 'muted' },
  rejected: { label: 'Geweigerd', variant: 'destructive' },
  accepted: { label: 'Geaccepteerd', variant: 'success' },
};

const canCancel = (status: string) => ['open', 'pending_new', 'new', 'accepted'].includes(status);

export default function OrdersPage() {
  const { data: orders, loading, error, reload } = useApi(() => api.getOrders('all'), [], { pollIntervalMs: 10000 });
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [form, setForm] = useState({ symbol: '', side: 'buy', notional: '', order_type: 'market' });
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
        if (!confirm('Risk check vereist bevestiging. Wil je deze order toch plaatsen?')) {
          setResult({ type: 'success', message: 'Order geannuleerd door gebruiker' });
          return;
        }
        r = await api.submitPaperOrder({ ...request, confirmed: true });
      }
      const symbol = form.symbol.toUpperCase();
      const side = form.side.toUpperCase();
      const notional = form.notional ? `$${parseFloat(form.notional).toFixed(2)}` : '';
      setResult({ type: 'success', message: `✓ ${side} order voor ${symbol} ${notional} ingediend (${r.status})` });
      setForm(f => ({ ...f, symbol: '', notional: '' }));
      reload();
    } catch (e: any) {
      const msg = e?.detail?.reasons?.join(', ') || e?.detail || e?.message || 'Order mislukt';
      setResult({ type: 'error', message: `✗ ${msg}` });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(orderId: string) {
    setCancelling(orderId);
    try {
      await api.cancelOrder(orderId);
      reload();
    } catch {
      // silently ignore — order may already be gone
    } finally {
      setCancelling(null);
    }
  }

  const totalFilled = orders?.filter((o: any) => o.status === 'filled').length ?? 0;
  const totalOpen = orders?.filter((o: any) => canCancel(o.status)).length ?? 0;

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold">Orders</h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {orders && (
            <>
              <span>{totalFilled} gevuld</span>
              <span>{totalOpen} open</span>
              <span>{orders.length} totaal</span>
            </>
          )}
        </div>
      </div>

      {/* Order form */}
      <Card>
        <CardHeader>
          <CardTitle>Paper Order Plaatsen</CardTitle>
          <span className="text-xs text-muted-foreground">Handmatige paper order — risk check wordt automatisch uitgevoerd</span>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Symbool *</label>
                <input
                  className="w-full h-9 px-3 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring uppercase"
                  value={form.symbol}
                  onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                  placeholder="AAPL"
                  required
                />
                {form.symbol && <AssetLabel symbol={form.symbol} compact className="mt-1 text-[11px]" />}
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Richting *</label>
                <div className="flex rounded-md overflow-hidden border border-border h-9">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, side: 'buy' }))}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 text-xs font-medium transition-colors',
                      form.side === 'buy' ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <TrendingUp size={12} /> Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, side: 'sell' }))}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 text-xs font-medium transition-colors',
                      form.side === 'sell' ? 'bg-red-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <TrendingDown size={12} /> Sell
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Bedrag ($)</label>
                <input
                  className="w-full h-9 px-3 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  type="number"
                  min="10"
                  step="10"
                  value={form.notional}
                  onChange={e => setForm(f => ({ ...f, notional: e.target.value }))}
                  placeholder="100"
                />
              </div>

              <div className="flex items-end">
                <Button type="submit" disabled={submitting || !form.symbol} className="w-full h-9">
                  {submitting ? '⏳ Verwerken...' : `${form.side === 'buy' ? '▲ BUY' : '▼ SELL'} ${form.symbol || '---'}`}
                </Button>
              </div>
            </div>

            {result && (
              <div className={cn(
                'p-3 rounded-md text-xs border',
                result.type === 'error'
                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                  : 'bg-green-500/10 text-green-400 border-green-500/20'
              )}>
                {result.message}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Orders table */}
      <Card>
        <CardHeader>
          <CardTitle>Order Historiek</CardTitle>
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw size={12} className={cn('mr-1', loading && 'animate-spin')} />
            Vernieuwen
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {error && (
            <div className="p-4">
              <ErrorState message="Alpaca niet geconfigureerd of niet bereikbaar" />
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Vul ALPACA_API_KEY en ALPACA_SECRET_KEY in je .env in om orders te zien.
              </p>
            </div>
          )}
          {!loading && !error && (!orders || orders.length === 0) && (
            <EmptyState message="Nog geen orders geplaatst. Gebruik het formulier hierboven of laat de bot automatisch traden." />
          )}
          {orders && orders.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Asset</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-muted-foreground">Kant</th>
                    <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Qty / Notional</th>
                    <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Vul prijs</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Datum</th>
                    <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...orders].sort((a: any, b: any) =>
                    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
                  ).map((o: any) => {
                    const cfg = STATUS_CONFIG[o.status] ?? { label: o.status, variant: 'muted' as const };
                    const isCancelling = cancelling === o.id;
                    return (
                      <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5">
                          <AssetLabel symbol={o.symbol} />
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={cn(
                            'text-xs font-bold px-2 py-0.5 rounded',
                            o.side === 'buy' ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'
                          )}>
                            {o.side?.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs font-mono">
                          {o.qty ? `${parseFloat(o.qty).toFixed(4)} aandelen` : o.notional ? `$${parseFloat(o.notional).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs font-mono text-muted-foreground">
                          {o.filled_avg_price ? `$${parseFloat(o.filled_avg_price).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <Badge variant={cfg.variant}>{cfg.label}</Badge>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                          {fmtDate(o.created_at)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {canCancel(o.status) && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleCancel(o.id)}
                              disabled={isCancelling}
                            >
                              {isCancelling ? 'Annuleren...' : 'Annuleer'}
                            </Button>
                          )}
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
    </div>
  );
}
