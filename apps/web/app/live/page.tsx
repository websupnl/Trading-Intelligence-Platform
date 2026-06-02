'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { cn, fmtUSD, cleanSym } from '@/lib/utils';
import { useSSE } from '@/hooks/useSSE';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { useToast } from '@/contexts/toast';
import { PriceChart } from '@/components/charts/PriceChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { X, Activity, Wifi, WifiOff } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────
interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface PriceData { symbol: string; price: number; open: number; high: number; low: number; volume: number; }
interface AiAnalysis { bull_score?: number; bear_score?: number; ta_rsi?: number; ta_trend?: string; ta_macd?: string; news_count?: number; key_risks?: string; }
interface Signal { id: string; asset: string; direction: string; confidence: number; reason?: string; status?: string; timeframe?: string; suggested_entry?: number; suggested_stop?: number; suggested_take_profit?: number; risk_reward?: number; ai_analysis?: AiAnalysis; created_at?: string; }
interface Event { action: string; actor: string; message?: string; details?: Record<string, unknown>; created_at: string; }
interface Portfolio { equity: number; cash: number; buying_power: number; day_pnl: number; }
interface Position { symbol: string; qty: string; side: string; avg_entry_price: string; unrealized_pl: string; unrealized_plpc: string; }

// ── Palette (exchange-style, self-contained for this terminal) ───────────────
const C = {
  bg: '#0b0e13', panel: '#12161c', panel2: '#171c24', line: '#1e2630',
  text: '#eaeef3', sub: '#7a8694', faint: '#4a5563',
  up: '#2ebd85', down: '#f6465d', gold: '#f0b90b',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(p: number): string {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}
function isPending(s?: Signal) { return s && (!s.status || s.status === 'pending'); }
function relTime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
const ALL = ['BTC','ETH','SOL','DOGE','AVAX','LINK','LTC','AAVE','BCH','UNI','ALGO'];
const NAMES: Record<string,string> = { BTC:'Bitcoin',ETH:'Ethereum',SOL:'Solana',DOGE:'Dogecoin',AVAX:'Avalanche',LINK:'Chainlink',LTC:'Litecoin',AAVE:'Aave',BCH:'Bitcoin Cash',UNI:'Uniswap',ALGO:'Algorand' };

// ── Market row ───────────────────────────────────────────────────────────────
function MarketRow({ sym, price, spark, signal, selected, onClick }: {
  sym: string; price?: PriceData; spark: number[]; signal?: Signal; selected: boolean; onClick: () => void;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const up = pct != null && pct >= 0;
  const pend = isPending(signal);
  const isBuy = signal?.direction === 'buy';
  return (
    <button onClick={onClick}
      className="group grid w-full grid-cols-[1.4fr_1fr_0.9fr_0.8fr] items-center gap-2 px-3 h-[52px] text-left transition-colors"
      style={{ background: selected ? C.panel2 : 'transparent', borderLeft: `2px solid ${selected ? C.gold : 'transparent'}` }}>
      <div className="flex items-center gap-2 min-w-0">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold"
          style={{ background: C.panel2, color: C.sub }}>{sym.slice(0, 3)}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold" style={{ color: C.text }}>{sym}</span>
            <span className="text-[10px]" style={{ color: C.faint }}>/USD</span>
          </div>
          <div className="truncate text-[10px]" style={{ color: C.sub }}>{NAMES[sym] ?? sym}</div>
        </div>
      </div>
      <div className="text-right font-num text-[13px]" style={{ color: price ? C.text : C.faint }}>
        {price ? `$${fmt(price.price)}` : '—'}
      </div>
      <div className="text-right font-num text-[12px] font-semibold" style={{ color: pct == null ? C.faint : up ? C.up : C.down }}>
        {pct == null ? '—' : `${up ? '+' : ''}${pct.toFixed(2)}%`}
      </div>
      <div className="flex items-center justify-end gap-2">
        <div className="w-12"><Sparkline data={spark} height={26} color={up ? C.up : C.down} /></div>
        {pend && (
          <span className="rounded px-1 py-0.5 text-[9px] font-bold"
            style={{ background: (isBuy ? C.up : C.down) + '22', color: isBuy ? C.up : C.down }}>
            {isBuy ? 'BUY' : 'SELL'}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────
function Detail({ sym, price, candles, signal, onClose, onTrade, onReject, acting }: {
  sym: string; price?: PriceData; candles: Candle[]; signal?: Signal;
  onClose: () => void; onTrade: (id: string) => void; onReject: (id: string) => void; acting: string | null;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const up = pct != null && pct >= 0;
  const pend = isPending(signal);
  const isBuy = signal?.direction === 'buy';
  const ta = signal?.ai_analysis;
  return (
    <div className="flex flex-col" style={{ background: C.panel }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold" style={{ color: C.text }}>{sym}<span className="text-xs font-normal" style={{ color: C.faint }}>/USD</span></span>
          {price && <span className="font-num text-base" style={{ color: C.text }}>${fmt(price.price)}</span>}
          {pct != null && <span className="font-num text-xs font-semibold" style={{ color: up ? C.up : C.down }}>{up ? '+' : ''}{pct.toFixed(2)}%</span>}
        </div>
        <button onClick={onClose} className="rounded p-1 hover:opacity-70" style={{ color: C.sub }}><X size={16} /></button>
      </div>

      <div className="px-2 pt-2">
        {candles.length > 1 ? <PriceChart candles={candles} height={220} /> : <div className="grid h-[220px] place-items-center text-xs" style={{ color: C.faint }}>chart laadt…</div>}
      </div>

      {price && (
        <div className="grid grid-cols-3 gap-px px-4 py-2 text-[11px]" style={{ color: C.sub }}>
          <div>24h hoog <div className="font-num" style={{ color: C.text }}>${fmt(price.high)}</div></div>
          <div>24h laag <div className="font-num" style={{ color: C.text }}>${fmt(price.low)}</div></div>
          <div>volume <div className="font-num" style={{ color: C.text }}>{price.volume ? price.volume.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}</div></div>
        </div>
      )}

      {pend && signal ? (
        <div className="m-3 rounded-lg p-3" style={{ background: C.panel2, border: `1px solid ${(isBuy ? C.up : C.down)}55` }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold" style={{ color: isBuy ? C.up : C.down }}>{isBuy ? '▲ BUY-signaal' : '▼ SELL-signaal'}</span>
            <span className="font-num text-xs" style={{ color: C.sub }}>conf {(signal.confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="mb-2 h-1 overflow-hidden rounded-full" style={{ background: C.line }}>
            <div className="h-full rounded-full" style={{ width: `${(signal.confidence * 100).toFixed(0)}%`, background: isBuy ? C.up : C.down }} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            {[['entry', signal.suggested_entry], ['stop', signal.suggested_stop], ['target', signal.suggested_take_profit]].map(([k, v]) => (
              <div key={k as string} className="rounded py-1.5" style={{ background: C.panel }}>
                <div style={{ color: C.faint }}>{k}</div>
                <div className="font-num" style={{ color: k === 'stop' ? C.down : k === 'target' ? C.up : C.text }}>{v ? `$${fmt(v as number)}` : '—'}</div>
              </div>
            ))}
          </div>
          {signal.risk_reward != null && <div className="mt-2 text-center text-[11px]" style={{ color: C.sub }}>R/R <span className="font-num" style={{ color: C.gold }}>{signal.risk_reward.toFixed(2)}</span></div>}
          {ta && (
            <div className="mt-2 flex flex-wrap gap-1 text-[10px]" style={{ color: C.sub }}>
              {ta.ta_rsi != null && <span className="rounded px-1.5 py-0.5" style={{ background: C.panel }}>RSI {ta.ta_rsi.toFixed(0)}</span>}
              {ta.ta_trend && <span className="rounded px-1.5 py-0.5" style={{ background: C.panel }}>{ta.ta_trend}</span>}
              {ta.ta_macd && <span className="rounded px-1.5 py-0.5" style={{ background: C.panel }}>MACD {ta.ta_macd}</span>}
              {ta.bull_score != null && <span className="rounded px-1.5 py-0.5" style={{ background: C.panel }}>bull {(ta.bull_score * 100).toFixed(0)}</span>}
            </div>
          )}
          {signal.reason && <p className="mt-2 text-[11px] leading-snug" style={{ color: C.sub }}>{signal.reason}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => onTrade(signal.id)} disabled={acting === signal.id}
              className="rounded-md py-2 text-sm font-semibold disabled:opacity-50"
              style={{ background: isBuy ? C.up : C.down, color: '#06231a' }}>
              {acting === signal.id ? '…' : 'Uitvoeren'}
            </button>
            <button onClick={() => onReject(signal.id)} disabled={acting === signal.id}
              className="rounded-md py-2 text-sm font-medium disabled:opacity-50"
              style={{ background: C.panel, color: C.sub, border: `1px solid ${C.line}` }}>
              Afwijzen
            </button>
          </div>
        </div>
      ) : (
        <div className="m-3 rounded-lg p-4 text-center text-xs" style={{ background: C.panel2, color: C.faint }}>
          Geen open signaal voor {sym}. Het systeem analyseert continu — een setup verschijnt hier zodra het brein er één ziet.
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function LivePage() {
  const [connected, setConnected] = useState(false);
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [candles, setCandles] = useState<Record<string, Candle[]>>({});
  const [signals, setSignals] = useState<Signal[]>([]);
  const [feed, setFeed] = useState<Event[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [tab, setTab] = useState<'positions' | 'feed'>('positions');
  const [filter, setFilter] = useState<'all' | 'signals'>('all');
  const { toast } = useToast();

  const { data: initSigs } = useApi(() => api.getSignals(50), []);
  const { data: initAudit } = useApi(() => api.getAuditLogs(60), []);
  useEffect(() => { if (initSigs && Array.isArray(initSigs) && !signals.length) setSignals(initSigs as Signal[]); }, [initSigs]);
  useEffect(() => { if (initAudit && Array.isArray(initAudit) && !feed.length) setFeed(initAudit as Event[]); }, [initAudit]);

  useEffect(() => {
    const load = async () => { try { const d = await api.getPositions() as Position[]; setPositions(Array.isArray(d) ? d : []); } catch {} };
    load(); const t = setInterval(load, 10000); return () => clearInterval(t);
  }, []);

  const loadCandles = useCallback(async (sym: string) => {
    if (candles[sym]?.length > 1) return;
    try {
      const pin = typeof window !== 'undefined' ? sessionStorage.getItem('dashboard_pin') || '' : '';
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/stream/candles/${sym}?timeframe=1Day&limit=60`, { headers: { 'X-Dashboard-Pin': pin } });
      const d = await r.json();
      if (d?.candles?.length > 0) {
        setCandles(prev => ({ ...prev, [sym]: d.candles }));
        const last = d.candles.at(-1);
        if (last) setPrices(prev => prev[sym] ? prev : { ...prev, [sym]: { symbol: sym, price: last.close, open: d.candles[0].open, high: last.high, low: last.low, volume: last.volume } });
      }
    } catch {}
  }, [candles]);

  const onPrice = useCallback((d: Record<string, unknown>) => { const p = d as unknown as PriceData; if (p.symbol) setPrices(prev => ({ ...prev, [p.symbol]: p })); }, []);
  const onChartData = useCallback((d: Record<string, unknown>) => {
    const sym = d.symbol as string; const cs = d.candles as Candle[];
    if (sym && Array.isArray(cs) && cs.length > 0) {
      setCandles(prev => ({ ...prev, [sym]: cs }));
      const last = cs.at(-1)!;
      setPrices(prev => prev[sym] ? prev : { ...prev, [sym]: { symbol: sym, price: last.close, open: cs[0].open, high: last.high, low: last.low, volume: last.volume } });
    }
  }, []);
  const onSignals = useCallback((d: Record<string, unknown>) => { const s = d.signals as Signal[]; if (Array.isArray(s)) setSignals(s); }, []);
  const onNewSignal = useCallback((d: Record<string, unknown>) => { const s = d.signal as Signal; if (s) setSignals(prev => prev.find(x => x.id === s.id) ? prev : [s, ...prev]); }, []);
  const onActivity = useCallback((d: Record<string, unknown>) => {
    const evs = d.events as Event[]; if (!Array.isArray(evs)) return;
    setFeed(prev => {
      const keys = new Set(prev.map(e => `${e.created_at}::${e.action}`));
      const fresh = evs.filter(e => !keys.has(`${e.created_at}::${e.action}`));
      return fresh.length ? [...fresh, ...prev].slice(0, 100) : prev;
    });
  }, []);
  const onPortfolio = useCallback((d: Record<string, unknown>) => setPortfolio(d as unknown as Portfolio), []);

  useSSE(`/api/stream/session?symbols=${ALL.join(',')}`,
    { price: onPrice, chart_data: onChartData, signals: onSignals, new_signal: onNewSignal, activity_batch: onActivity, portfolio: onPortfolio },
    { onConnected: () => setConnected(true), onDisconnected: () => setConnected(false) }
  );

  const signalMap = useMemo(() => {
    const m: Record<string, Signal> = {};
    [...signals].reverse().forEach(s => { m[s.asset] = s; });
    signals.filter(isPending).forEach(s => { m[s.asset] = s; });
    return m;
  }, [signals]);

  const totalPnl = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl ?? '0'), 0);
  const pendingCount = useMemo(() => signals.filter(isPending).length, [signals]);

  const rows = useMemo(() => {
    const extras = signals.map(s => s.asset).filter(a => !ALL.includes(a)).filter((v, i, a) => a.indexOf(v) === i);
    const base = filter === 'signals' ? [...ALL, ...extras].filter(s => isPending(signalMap[s])) : [...ALL, ...extras];
    return base.sort((a, b) => {
      const pa = isPending(signalMap[a]) ? 1 : 0, pb = isPending(signalMap[b]) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const ca = prices[a] ? Math.abs((prices[a].price - prices[a].open) / prices[a].open) : -1;
      const cb = prices[b] ? Math.abs((prices[b].price - prices[b].open) / prices[b].open) : -1;
      return cb - ca;
    });
  }, [signals, signalMap, filter, prices]);

  const detailRef = useRef<HTMLDivElement | null>(null);
  // Eager-load every visible market on mount so the table fills immediately,
  // instead of trickling in over the SSE cycle (or only on click).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { ALL.forEach((s) => loadCandles(s)); }, []);
  useEffect(() => { if (selected) loadCandles(selected); }, [selected, loadCandles]);
  // On mobile, jump straight to the chart when a market is picked.
  useEffect(() => {
    if (selected && typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selected]);

  async function doTrade(id: string) {
    setActing(id);
    try {
      let r = await api.paperTradeSignal(id);
      if (r.status === 'requires_manual_approval') { if (!confirm('Doorgaan?')) { setActing(null); return; } r = await api.paperTradeSignal(id, true); }
      toast('✅ Trade ingediend', 'success');
      const s = await api.getSignals(100); if (Array.isArray(s)) setSignals(s);
    } catch (e: any) { toast(`❌ ${e?.detail?.reasons?.join(', ') || e?.detail || 'Fout'}`, 'error'); }
    setActing(null);
  }
  async function doReject(id: string) {
    setActing(id);
    try { await api.rejectSignal(id); toast('Afgewezen', 'info'); const s = await api.getSignals(100); if (Array.isArray(s)) setSignals(s); } catch {}
    setActing(null);
  }
  async function doClose(sym: string) {
    setClosing(sym);
    try { await api.closePosition(sym); toast(`📤 ${sym} gesloten`, 'success'); const d = await api.getPositions() as Position[]; setPositions(Array.isArray(d) ? d : []); }
    catch (e: any) { toast(`❌ ${e?.detail || 'Fout'}`, 'error'); }
    setClosing(null);
  }

  const sel = selected ?? rows[0] ?? 'BTC';
  const dayPnl = portfolio?.day_pnl ?? 0;

  return (
    <div className="min-h-screen pb-20 md:pb-4" style={{ background: C.bg, color: C.text }}>
      {/* Account strip */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3"
        style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }}>
        <div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: C.sub }}>Equity</div>
          <div className="font-num text-lg font-bold">{portfolio ? fmtUSD(portfolio.equity) : '—'}</div>
        </div>
        <Metric label="Dag P&L" value={portfolio ? fmtUSD(dayPnl) : '—'} tone={dayPnl > 0 ? C.up : dayPnl < 0 ? C.down : C.text} />
        <Metric label="Open P&L" value={fmtUSD(totalPnl)} tone={totalPnl > 0 ? C.up : totalPnl < 0 ? C.down : C.text} />
        <Metric label="Buying power" value={portfolio ? fmtUSD(portfolio.buying_power) : '—'} tone={C.text} />
        <Metric label="Open posities" value={String(positions.length)} tone={C.text} />
        <Metric label="Signalen" value={String(pendingCount)} tone={pendingCount ? C.gold : C.sub} />
        <div className="ml-auto flex items-center gap-1.5 text-[11px]" style={{ color: connected ? C.up : C.down }}>
          {connected ? <Wifi size={13} /> : <WifiOff size={13} />}{connected ? 'live' : 'offline'}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {/* Markets table */}
        <div style={{ borderRight: `1px solid ${C.line}` }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${C.line}` }}>
            <span className="text-xs font-semibold" style={{ color: C.sub }}>Markten</span>
            <div className="flex gap-1 text-[11px]">
              {(['all', 'signals'] as const).map(k => (
                <button key={k} onClick={() => setFilter(k)} className="rounded px-2 py-0.5 font-medium"
                  style={{ background: filter === k ? C.panel2 : 'transparent', color: filter === k ? C.text : C.sub }}>
                  {k === 'all' ? 'Alles' : `Signalen ${pendingCount ? `(${pendingCount})` : ''}`}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1.4fr_1fr_0.9fr_0.8fr] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wide"
            style={{ color: C.faint, borderBottom: `1px solid ${C.line}` }}>
            <span>Asset</span><span className="text-right">Prijs</span><span className="text-right">24u</span><span className="text-right">Trend</span>
          </div>
          <div className="divide-y" style={{ borderColor: C.line }}>
            {rows.map(sym => (
              <div key={sym} style={{ borderBottom: `1px solid ${C.line}` }}>
                <MarketRow sym={sym} price={prices[sym]} spark={(candles[sym] ?? []).slice(-20).map(c => c.close)}
                  signal={signalMap[sym]} selected={sel === sym} onClick={() => setSelected(sym)} />
              </div>
            ))}
          </div>
        </div>

        {/* Detail + lower tabs */}
        <div ref={detailRef} className="flex flex-col scroll-mt-16" style={{ background: C.bg }}>
          <Detail sym={sel} price={prices[sel]} candles={candles[sel] ?? []} signal={signalMap[sel]}
            onClose={() => setSelected(null)} onTrade={doTrade} onReject={doReject} acting={acting} />

          <div className="mt-2 flex gap-1 px-3" style={{ borderBottom: `1px solid ${C.line}` }}>
            {([['positions', `Posities ${positions.length}`], ['feed', 'Activiteit']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className="px-3 py-2 text-xs font-semibold"
                style={{ color: tab === k ? C.text : C.sub, borderBottom: `2px solid ${tab === k ? C.gold : 'transparent'}` }}>
                {label}
              </button>
            ))}
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {tab === 'positions' ? (
              positions.length === 0 ? <Blank>Geen open posities.</Blank> :
                positions.map((p, i) => {
                  const pnl = parseFloat(p.unrealized_pl ?? '0'); const pct = parseFloat(p.unrealized_plpc ?? '0') * 100; const up = pnl >= 0;
                  return (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${C.line}` }}>
                      <div>
                        <div className="text-[13px] font-semibold">{cleanSym(p.symbol)}</div>
                        <div className="font-num text-[10px]" style={{ color: C.sub }}>{parseFloat(p.qty).toLocaleString('en-US', { maximumFractionDigits: 4 })} @ ${fmt(parseFloat(p.avg_entry_price))}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-num text-[13px] font-semibold" style={{ color: up ? C.up : C.down }}>{up ? '+' : ''}{fmtUSD(pnl)}</div>
                        <div className="font-num text-[10px]" style={{ color: up ? C.up : C.down }}>{up ? '+' : ''}{pct.toFixed(2)}%</div>
                      </div>
                      <button onClick={() => doClose(cleanSym(p.symbol))} disabled={closing === cleanSym(p.symbol)}
                        className="ml-3 rounded px-2.5 py-1 text-[11px] font-medium disabled:opacity-50"
                        style={{ background: C.panel2, color: C.down, border: `1px solid ${C.down}44` }}>
                        Sluit
                      </button>
                    </div>
                  );
                })
            ) : (
              feed.length === 0 ? <Blank>Nog geen activiteit.</Blank> :
                feed.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 px-4 py-2" style={{ borderBottom: `1px solid ${C.line}` }}>
                    <Activity size={12} className="mt-0.5 shrink-0" style={{ color: C.sub }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px]">{ev.message || ev.action}</div>
                      <div className="text-[10px]" style={{ color: C.faint }}>{ev.actor} · {relTime(ev.created_at)}</div>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: '#7a8694' }}>{label}</div>
      <div className="font-num text-sm font-semibold" style={{ color: tone }}>{value}</div>
    </div>
  );
}
function Blank({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-xs" style={{ color: '#4a5563' }}>{children}</div>;
}
