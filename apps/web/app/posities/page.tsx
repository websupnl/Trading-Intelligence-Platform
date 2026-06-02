'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { fmtUSD, fmtPrice, cleanSym } from '@/lib/utils';

const C = {
  panel: '#12161c', panel2: '#171c24', line: '#1e2630',
  text: '#eaeef3', sub: '#7a8694', faint: '#4a5563',
  up: '#2ebd85', down: '#f6465d', gold: '#f0b90b',
};
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

  const open: any[] = Array.isArray(positions) ? positions : [];
  const allTrades: any[] = Array.isArray(trades) ? trades : [];
  const closed = allTrades.filter(t => t.status === 'closed');
  const allOrders: any[] = Array.isArray(orders) ? orders : [];

  const unrealized = open.reduce((s, p) => s + parseFloat(p.unrealized_pl || 0), 0);
  const totalPnl = (pnl as any)?.total_pnl ?? 0;
  const winRate: number | null = (pnl as any)?.win_rate ?? null;
  const totalTrades = (pnl as any)?.total_trades ?? 0;
  const equity = parseFloat((account as any)?.equity || '0');

  async function handleClose(symbol: string) {
    try { await api.closePosition(symbol); toast(`✅ ${cleanSym(symbol)} gesloten`, 'success'); reloadPositions(); }
    catch (e: any) { toast(e?.detail || 'Sluiten mislukt', 'error'); }
  }
  async function handlePlaceOrder() {
    if (!orderSym.trim() || !orderAmount) { toast('Vul ticker en bedrag in', 'error'); return; }
    setPlacing(true);
    try {
      await api.submitPaperOrder({ symbol: orderSym.toUpperCase(), side: orderSide, notional: parseFloat(orderAmount), order_type: 'market' });
      toast(`${orderSide.toUpperCase()} ${orderSym.toUpperCase()} geplaatst`, 'success');
      setOrderSym(''); setOrderAmount('');
    } catch (e: any) { toast(e?.detail || 'Order mislukt', 'error'); }
    setPlacing(false);
  }
  async function handleCancelOrder(alpacaId: string) {
    try { await api.cancelOrder(alpacaId); toast('Order geannuleerd', 'success'); }
    catch (e: any) { toast(e?.detail || 'Fout', 'error'); }
  }

  const TABS: [Tab, string][] = [['open', `Open ${open.length}`], ['gesloten', `Gesloten ${closed.length}`], ['orders', `Orders ${allOrders.length}`]];

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {/* Stat strip */}
      <div className="grid grid-cols-4 gap-2">
        <Metric label="Portfolio" value={fmtUSD(equity)} tone={C.text} />
        <Metric label="Unrealized" value={fmtUSD(unrealized)} tone={unrealized > 0 ? C.up : unrealized < 0 ? C.down : C.text} />
        <Metric label="All-time" value={fmtUSD(totalPnl)} tone={totalPnl > 0 ? C.up : totalPnl < 0 ? C.down : C.text} />
        <Metric label="Win rate" value={winRate != null ? `${(winRate * 100).toFixed(0)}%` : '—'} tone={winRate != null && winRate >= 0.5 ? C.up : C.sub} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="flex-1 rounded-lg py-2 text-sm font-semibold"
            style={{ background: tab === k ? C.panel2 : 'transparent', color: tab === k ? C.text : C.sub,
                     borderBottom: tab === k ? `2px solid ${C.gold}` : '2px solid transparent' }}>{label}</button>
        ))}
      </div>

      {/* Open positions */}
      {tab === 'open' && (
        <div className="space-y-2">
          {open.length === 0 && <Empty text="Geen open posities — de bot wacht op de juiste kans" />}
          {open.map((p: any) => {
            const pl = parseFloat(p.unrealized_pl || '0'); const pct = parseFloat(p.unrealized_plpc || '0') * 100;
            const u = pl >= 0; const sym = cleanSym(p.symbol);
            return (
              <div key={p.symbol} className="rounded-xl p-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold" style={{ color: C.text }}>{sym}</span>
                      <span className="text-[10px] uppercase" style={{ color: C.faint }}>{p.side || 'long'}</span>
                    </div>
                    <div className="mt-0.5 font-num text-xs" style={{ color: C.sub }}>
                      {p.qty} @ {fmtPrice(parseFloat(p.avg_entry_price || '0'))} → {fmtPrice(parseFloat(p.current_price || '0'))}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-num text-xl font-bold" style={{ color: u ? C.up : C.down }}>{u ? '+' : ''}{fmtUSD(pl)}</div>
                    <div className="font-num text-sm" style={{ color: u ? C.up : C.down }}>{u ? '+' : ''}{pct.toFixed(2)}%</div>
                  </div>
                </div>
                <div className="mb-3 h-1 overflow-hidden rounded-full" style={{ background: C.line }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(Math.abs(pct) * 5, 100)}%`, background: u ? C.up : C.down }} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-num text-xs" style={{ color: C.sub }}>Marktwaarde {fmtUSD(parseFloat(p.market_value || '0'))}</span>
                  <button onClick={() => handleClose(p.symbol)} className="rounded-lg px-3 py-1.5 text-xs font-bold"
                    style={{ background: C.panel2, color: C.down, border: `1px solid ${C.down}44` }}>Sluit positie</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Closed trades */}
      {tab === 'gesloten' && (
        <div className="space-y-2.5">
          {closed.length > 0 && (
            <div className="flex items-center gap-6 rounded-xl px-4 py-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <Mini label="Trades" value={String(totalTrades)} tone={C.text} />
              <Mini label="Win rate" value={winRate != null ? `${(winRate * 100).toFixed(0)}%` : '—'} tone={winRate != null && winRate >= 0.5 ? C.up : C.down} />
              <Mini label="Totaal P&L" value={`${totalPnl >= 0 ? '+' : ''}${fmtUSD(totalPnl)}`} tone={totalPnl >= 0 ? C.up : C.down} />
            </div>
          )}
          <div className="overflow-hidden rounded-2xl" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            {closed.length === 0 && <Empty text="Nog geen gesloten trades" />}
            {closed.map((t: any) => {
              const v = t.pnl ?? 0; const pct = t.pnl_pct ?? 0; const u = v >= 0;
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: u ? C.up : C.down }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="text-sm font-bold" style={{ color: C.text }}>{t.symbol}</span>
                      <span className="text-[10px] uppercase" style={{ color: C.faint }}>{t.side} · {t.mode || 'auto'}</span></div>
                    <div className="truncate text-[11px]" style={{ color: C.sub }}>{t.exit_reason?.slice(0, 55)}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-num text-sm font-bold" style={{ color: u ? C.up : C.down }}>{u ? '+' : ''}{fmtUSD(v)}</div>
                    <div className="font-num text-[11px]" style={{ color: u ? C.up : C.down }}>{u ? '+' : ''}{pct.toFixed(2)}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Orders */}
      {tab === 'orders' && (
        <div className="space-y-3">
          <div className="space-y-3 rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <span className="text-sm font-semibold" style={{ color: C.text }}>Paper order plaatsen</span>
            <div className="grid grid-cols-3 gap-2">
              <input value={orderSym} onChange={e => setOrderSym(e.target.value.toUpperCase())} placeholder="BTC" maxLength={10}
                className="rounded-lg px-3 py-2.5 text-sm uppercase outline-none" style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.text }} />
              <select value={orderSide} onChange={e => setOrderSide(e.target.value)}
                className="rounded-lg px-3 py-2.5 text-sm outline-none" style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.text }}>
                <option value="buy">Buy / Long</option><option value="sell">Sell / Short</option>
              </select>
              <input value={orderAmount} onChange={e => setOrderAmount(e.target.value)} placeholder="Bedrag $" type="number" min="1"
                className="rounded-lg px-3 py-2.5 text-sm outline-none" style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.text }} />
            </div>
            <button onClick={handlePlaceOrder} disabled={placing} className="h-10 w-full rounded-lg text-sm font-bold disabled:opacity-50"
              style={{ background: orderSide === 'buy' ? C.up : C.down, color: '#06231a' }}>{placing ? '…' : `${orderSide === 'buy' ? 'Kopen' : 'Verkopen'} (paper)`}</button>
          </div>

          <div className="overflow-hidden rounded-2xl" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            {allOrders.length === 0 && <Empty text="Geen orders" />}
            {allOrders.slice(0, 30).map((o: any) => (
              <div key={o.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${C.line}` }}>
                <span className="w-8 shrink-0 text-[10px] font-bold uppercase" style={{ color: o.side === 'buy' ? C.up : C.down }}>{o.side}</span>
                <span className="w-14 text-sm font-bold" style={{ color: C.text }}>{cleanSym(o.symbol)}</span>
                <span className="flex-1 font-num text-xs" style={{ color: C.sub }}>${o.notional || o.filled_avg_price || '—'}</span>
                <span className="text-[10px] font-bold" style={{ color: o.status === 'filled' ? C.up : o.status === 'canceled' ? C.faint : C.gold }}>{o.status}</span>
                {(o.status === 'new' || o.status === 'accepted') && o.alpaca_order_id && (
                  <button onClick={() => handleCancelOrder(o.alpaca_order_id)} className="rounded px-2 py-0.5 text-[10px]"
                    style={{ color: C.down, border: `1px solid ${C.down}44` }}>Annuleer</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: C.sub }}>{label}</div>
      <div className="mt-1 font-num text-[15px] font-bold" style={{ color: tone }}>{value}</div>
    </div>
  );
}
function Mini({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div><div className="text-[10px] uppercase tracking-wide" style={{ color: C.sub }}>{label}</div>
      <div className="font-num text-sm font-bold" style={{ color: tone }}>{value}</div></div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="p-10 text-center text-sm" style={{ color: C.faint }}>{text}</div>;
}
