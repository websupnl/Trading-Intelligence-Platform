'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useSSE } from '@/hooks/useSSE';
import { useToast } from '@/contexts/toast';
import { cn, fmtUSD, cleanSym } from '@/lib/utils';
import { CandlestickChart } from '@/components/live/CandlestickChart';
import { Brain, Zap, Square, ChevronDown, ChevronUp, BarChart2 } from 'lucide-react';

interface OHLCVCandle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface AlpacaPosition { symbol: string; qty: string; side: string; avg_entry_price: string; unrealized_pl: string; unrealized_plpc: string; current_price?: string; }
interface ActivityEvent { action: string; actor: string; message?: string; status?: string; details?: Record<string, unknown>; created_at: string; }
interface Portfolio { equity: number; cash: number; buying_power: number; day_pnl: number; }
interface SignalData { id: string; asset: string; direction: string; confidence: number; reason?: string; status?: string; suggested_entry?: number; suggested_stop?: number; suggested_take_profit?: number; risk_reward?: number; ai_analysis?: { bull_score?: number; bear_score?: number; ta_rsi?: number; ta_trend?: string; }; created_at?: string; }

function fmt(p: number): string {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}
function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function PositionCard({ pos, signal, onClose, closing, onChart, showChart }: {
  pos: AlpacaPosition; signal?: SignalData;
  onClose: (s: string) => void; closing: string | null;
  onChart: () => void; showChart: boolean;
}) {
  const sym = cleanSym(pos.symbol);
  const pnl = parseFloat(pos.unrealized_pl ?? '0');
  const pct = parseFloat(pos.unrealized_plpc ?? '0') * 100;
  const entry = parseFloat(pos.avg_entry_price ?? '0');
  const current = entry * (1 + pct / 100);
  const sl = signal?.suggested_stop;
  const tp = signal?.suggested_take_profit;
  const progress = tp && entry && tp !== entry ? Math.max(0, Math.min(100, ((current - entry) / (tp - entry)) * 100)) : null;

  return (
    <div className={cn('border rounded-xl overflow-hidden', pnl >= 0 ? 'border-green-500/20' : 'border-red-500/20')}>
      <div className="flex items-center gap-3 p-3">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0', pnl >= 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
          {sym.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold">{sym}</span>
            <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', pnl >= 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>LONG</span>
          </div>
          <p className="text-[10px] text-muted-foreground font-num">
            {parseFloat(pos.qty ?? '0') < 1 ? parseFloat(pos.qty).toFixed(5) : parseFloat(pos.qty).toFixed(3)} × ${fmt(entry)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={cn('font-bold text-base font-num', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
          </p>
          <p className={cn('text-xs font-num', pnl >= 0 ? 'text-green-400/70' : 'text-red-400/70')}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
          </p>
        </div>
      </div>

      {(sl || tp) && (
        <div className="flex gap-3 px-3 pb-1 text-[10px] font-num text-muted-foreground">
          {sl && <span>SL <span className="text-red-400">${fmt(sl)}</span></span>}
          {tp && <span>TP <span className="text-green-400">${fmt(tp)}</span></span>}
          {signal?.risk_reward && <span className="ml-auto">R/R {signal.risk_reward.toFixed(2)}</span>}
        </div>
      )}

      {progress !== null && tp && (
        <div className="px-3 pb-2 space-y-1">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full', pnl >= 0 ? 'bg-green-500' : 'bg-red-500')} style={{ width: `${Math.max(2, progress)}%` }} />
          </div>
          <div className="flex justify-between text-[9px] font-num text-muted-foreground">
            <span>${fmt(entry)}</span>
            <span>{progress.toFixed(0)}% naar target</span>
            <span className="text-green-400">${fmt(tp)}</span>
          </div>
        </div>
      )}

      <div className="flex border-t border-border/40">
        <button onClick={onChart} className={cn('flex-1 py-2 text-xs flex items-center justify-center gap-1 transition-colors', showChart ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/40')}>
          <BarChart2 size={11} /> {showChart ? 'Verberg' : 'Grafiek'}
        </button>
        <button onClick={() => onClose(sym)} disabled={closing === sym}
          className="flex-1 py-2 text-xs text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-40 border-l border-border/40">
          {closing === sym ? '…' : 'Sluit'}
        </button>
      </div>
    </div>
  );
}

function SignalCard({ signal, onTrade, acting }: { signal: SignalData; onTrade: (id: string) => void; acting: string | null }) {
  const [open, setOpen] = useState(true);
  const isBuy = signal.direction === 'buy';
  const canAct = !signal.status || signal.status === 'pending';
  const ai = signal.ai_analysis;

  return (
    <div className={cn('border rounded-xl overflow-hidden', isBuy ? 'border-green-500/25 bg-green-500/[0.03]' : 'border-red-500/25 bg-red-500/[0.03]')}>
      <div className="flex items-center gap-2 p-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <span className={cn('font-bold text-sm px-2.5 py-1 rounded-full shrink-0', isBuy ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
          {isBuy ? '▲' : '▼'} {signal.asset}
        </span>
        <div className="flex-1 text-xs text-muted-foreground">
          {(signal.confidence * 100).toFixed(0)}% conf
          {ai?.ta_rsi ? ` · RSI ${ai.ta_rsi.toFixed(0)}` : ''}
          {signal.risk_reward ? ` · R/R ${signal.risk_reward.toFixed(2)}` : ''}
        </div>
        {signal.created_at && <span className="text-[10px] text-muted-foreground shrink-0">{relTime(signal.created_at)}</span>}
        {open ? <ChevronUp size={13} className="text-muted-foreground shrink-0" /> : <ChevronDown size={13} className="text-muted-foreground shrink-0" />}
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/30">
          {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
            <div className="grid grid-cols-3 gap-2 pt-2">
              {signal.suggested_entry && <div className="bg-muted/40 rounded-lg p-2 text-center"><p className="text-[9px] text-muted-foreground">Entry</p><p className="text-xs font-bold font-num">${fmt(signal.suggested_entry)}</p></div>}
              {signal.suggested_stop && <div className="bg-red-500/5 rounded-lg p-2 text-center"><p className="text-[9px] text-red-400/70">Stop</p><p className="text-xs font-bold text-red-400 font-num">${fmt(signal.suggested_stop)}</p></div>}
              {signal.suggested_take_profit && <div className="bg-green-500/5 rounded-lg p-2 text-center"><p className="text-[9px] text-green-400/70">Target</p><p className="text-xs font-bold text-green-400 font-num">${fmt(signal.suggested_take_profit)}</p></div>}
            </div>
          )}
          {ai?.bull_score !== undefined && ai.bear_score !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-green-400 w-10 font-num">🐂{(ai.bull_score * 100).toFixed(0)}%</span>
              <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-muted">
                <div className="bg-green-500" style={{ width: `${(ai.bull_score / ((ai.bull_score + ai.bear_score) || 1) * 100).toFixed(0)}%` }} />
                <div className="bg-red-500 flex-1" />
              </div>
              <span className="text-[10px] text-red-400 w-10 text-right font-num">🐻{(ai.bear_score * 100).toFixed(0)}%</span>
            </div>
          )}
          {signal.reason && <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/30 pt-2">{signal.reason}</p>}
          {canAct && (
            <button onClick={() => onTrade(signal.id)} disabled={acting === signal.id}
              className={cn('w-full h-9 rounded-xl text-sm font-bold transition-colors disabled:opacity-50', isBuy ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white')}>
              {acting === signal.id ? '…' : `📄 Paper trade ${signal.asset}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FeedItem({ event, fresh }: { event: ActivityEvent; fresh: boolean }) {
  const d = (event.details ?? {}) as Record<string, unknown>;
  const conf = d.confidence as number | undefined;
  const asset = d.asset as string | undefined;
  const direction = d.direction as string | undefined;
  const notional = d.notional as number | undefined;
  const time = new Date(event.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  let icon = '🔄'; let color = 'text-muted-foreground';
  if (event.action === 'signal_generated') { icon = '⚖️'; color = 'text-amber-400'; }
  else if (event.action === 'auto_trade_executed') { icon = '✅'; color = 'text-green-400'; }
  else if (event.action === 'position_auto_closed') { icon = '📤'; color = 'text-blue-400'; }
  else if (event.action === 'trailing_stop_updated') { icon = '📈'; color = 'text-green-400/70'; }
  else if (event.action === 'circuit_breaker_triggered') { icon = '🔴'; color = 'text-red-400'; }
  else if (event.action === 'ai_provider_paused') { icon = '⏸️'; color = 'text-amber-400'; }

  const text = (event.message || '').slice(0, 120) || `${asset ? `${asset} ` : ''}${event.action.replace(/_/g, ' ')}`;

  return (
    <div className={cn('flex items-start gap-2.5 px-4 py-2.5 border-b border-border/30 last:border-0', fresh && 'bg-amber-500/5')}>
      <span className="text-sm shrink-0 mt-px leading-none">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={cn('text-xs leading-snug', color)}>{text}</p>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground font-num">
          <span>{time}</span>
          {asset && direction && <span>{direction.toUpperCase()} {asset}{notional ? ` · $${notional.toFixed(0)}` : ''}</span>}
          {conf !== undefined && <span className="ml-auto">{(conf * 100).toFixed(0)}%</span>}
        </div>
      </div>
    </div>
  );
}

export default function AITradingPage() {
  const [connected, setConnected] = useState(false);
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [signals, setSignals] = useState<SignalData[]>([]);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [freshFeed, setFreshFeed] = useState<Set<string>>(new Set());
  const [closing, setClosing] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [chartSym, setChartSym] = useState<string | null>(null);
  const [candles, setCandles] = useState<Record<string, OHLCVCandle[]>>({});
  const [budget, setBudget] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);
  const { toast } = useToast();

  const { data: bot, reload: reloadBot } = useApi(() => api.getBotHealth(), [], { pollIntervalMs: 15000 });
  const { data: account } = useApi(() => api.getAccount(), [], { pollIntervalMs: 15000 });

  const equity = account?.equity ? parseFloat(account.equity) : null;
  const buyingPower = account?.buying_power ? parseFloat(account.buying_power) : null;
  const aiPaused = !!(bot as any)?.ai_guard?.paused;
  const positionSizePct = (bot as any)?.position_size_pct ?? 0.15;
  const tradeAmount = equity ? Math.round(equity * positionSizePct) : null;

  useEffect(() => {
    async function load() {
      try {
        const [pos, sigs, audit] = await Promise.allSettled([api.getPositions(), api.getSignals(30), api.getAuditLogs(60)]);
        if (pos.status === 'fulfilled' && Array.isArray(pos.value)) setPositions(pos.value as AlpacaPosition[]);
        if (sigs.status === 'fulfilled' && Array.isArray(sigs.value)) setSignals(sigs.value as SignalData[]);
        if (audit.status === 'fulfilled' && Array.isArray(audit.value)) setFeed(audit.value as ActivityEvent[]);
      } catch {}
    }
    load();
    const t = setInterval(() => api.getPositions().then(d => Array.isArray(d) && setPositions(d as AlpacaPosition[])).catch(() => {}), 10000);
    return () => clearInterval(t);
  }, []);

  const loadCandlesFor = useCallback(async (sym: string) => {
    if (candles[sym]?.length > 1) return;
    try {
      const pin = typeof window !== 'undefined' ? sessionStorage.getItem('dashboard_pin') || '' : '';
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/stream/candles/${sym}?timeframe=1Day&limit=60`, { headers: { 'X-Dashboard-Pin': pin } });
      const d = await r.json();
      if (d?.candles?.length > 0) setCandles(prev => ({ ...prev, [sym]: d.candles }));
    } catch {}
  }, [candles]);

  useEffect(() => { if (chartSym) loadCandlesFor(chartSym); }, [chartSym, loadCandlesFor]);

  const onSignals = useCallback((d: Record<string, unknown>) => { const s = d.signals as SignalData[]; if (Array.isArray(s)) setSignals(s); }, []);
  const onNewSignal = useCallback((d: Record<string, unknown>) => { const s = d.signal as SignalData; if (s) setSignals(prev => prev.find(x => x.id === s.id) ? prev : [s, ...prev]); }, []);
  const onActivity = useCallback((d: Record<string, unknown>) => {
    const evs = d.events as ActivityEvent[];
    if (!Array.isArray(evs)) return;
    setFeed(prev => {
      const keys = new Set(prev.map(e => `${e.created_at}::${e.action}`));
      const fresh = evs.filter(e => !keys.has(`${e.created_at}::${e.action}`));
      if (!fresh.length) return prev;
      setFreshFeed(new Set(fresh.map(e => `${e.created_at}::${e.action}`)));
      setTimeout(() => setFreshFeed(new Set()), 5000);
      return [...fresh, ...prev].slice(0, 200);
    });
  }, []);

  useSSE('/api/stream/session?symbols=BTC,ETH,SOL,DOGE,AVAX,LINK,LTC,AAVE',
    { signals: onSignals, new_signal: onNewSignal, activity_batch: onActivity },
    { onConnected: () => setConnected(true), onDisconnected: () => setConnected(false) }
  );

  async function saveBudget() {
    if (!equity || !budget) return;
    const amt = parseFloat(budget);
    if (isNaN(amt) || amt < 10) { toast('Minimaal $10', 'error'); return; }
    const pct = Math.min(0.5, amt / equity);
    setSavingBudget(true);
    try {
      await api.updateRuntimeSettings({ position_size_pct: pct });
      toast(`✅ $${amt} per trade (${(pct * 100).toFixed(0)}%)`, 'success');
      setBudget(''); reloadBot();
    } catch (e: any) { toast(`❌ ${e?.detail || 'Fout'}`, 'error'); }
    setSavingBudget(false);
  }

  async function handleAIPause() {
    try {
      if (aiPaused) { await api.resumeAiGuard(); toast('AI hervat ✅', 'success'); }
      else { await api.pauseAiGuard(360, 'Handmatig'); toast('AI gepauzeerd', 'info'); }
      reloadBot();
    } catch {}
  }

  async function doTrade(id: string) {
    setActing(id);
    try {
      let r = await api.paperTradeSignal(id);
      if (r.status === 'requires_manual_approval') { if (!confirm('Doorgaan?')) { setActing(null); return; } r = await api.paperTradeSignal(id, true); }
      toast('✅ Trade ingediend', 'success');
      const s = await api.getSignals(50); if (Array.isArray(s)) setSignals(s);
    } catch (e: any) { toast(`❌ ${e?.detail || 'Fout'}`, 'error'); }
    setActing(null);
  }

  async function doClose(sym: string) {
    setClosing(sym);
    try {
      await api.closePosition(sym); toast(`📤 ${sym} gesloten`, 'success');
      const d = await api.getPositions() as AlpacaPosition[]; setPositions(Array.isArray(d) ? d : []);
    } catch (e: any) { toast(`❌ ${e?.detail || 'Fout'}`, 'error'); }
    setClosing(null);
  }

  const pendingSignals = signals.filter(s => !s.status || s.status === 'pending');
  const totalPnl = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl ?? '0'), 0);
  function sigFor(sym: string) { return signals.find(s => s.asset === sym && s.status === 'paper_traded'); }
  const chartSignal = chartSym ? sigFor(chartSym) : undefined;
  const chartLevels = chartSignal ? { entry: chartSignal.suggested_entry, stopLoss: chartSignal.suggested_stop, takeProfit: chartSignal.suggested_take_profit } : undefined;

  return (
    <div className="space-y-4 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Brain size={20} className="text-purple-400" /> AI Trading</h1>
          <p className="text-xs text-muted-foreground">Volledig autonoom — AI analyseert en handelt zelfstandig</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className={cn('flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border', connected ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-border bg-muted text-muted-foreground')}>
            <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground')} />
            {connected ? 'LIVE' : 'Verbinden…'}
          </div>
          <button onClick={handleAIPause} className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all', aiPaused ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20')}>
            {aiPaused ? <><Zap size={14} /> Hervatten</> : <><Square size={14} /> Pauzeer AI</>}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Portfolio</p>
          <p className="text-xl font-bold font-num mt-0.5">{equity !== null ? fmtUSD(equity) : '—'}</p>
          <p className="text-[10px] text-muted-foreground">{buyingPower !== null ? `${fmtUSD(buyingPower)} vrij` : ''}</p>
        </div>
        <div className={cn('bg-card border rounded-xl p-3', totalPnl >= 0 ? 'border-green-500/20' : 'border-red-500/20')}>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Open P&L</p>
          <p className={cn('text-xl font-bold font-num mt-0.5', totalPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}
          </p>
          <p className="text-[10px] text-muted-foreground">{positions.length} posities</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Per trade</p>
          <p className="text-xl font-bold font-num mt-0.5">{tradeAmount !== null ? fmtUSD(tradeAmount) : '—'}</p>
          <p className="text-[10px] text-muted-foreground">{(positionSizePct * 100).toFixed(0)}% van portfolio</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Budget per trade</p>
          <div className="flex gap-1.5">
            <input value={budget} onChange={e => setBudget(e.target.value)} placeholder="bijv. 50" type="number" min="10"
              className="flex-1 h-7 px-2 text-xs rounded-lg bg-muted border border-border focus:outline-none focus:border-primary font-num w-0" />
            <button onClick={saveBudget} disabled={savingBudget || !budget}
              className="h-7 px-2.5 text-xs font-bold rounded-lg bg-primary text-primary-foreground disabled:opacity-50 shrink-0">
              {savingBudget ? '…' : 'Set'}
            </button>
          </div>
        </div>
      </div>

      {aiPaused && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
          <span className="text-xl">⏸️</span>
          <p className="text-sm font-semibold text-amber-400 flex-1">AI gepauzeerd — geen signalen worden gegenereerd</p>
          <button onClick={handleAIPause} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-500 text-black">Hervatten</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Positions + signals */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Posities ({positions.length})</h2>
          {positions.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
              <p className="text-3xl mb-2 opacity-20">📊</p>
              <p className="text-sm">Geen open posities</p>
              <p className="text-xs mt-1 opacity-60">AI handelt zodra er een goede setup is</p>
            </div>
          ) : positions.map((pos, i) => {
            const sym = cleanSym(pos.symbol);
            return (
              <div key={i}>
                <PositionCard pos={pos} signal={sigFor(sym)} onClose={doClose} closing={closing}
                  onChart={() => setChartSym(chartSym === sym ? null : sym)} showChart={chartSym === sym} />
                {chartSym === sym && (
                  <div className="border border-border rounded-xl overflow-hidden mt-1" style={{ height: 260 }}>
                    {candles[sym]?.length > 1
                      ? <CandlestickChart candles={candles[sym]} signals={[]} levels={chartLevels} dark />
                      : <div className="flex items-center justify-center h-full text-muted-foreground text-sm"><BarChart2 size={20} className="mr-2 opacity-30" />Laden…</div>
                    }
                  </div>
                )}
              </div>
            );
          })}

          {pendingSignals.length > 0 && (
            <div className="space-y-2 pt-1">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Zap size={11} className="text-amber-400" /> Actieve Signalen ({pendingSignals.length})
              </h2>
              {pendingSignals.map(s => <SignalCard key={s.id} signal={s} onTrade={doTrade} acting={acting} />)}
            </div>
          )}
        </div>

        {/* Right: AI live feed */}
        <div className="flex flex-col min-h-[400px]">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Brain size={11} className="text-purple-400" /> AI Denkt Live
            {connected && <span className="ml-auto text-[10px] text-green-400 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />LIVE</span>}
          </h2>
          <div className="bg-card border border-border rounded-xl flex-1 overflow-hidden">
            {feed.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
                <Brain size={28} className="opacity-20" />
                <p className="text-sm">Wachten op AI activiteit…</p>
              </div>
            ) : (
              <div className="max-h-[600px] overflow-y-auto">
                {feed.map((ev, i) => (
                  <FeedItem key={`${ev.created_at}::${ev.action}::${i}`} event={ev}
                    fresh={freshFeed.has(`${ev.created_at}::${ev.action}`)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
