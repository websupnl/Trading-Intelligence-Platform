'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  Activity, Wifi, WifiOff, TrendingUp, TrendingDown, Zap,
  CheckCircle, XCircle, AlertTriangle, RefreshCw, Send,
  BarChart2, Brain, DollarSign, Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSSE } from '@/hooks/useSSE';
import { api } from '@/lib/api';
import { AssetLabel } from '@/components/market/AssetLabel';
import { knownAssetName } from '@/lib/assets';

// Browser-only chart
const CandlestickChart = dynamic(
  () => import('@/components/live/CandlestickChart').then((m) => m.CandlestickChart),
  { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm font-mono">LOADING CHART...</div> }
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface OHLCVCandle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface PriceData { symbol: string; price: number; open: number; high: number; low: number; volume: number; timestamp: string; }
interface SignalData {
  id: string; asset: string; direction: string; confidence: number; reason: string;
  suggested_entry?: number; suggested_stop?: number; suggested_take_profit?: number;
  risk_reward?: number; ai_analysis?: Record<string, unknown>; created_at?: string;
}
interface ActivityEvent { action: string; actor: string; message: string; status: string; entity_type?: string; details?: unknown; created_at: string; }
interface Portfolio { equity: number; cash: number; buying_power: number; day_pnl: number; }
interface ChartSignal { time: number; direction: 'long' | 'short'; symbol: string; }

// ─── Sub-components ──────────────────────────────────────────────────────────

function Stat({ label, value, sub, green, red }: { label: string; value: string; sub?: string; green?: boolean; red?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={cn('font-mono text-sm font-semibold', green && 'text-green-400', red && 'text-red-400', !green && !red && 'text-foreground')}>
        {value}
      </span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function ActivityItem({ event, idx }: { event: ActivityEvent; idx: number }) {
  const color = event.status === 'success' ? 'text-green-400' : event.status === 'error' ? 'text-red-400' : 'text-amber-400';
  const dot = event.status === 'success' ? 'bg-green-400' : event.status === 'error' ? 'bg-red-400' : 'bg-amber-400';
  const time = event.created_at ? new Date(event.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';

  return (
    <div
      className={cn('flex gap-2 py-1.5 border-b border-border text-xs transition-all', idx === 0 && 'animate-pulse-once')}
    >
      <span className={cn('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('font-mono text-[10px] uppercase tracking-wide', color)}>{event.action.replace(/_/g, ' ')}</span>
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">{time}</span>
        </div>
        <p className="text-muted-foreground text-[11px] leading-tight mt-0.5 truncate">{event.message}</p>
      </div>
    </div>
  );
}

function SignalCard({ signal, onApprove, onReject }: { signal: SignalData; onApprove: () => void; onReject: () => void }) {
  const isLong = signal.direction === 'long' || signal.direction === 'buy';
  const bull = signal.ai_analysis?.bull_score as number | undefined;
  const bear = signal.ai_analysis?.bear_score as number | undefined;

  return (
    <div className={cn(
      'border rounded p-3 mb-2 space-y-2',
      isLong ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-mono font-bold', isLong ? 'text-green-400' : 'text-red-400')}>
            {isLong ? '▲ LONG' : '▼ SHORT'}
          </span>
          <AssetLabel symbol={signal.asset} compact className="text-xs font-mono" />
        </div>
        <span className={cn(
          'text-[10px] font-mono px-1.5 py-0.5 rounded',
          signal.confidence >= 0.85 ? 'bg-green-100 text-green-700' : signal.confidence >= 0.75 ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'
        )}>
          {(signal.confidence * 100).toFixed(0)}%
        </span>
      </div>

      {/* Bull/Bear mini bars */}
      {bull !== undefined && bear !== undefined && (
        <div className="flex gap-1 items-center">
          <span className="text-[9px] text-green-500 w-6 text-right">{bull}</span>
          <div className="flex-1 flex h-1.5 rounded overflow-hidden bg-muted">
            <div className="bg-green-500" style={{ width: `${(bull / (bull + bear)) * 100}%` }} />
            <div className="bg-red-500 flex-1" />
          </div>
          <span className="text-[9px] text-red-500 w-6">{bear}</span>
        </div>
      )}

      <div className="text-[11px] text-muted-foreground line-clamp-2">{signal.reason}</div>

      {signal.suggested_entry && (
        <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
          <div><span className="text-muted-foreground">Entry </span><span className="text-foreground">{signal.suggested_entry.toFixed(2)}</span></div>
          {signal.suggested_stop && <div><span className="text-red-600">Stop </span><span className="text-red-400">{signal.suggested_stop.toFixed(2)}</span></div>}
          {signal.suggested_take_profit && <div><span className="text-green-600">TP </span><span className="text-green-400">{signal.suggested_take_profit.toFixed(2)}</span></div>}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-1 text-[11px] bg-green-100 hover:bg-green-200 text-green-700 border border-green-200 rounded py-1 transition-colors"
        >
          <CheckCircle size={11} /> Approve
        </button>
        <button
          onClick={onReject}
          className="flex-1 flex items-center justify-center gap-1 text-[11px] bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 rounded py-1 transition-colors"
        >
          <XCircle size={11} /> Reject
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const DEFAULT_SYMBOLS = ['AAPL', 'NVDA', 'TSLA'];

export default function LiveSessionPage() {
  const [symbols] = useState(DEFAULT_SYMBOLS);
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOLS[0]);
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);

  // Chart data per symbol
  const [chartData, setChartData] = useState<Record<string, OHLCVCandle[]>>({});
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [chartSignals, setChartSignals] = useState<ChartSignal[]>([]);

  // Panel data
  const [pendingSignals, setPendingSignals] = useState<SignalData[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);

  // Quick trade
  const [tradeSide, setTradeSide] = useState<'buy' | 'sell'>('buy');
  const [tradeSymbol, setTradeSymbol] = useState(DEFAULT_SYMBOLS[0]);
  const [tradeQty, setTradeQty] = useState('');
  const [tradeStatus, setTradeStatus] = useState<string | null>(null);
  const [quotePrice, setQuotePrice] = useState<number | null>(null);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── SSE handlers ──────────────────────────────────────────────────────────

  const handleChartData = useCallback((data: Record<string, unknown>) => {
    const sym = data.symbol as string;
    const candles = data.candles as OHLCVCandle[];
    if (sym && Array.isArray(candles)) {
      setChartData((prev) => ({ ...prev, [sym]: candles }));
    }
  }, []);

  const handlePrice = useCallback((data: Record<string, unknown>) => {
    const pd = data as unknown as PriceData;
    if (pd.symbol) setPrices((prev) => ({ ...prev, [pd.symbol]: pd }));
  }, []);

  const handleSignals = useCallback((data: Record<string, unknown>) => {
    const sigs = data.signals as SignalData[];
    if (Array.isArray(sigs)) setPendingSignals(sigs);
  }, []);

  const handleNewSignal = useCallback((data: Record<string, unknown>) => {
    const sig = data.signal as SignalData;
    if (!sig) return;
    // Add marker to chart
    setChartSignals((prev) => {
      const existing = prev.find((m) => m.time === Math.floor(Date.now() / 1000) && m.symbol === sig.asset);
      if (existing) return prev;
      return [...prev, {
        time: Math.floor(Date.now() / 86400) * 86400, // today's date in seconds
        direction: sig.direction === 'long' || sig.direction === 'buy' ? 'long' : 'short',
        symbol: sig.asset,
      }];
    });
  }, []);

  const handleActivity = useCallback((data: Record<string, unknown>) => {
    const events = data.events as ActivityEvent[];
    if (Array.isArray(events)) {
      setActivityFeed((prev) => {
        const existing = new Set(prev.map((e) => e.created_at));
        const newOnes = events.filter((e) => !existing.has(e.created_at));
        return [...newOnes, ...prev].slice(0, 50);
      });
    }
  }, []);

  const handlePortfolio = useCallback((data: Record<string, unknown>) => {
    setPortfolio(data as unknown as Portfolio);
  }, []);

  const handleHeartbeat = useCallback((data: Record<string, unknown>) => {
    setTick(data.tick as number);
  }, []);

  // ── SSE connection ────────────────────────────────────────────────────────

  const symbolParam = symbols.join(',');
  useSSE(
    `/api/stream/session?symbols=${symbolParam}`,
    {
      chart_data: handleChartData,
      price: handlePrice,
      signals: handleSignals,
      new_signal: handleNewSignal,
      activity_batch: handleActivity,
      portfolio: handlePortfolio,
      heartbeat: handleHeartbeat,
    },
    {
      onConnected: () => setConnected(true),
      onDisconnected: () => setConnected(false),
    }
  );

  // ── Fallback: fetch candles via REST if SSE hasn't sent data yet ─────────

  useEffect(() => {
    const timeout = setTimeout(async () => {
      for (const sym of symbols) {
        if (!chartData[sym]) {
          try {
            const res = await fetch(
              `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/stream/candles/${sym}?timeframe=1Day&limit=80`
            );
            const json = await res.json();
            if (Array.isArray(json.candles) && json.candles.length > 0) {
              setChartData((prev) => ({ ...prev, [sym]: json.candles }));
            }
          } catch { /* ignore */ }
        }
      }
    }, 3000); // wait 3s for SSE, then fall back to REST
    return () => clearTimeout(timeout);
  }, [symbols]); // eslint-disable-line

  // ── Quote fetcher ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tradeSymbol) return;
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(async () => {
      try {
        const q = await api.getQuote(tradeSymbol);
        setQuotePrice(q.price || null);
      } catch {
        setQuotePrice(null);
      }
    }, 400);
    return () => { if (quoteTimer.current) clearTimeout(quoteTimer.current); };
  }, [tradeSymbol]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleApprove(signal: SignalData) {
    try {
      let result = await api.paperTradeSignal(signal.id);
      if (result.status === 'requires_manual_approval') {
        if (!confirm('Risk check vereist bevestiging. Deze paper trade uitvoeren?')) return;
        result = await api.paperTradeSignal(signal.id, true);
      }
      setPendingSignals((p) => p.filter((s) => s.id !== signal.id));
      setActivityFeed((prev) => [{
        action: 'signal_approved',
        actor: 'user',
        message: `Signaal goedgekeurd: ${signal.direction.toUpperCase()} ${signal.asset} - ${knownAssetName(signal.asset) || signal.asset}`,
        status: 'success',
        created_at: new Date().toISOString(),
      }, ...prev]);
    } catch (e: unknown) {
      const err = e as { detail?: string };
      console.error('Approve failed', err);
    }
  }

  async function handleReject(signal: SignalData) {
    try {
      await api.rejectSignal(signal.id);
      setPendingSignals((p) => p.filter((s) => s.id !== signal.id));
    } catch {
      // ignore
    }
  }

  async function handleQuickTrade(e: React.FormEvent) {
    e.preventDefault();
    setTradeStatus('Bezig…');
    try {
      const request = {
        symbol: tradeSymbol.toUpperCase(),
        quantity: parseFloat(tradeQty),
        side: tradeSide,
        order_type: 'market',
      };
      let result = await api.submitPaperOrder(request);
      if (result.status === 'requires_manual_approval') {
        if (!confirm('Risk check vereist bevestiging. Deze paper order uitvoeren?')) {
          setTradeStatus('Bevestiging geannuleerd');
          return;
        }
        result = await api.submitPaperOrder({ ...request, confirmed: true });
      }
      setTradeStatus(`✓ ${tradeSide.toUpperCase()} ${tradeQty}x ${tradeSymbol} ingediend`);
      setTradeQty('');
      setTimeout(() => setTradeStatus(null), 4000);
    } catch (e: unknown) {
      const err = e as { detail?: string };
      setTradeStatus(`✗ ${err?.detail || 'Order mislukt'}`);
      setTimeout(() => setTradeStatus(null), 4000);
    }
  }

  // ── Manual chart refresh ─────────────────────────────────────────────────

  const [refreshingCharts, setRefreshingCharts] = useState(false);

  async function handleRefreshCharts() {
    setRefreshingCharts(true);
    try {
      await Promise.all(
        symbols.map(async (sym) => {
          try {
            const data = await api.getCandles(sym);
            if (data && Array.isArray(data.candles)) {
              setChartData((prev) => ({ ...prev, [sym]: data.candles }));
            }
          } catch { /* ignore per-symbol errors */ }
        })
      );
    } finally {
      setRefreshingCharts(false);
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const currentPrice = prices[selectedSymbol];
  const currentCandles = chartData[selectedSymbol] || [];
  const visibleSignals = chartSignals.filter((s) => s.symbol === selectedSymbol);

  const priceChange = currentPrice
    ? ((currentPrice.price - currentPrice.open) / currentPrice.open) * 100
    : null;

  // Latest TA from most recent signal for selected symbol
  const latestSignal = pendingSignals.find((s) => s.asset === selectedSymbol);
  const rsi = latestSignal?.ai_analysis?.ta_rsi as number | undefined;
  const trend = latestSignal?.ai_analysis?.ta_trend as string | undefined;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col -m-3 md:-m-4 bg-background overflow-hidden" style={{ height: 'calc(100dvh - 48px)' }}>

      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Activity size={14} className="text-amber-400" />
            <span className="text-xs font-mono font-bold tracking-widest text-foreground uppercase">Live Session</span>
          </div>
          <div className={cn('flex items-center gap-1 text-[10px] font-mono', connected ? 'text-green-400' : 'text-muted-foreground')}>
            {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
            {connected ? `LIVE · tick ${tick}` : 'OFFLINE'}
          </div>
        </div>

        {/* Symbol tabs */}
        <div className="flex gap-1">
          {symbols.map((sym) => {
            const p = prices[sym];
            const chg = p ? ((p.price - p.open) / p.open) * 100 : null;
            return (
              <button
                key={sym}
                onClick={() => setSelectedSymbol(sym)}
                className={cn(
                  'px-3 py-1 rounded text-xs font-mono transition-all',
                  selectedSymbol === sym
                    ? 'bg-accent border border-green-200 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <AssetLabel symbol={sym} compact />
                {chg !== null && (
                  <span className={cn('ml-1 text-[10px]', chg >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Portfolio mini + refresh */}
        <div className="hidden md:flex items-center gap-4 text-[11px] font-mono">
          {portfolio && (
            <>
              <Stat label="Equity" value={`$${portfolio.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
              <Stat label="Day P&L" value={`${portfolio.day_pnl >= 0 ? '+' : ''}$${portfolio.day_pnl.toFixed(2)}`} green={portfolio.day_pnl > 0} red={portfolio.day_pnl < 0} />
            </>
          )}
          <button
            onClick={handleRefreshCharts}
            disabled={refreshingCharts}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-muted hover:bg-accent border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Grafiekdata handmatig verversen"
          >
            <RefreshCw size={10} className={refreshingCharts ? 'animate-spin' : ''} />
            {refreshingCharts ? 'Laden...' : 'Ververs grafieken'}
          </button>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

        {/* Left: chart + stats */}
        <div className="flex flex-col flex-1 min-w-0 border-b md:border-b-0 md:border-r border-border" style={{ minHeight: 0 }}>

          {/* Price stats bar */}
          <div className="flex items-center gap-6 px-4 py-2 border-b border-border shrink-0 bg-card/50 overflow-x-auto">
            {currentPrice ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xl font-bold text-foreground">
                    ${currentPrice.price.toFixed(2)}
                  </span>
                  {priceChange !== null && (
                    <span className={cn('text-sm font-mono font-medium', priceChange >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {priceChange >= 0 ? <TrendingUp size={12} className="inline mr-0.5" /> : <TrendingDown size={12} className="inline mr-0.5" />}
                      {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="h-6 w-px bg-border" />
                <Stat label="Open" value={`$${currentPrice.open.toFixed(2)}`} />
                <Stat label="High" value={`$${currentPrice.high.toFixed(2)}`} green />
                <Stat label="Low" value={`$${currentPrice.low.toFixed(2)}`} red />
                <Stat label="Vol" value={currentPrice.volume.toLocaleString('en-US')} />
                {rsi !== undefined && <Stat label="RSI" value={rsi.toFixed(1)} green={rsi < 30} red={rsi > 70} />}
                {trend && <Stat label="Trend" value={trend.toUpperCase()} green={trend === 'bullish'} red={trend === 'bearish'} />}
              </>
            ) : (
              <span className="text-xs text-muted-foreground font-mono">Wachten op prijsdata voor <AssetLabel symbol={selectedSymbol} compact /></span>
            )}
          </div>

          {/* Chart */}
          <div className="flex-1 min-h-0 p-2" style={{ minHeight: '200px' }}>
            {currentCandles.length > 0 ? (
              <CandlestickChart
                candles={currentCandles}
                signals={visibleSignals}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <BarChart2 size={32} className="opacity-40" />
                <span className="text-sm font-mono">Geen grafiekdata voor <AssetLabel symbol={selectedSymbol} compact /></span>
                <div className="text-center space-y-1 max-w-xs">
                  <p className="text-xs text-muted-foreground">Candle data wordt via de SSE stream aangeleverd. Zorg dat de Pipeline minimaal 1x gedraaid heeft.</p>
                  <p className="text-xs text-muted-foreground">Klik op <strong className="text-foreground">&apos;Ververs grafieken&apos;</strong> om handmatig te laden.</p>
                </div>
                <button
                  onClick={handleRefreshCharts}
                  disabled={refreshingCharts}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-muted hover:bg-accent border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={12} className={refreshingCharts ? 'animate-spin' : ''} />
                  {refreshingCharts ? 'Laden...' : 'Ververs grafieken'}
                </button>
              </div>
            )}
          </div>

          {/* AI Signal indicators for this symbol */}
          {latestSignal && (
            <div className={cn(
              'flex items-center gap-3 px-4 py-2 border-t border-border shrink-0 text-xs font-mono',
              latestSignal.direction === 'long' || latestSignal.direction === 'buy' ? 'bg-green-50' : 'bg-red-50'
            )}>
              <Brain size={12} className="text-amber-400 shrink-0" />
              <span className="text-amber-400 font-bold">AI SIGNAAL:</span>
              <span className={latestSignal.direction === 'long' ? 'text-green-400' : 'text-red-400'}>
                {latestSignal.direction.toUpperCase()} <AssetLabel symbol={latestSignal.asset} compact />
              </span>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground truncate">{latestSignal.reason}</span>
              <span className={cn(
                'ml-auto px-2 py-0.5 rounded text-[10px] shrink-0',
                latestSignal.confidence >= 0.85 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              )}>
                {(latestSignal.confidence * 100).toFixed(0)}% conf
              </span>
            </div>
          )}
        </div>

        {/* Right: activity + signals + trade */}
        <div className="w-full md:w-80 xl:w-96 flex flex-col shrink-0 overflow-hidden max-h-[45vh] md:max-h-none">

          {/* AI Activity feed */}
          <div className="flex-1 flex flex-col min-h-0 border-b border-border">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0">
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-amber-400 uppercase tracking-wider">
                <Brain size={11} />
                AI Activiteit
              </div>
              {connected && (
                <span className="text-[9px] font-mono text-green-500 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-1 min-h-0">
              {activityFeed.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                  <Clock size={20} className="opacity-40" />
                  <span className="text-xs font-mono">Wachten op AI activiteit…</span>
                </div>
              ) : (
                activityFeed.map((event, idx) => (
                  <ActivityItem key={`${event.created_at}-${idx}`} event={event} idx={idx} />
                ))
              )}
            </div>
          </div>

          {/* Pending signals */}
          <div className="shrink-0 border-b border-border" style={{ maxHeight: '40%' }}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-amber-400 uppercase tracking-wider">
                <Zap size={11} />
                Signalen
                {pendingSignals.length > 0 && (
                  <span className="bg-amber-500 text-black text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {pendingSignals.length}
                  </span>
                )}
              </div>
            </div>
            <div className="overflow-y-auto p-2" style={{ maxHeight: 'calc(40% - 32px)' }}>
              {pendingSignals.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-xs font-mono">Geen pending signalen</div>
              ) : (
                pendingSignals.slice(0, 3).map((sig) => (
                  <SignalCard
                    key={sig.id}
                    signal={sig}
                    onApprove={() => handleApprove(sig)}
                    onReject={() => handleReject(sig)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Quick trade */}
          <div className="shrink-0 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-amber-400 uppercase tracking-wider mb-2">
              <DollarSign size={11} />
              Quick Trade
            </div>
            <form onSubmit={handleQuickTrade} className="space-y-2">
              {/* Buy/Sell toggle */}
              <div className="flex rounded overflow-hidden border border-border">
                <button
                  type="button"
                  onClick={() => setTradeSide('buy')}
                  className={cn(
                    'flex-1 py-1.5 text-xs font-mono font-bold transition-colors',
                    tradeSide === 'buy' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => setTradeSide('sell')}
                  className={cn(
                    'flex-1 py-1.5 text-xs font-mono font-bold transition-colors',
                    tradeSide === 'sell' ? 'bg-red-600 text-white' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  SELL
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  value={tradeSymbol}
                  onChange={(e) => setTradeSymbol(e.target.value.toUpperCase())}
                  placeholder="TICKER"
                  className="w-24 px-2 py-1.5 text-xs font-mono bg-card border border-border rounded text-foreground placeholder:text-muted-foreground uppercase"
                />
                <input
                  type="number"
                  value={tradeQty}
                  onChange={(e) => setTradeQty(e.target.value)}
                  placeholder="Qty"
                  min="1"
                  step="1"
                  className="flex-1 px-2 py-1.5 text-xs font-mono bg-card border border-border rounded text-foreground placeholder:text-muted-foreground"
                />
              </div>
              {tradeSymbol && <AssetLabel symbol={tradeSymbol} compact className="text-[11px] font-mono" />}

              {/* Live quote */}
              {quotePrice && (
                <div className="text-[11px] font-mono text-muted-foreground flex justify-between">
                  <span>Prijs: <span className="text-foreground">${quotePrice.toFixed(2)}</span></span>
                  {tradeQty && !isNaN(parseFloat(tradeQty)) && (
                    <span>Totaal: <span className="text-foreground">${(quotePrice * parseFloat(tradeQty)).toFixed(2)}</span></span>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={!tradeQty || !tradeSymbol}
                className={cn(
                  'w-full flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono font-bold transition-colors',
                  tradeSide === 'buy'
                    ? 'bg-primary hover:bg-primary/90 text-white disabled:bg-muted disabled:text-muted-foreground'
                    : 'bg-red-600 hover:bg-red-700 text-white disabled:bg-muted disabled:text-muted-foreground'
                )}
              >
                <Send size={11} />
                {tradeSide === 'buy' ? 'KOOP' : 'VERKOOP'} {tradeSymbol || '---'}
              </button>

              {tradeStatus && (
                <div className={cn(
                  'text-[11px] font-mono text-center py-1 rounded',
                  tradeStatus.startsWith('✓') ? 'text-green-700 bg-green-50' : tradeStatus.startsWith('✗') ? 'text-red-700 bg-red-50' : 'text-amber-700'
                )}>
                  {tradeStatus}
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
