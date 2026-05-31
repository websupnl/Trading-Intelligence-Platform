'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { cn, fmtUSD, fmtPrice, cleanSym } from '@/lib/utils';

type Tab = 'open' | 'gesloten' | 'orders';

export default function PositiesPage() {
  const [tab, setTab] = useState<Tab>('open');
  const [orderSym, setOrderSym] = useState('');
  const [orderSide, setOrderSide] = useState('buy');
  const [orderAmount, setOrderAmount] = useState('');
  const [placing, setPlacing] = useState(false);
  const { toast } = useToast();

  const { data: positions, reload: reloadPositions } = useApi(() => api.getPositions(), [], { pollIntervalMs: 20000 });
  const { data: trades } = useApi(() => api.getTrades(200), [], { pollIntervalMs: 60000 });
  const { data: pnl } = useApi(() => api.getPnlSummary(), [], { pollIntervalMs: 60000 });
  const { data: account } = useApi(() => api.getAccount(), [], { pollIntervalMs: 30000 });
  const { data: orders } = useApi(() => api.getOrders('all'), []);

  const openPositions: any[] = Array.isArray(positions) ? positions : [];
  const allTrades: any[] = Array.isArray(trades) ? trades : [];
  const closedTrades = allTrades.filter(t => t.status === 'closed');
  const allOrders: any[] = Array.isArray(orders) ? orders : [];

  const unrealizedTotal = openPositions.reduce((s, p) => s + parseFloat(p.unrealized_pl || 0), 0);
  const totalPnl = (pnl as any)?.total_pnl ?? 0;
  const winRate: number | null = (pnl as any)?.win_rate ?? null;
  const totalTrades = (pnl as any)?.total_trades ?? 0;
  const equity = parseFloat((account as any)?.equity || '0');

  async function handleClose(symbol: string) {
    try {
      await api.closePosition(symbol);
      toast(`✅ ${cleanSym(symbol)} gesloten`, 'success');
      reloadPositions();
    } catch (e: any) {
      toast(e?.detail || 'Sluiten mislukt', 'error');
    }
  }

  async function handlePlaceOrder() {
    if (!orderSym.trim() || !orderAmount) { toast('Vul ticker en bedrag in', 'error'); return; }
    setPlacing(true);
    try {
      await api.submitPaperOrder({
        symbol: orderSym.toUpperCase(),
        side: orderSide,
        notional: parseFloat(orderAmount),
        order_type: 'market',
      });
      toast(`${orderSide.toUpperCase()} ${orderSym.toUpperCase()} geplaatst`, 'success');
      setOrderSym(''); setOrderAmount('');
    } catch (e: any) {
      toast(e?.detail || 'Order mislukt', 'error');
    }
    setPlacing(false);
  }

  async function handleCancelOrder(alpacaId: string) {
    try {
      await api.cancelOrder(alpacaId);
      toast('Order geannuleerd', 'success');
    } catch (e: any) {
      toast(e?.detail || 'Fout', 'error');
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'open', label: `Open (${openPositions.length})` },
    { key: 'gesloten', label: `Gesloten (${closedTrades.length})` },
    { key: 'orders', label: `Orders (${allOrders.length})` },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Portfolio', value: fmtUSD(equity), color: '' },
          { label: 'Unrealized', value: fmtUSD(unrealizedTotal), color: unrealizedTotal >= 0 ? 'text-green-400' : 'text-red-400' },
          { label: 'All-time P&L', value: fmtUSD(totalPnl), color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
          { label: 'Win rate', value: winRate !== null ? `${(winRate * 100).toFixed(0)}%` : '—', color: winRate !== null && winRate >= 0.5 ? 'text-green-400' : 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-2xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
            <p className={cn('text-base font-bold font-num', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-xl p-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex-1 py-2 rounded-lg text-sm font-semibold transition-colors',
              tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Open positions ────────────────────────────────────────────── */}
      {tab === 'open' && (
        <div className="space-y-2">
          {openPositions.length === 0 && (
            <Empty text="Geen open posities — de bot is aan het wachten op de juiste kans" />
          )}
          {openPositions.map((pos: any) => {
            const pl = parseFloat(pos.unrealized_pl || '0');
            const plPct = parseFloat(pos.unrealized_plpc || '0') * 100;
            const mv = parseFloat(pos.market_value || '0');
            const entry = parseFloat(pos.avg_entry_price || '0');
            const current = parseFloat(pos.current_price || '0');
            const sym = cleanSym(pos.symbol);
            return (
              <div key={pos.symbol} className="bg-card border border-border rounded-2xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-lg">{sym}</p>
                      <span className="text-[10px] text-muted-foreground uppercase">{pos.side || 'long'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground font-num mt-0.5">
                      {pos.qty} stuks · entry {fmtPrice(entry)} → {fmtPrice(current)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={cn('text-xl font-bold font-num', pl >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {pl >= 0 ? '+' : ''}{fmtUSD(pl)}
                    </p>
                    <p className={cn('text-sm font-num', pl >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%
                    </p>
                  </div>
                </div>
                {/* P&L bar */}
                <div className="h-1 bg-muted rounded-full overflow-hidden mb-3">
                  <div
                    className={cn('h-full rounded-full transition-all', pl >= 0 ? 'bg-green-400' : 'bg-red-400')}
                    style={{ width: `${Math.min(Math.abs(plPct) * 5, 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-num">Marktwaarde: {fmtUSD(mv)}</p>
                  <button onClick={() => handleClose(pos.symbol)}
                    className="text-xs font-bold text-red-400 border border-red-400/30 hover:bg-red-400/10 px-3 py-1.5 rounded-lg transition-colors">
                    Sluit positie
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Closed trades ─────────────────────────────────────────────── */}
      {tab === 'gesloten' && (
        <div className="space-y-3">
          {/* Summary */}
          {closedTrades.length > 0 && (
            <div className="bg-card border border-border rounded-2xl px-4 py-3 flex items-center gap-6">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Trades</p>
                <p className="font-bold font-num">{totalTrades}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Win rate</p>
                <p className={cn('font-bold font-num', winRate !== null && winRate >= 0.5 ? 'text-green-400' : 'text-red-400')}>
                  {winRate !== null ? `${(winRate * 100).toFixed(0)}%` : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Totaal P&L</p>
                <p className={cn('font-bold font-num', totalPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}
                </p>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {closedTrades.length === 0 && <Empty text="Nog geen gesloten trades" />}
            {closedTrades.map((t: any) => {
              const pnlVal = t.pnl ?? 0;
              const pnlPct = t.pnl_pct ?? 0;
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
                  <div className={cn('w-1 h-8 rounded-full shrink-0', pnlVal >= 0 ? 'bg-green-400' : 'bg-red-400')} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm">{t.symbol}</p>
                      <span className="text-[10px] text-muted-foreground uppercase">{t.side} · {t.mode || 'auto'}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{t.exit_reason?.slice(0, 55)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn('font-bold text-sm font-num', pnlVal >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {pnlVal >= 0 ? '+' : ''}{fmtUSD(pnlVal)}
                    </p>
                    <p className={cn('text-[11px] font-num', pnlVal >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Orders ────────────────────────────────────────────────────── */}
      {tab === 'orders' && (
        <div className="space-y-4">
          {/* Order form */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold">Paper order plaatsen</p>
            <div className="grid grid-cols-3 gap-2">
              <input
                value={orderSym} onChange={e => setOrderSym(e.target.value.toUpperCase())}
                placeholder="Ticker (BTC)" maxLength={10}
                className="bg-muted border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary uppercase"
              />
              <select value={orderSide} onChange={e => setOrderSide(e.target.value)}
                className="bg-muted border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary">
                <option value="buy">Buy / Long</option>
                <option value="sell">Sell / Short</option>
              </select>
              <input
                value={orderAmount} onChange={e => setOrderAmount(e.target.value)}
                placeholder="Bedrag ($)" type="number" min="1"
                className="bg-muted border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <button onClick={handlePlaceOrder} disabled={placing}
              className="w-full h-10 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors">
              {placing ? '…' : 'Paper order plaatsen'}
            </button>
          </div>

          {/* Order history */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {allOrders.length === 0 && <Empty text="Geen orders" />}
            {allOrders.slice(0, 30).map((o: any) => (
              <div key={o.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0">
                <span className={cn('text-[10px] font-bold uppercase w-8 shrink-0',
                  o.side === 'buy' ? 'text-green-400' : 'text-red-400')}>
                  {o.side}
                </span>
                <p className="font-bold text-sm w-14">{cleanSym(o.symbol)}</p>
                <p className="text-xs text-muted-foreground flex-1 font-num">
                  ${o.notional || o.filled_avg_price || '—'}
                </p>
                <span className={cn('text-[10px] font-bold',
                  o.status === 'filled' ? 'text-green-400' :
                  o.status === 'canceled' ? 'text-muted-foreground' :
                  'text-amber-400')}>
                  {o.status}
                </span>
                {(o.status === 'new' || o.status === 'accepted') && o.alpaca_order_id && (
                  <button onClick={() => handleCancelOrder(o.alpaca_order_id)}
                    className="text-[10px] text-red-400 border border-red-400/30 px-2 py-0.5 rounded hover:bg-red-400/10 transition-colors">
                    Annuleer
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="p-10 text-center text-sm text-muted-foreground">{text}</div>
  );
}
