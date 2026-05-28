'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useSSE } from '@/hooks/useSSE';
import { api } from '@/lib/api';
import { ChevronDown, ChevronUp } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface OHLCVCandle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface PriceData { symbol: string; price: number; open: number; high: number; low: number; volume: number; }
interface SignalData { id: string; asset: string; direction: string; confidence: number; reason?: string; suggested_entry?: number; suggested_stop?: number; suggested_take_profit?: number; ai_analysis?: Record<string, unknown>; }
interface ActivityEvent { action: string; actor: string; message?: string; status?: string; details?: Record<string, unknown>; created_at: string; }
interface Portfolio { equity: number; cash: number; buying_power: number; day_pnl: number; }
interface AlpacaPosition { symbol: string; qty: string; side: string; avg_entry_price: string; unrealized_pl: string; unrealized_plpc: string; }

// ── Constants ────────────────────────────────────────────────────────────────

const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'LTC', 'BCH', 'UNI', 'AAVE', 'ALGO'];
const SYMBOLS_PARAM = CRYPTO_SYMBOLS.join(',');
const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', DOGE: 'Dogecoin',
  AVAX: 'Avalanche', LINK: 'Chainlink', LTC: 'Litecoin', BCH: 'Bitcoin Cash',
  UNI: 'Uniswap', AAVE: 'Aave', ALGO: 'Algorand',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function actionMeta(action: string): { icon: string; color: string; label: string } {
  if (action === 'signal_generated') return { icon: '⚖️', color: 'text-amber-400', label: 'Signaal gegenereerd' };
  if (action === 'auto_trade_executed') return { icon: '✅', color: 'text-green-400', label: 'Trade uitgevoerd' };
  if (action === 'auto_trade_risk_rejected') return { icon: '🚫', color: 'text-orange-400', label: 'Risk check gefaald' };
  if (action === 'auto_trade_manual_required') return { icon: '⚠️', color: 'text-amber-400', label: 'Handmatige bevestiging' };
  if (action === 'circuit_breaker_triggered') return { icon: '🔴', color: 'text-red-500', label: 'Circuit breaker' };
  if (action.includes('reflection') || action.includes('lesson') || action === 'trade_reflection_written') return { icon: '💡', color: 'text-purple-400', label: 'Tradeles' };
  if (action === 'ai_provider_paused') return { icon: '⏸️', color: 'text-amber-400', label: 'AI gepauzeerd' };
  if (action.includes('position_close') || action === 'position_auto_closed') return { icon: '📤', color: 'text-blue-400', label: 'Positie gesloten' };
  if (action === 'skipped_existing' || action === 'skipped_conflict') return { icon: '⏭️', color: 'text-muted-foreground', label: 'Overgeslagen' };
  if (action === 'auto_trade_broker_error') return { icon: '⚡', color: 'text-red-400', label: 'Broker fout' };
  return { icon: '🔄', color: 'text-muted-foreground', label: action.replace(/_/g, ' ') };
}

function fmtPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}

// ── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ candles }: { candles: OHLCVCandle[] }) {
  if (candles.length < 2) {
    return <div className="w-16 h-6 flex items-end"><div className="w-full h-px bg-border opacity-40" /></div>;
  }
  const W = 64, H = 24, PAD = 1;
  const prices = candles.map(c => c.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || min * 0.005 || 1;
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * W;
    const y = H - PAD - ((p - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const isUp = prices[prices.length - 1] >= prices[0];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible shrink-0">
      <polyline points={pts} fill="none" stroke={isUp ? '#22c55e' : '#ef4444'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── SessionHeader ────────────────────────────────────────────────────────────

function SessionHeader({ connected, tick, portfolio }: { connected: boolean; tick: number; portfolio: Portfolio | null }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const pnl = portfolio?.day_pnl ?? null;
  return (
    <div className="flex items-center justify-between px-4 h-9 border-b border-border shrink-0 bg-card/60">
      <div className="flex items-center gap-3 text-[11px] font-mono">
        <div className={cn('flex items-center gap-1.5 font-bold', connected ? 'text-green-400' : 'text-red-400')}>
          <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-400 animate-pulse' : 'bg-red-400')} />
          {connected ? `LIVE · ${tick}` : 'OFFLINE'}
        </div>
        <span className="text-muted-foreground tabular-nums">{now.toLocaleTimeString('nl-NL')}</span>
      </div>
      <div className="flex items-center gap-4 text-[11px] font-mono">
        {pnl !== null && (
          <span className={cn('font-bold tabular-nums', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}&nbsp;vandaag
          </span>
        )}
        <span className="text-amber-400 hidden sm:block">🤖 AI actief</span>
      </div>
    </div>
  );
}

// ── CryptoTile ───────────────────────────────────────────────────────────────

function CryptoTile({ symbol, price, candles, signal }: {
  symbol: string;
  price?: PriceData;
  candles: OHLCVCandle[];
  signal?: SignalData;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const hasBuy = signal?.direction === 'buy';
  const hasSell = signal?.direction === 'sell';
  return (
    <div className={cn(
      'relative border rounded-lg p-3 flex flex-col gap-1.5 bg-card hover:bg-accent/20 transition-colors overflow-hidden',
      hasBuy ? 'border-green-500/50' : hasSell ? 'border-red-500/50' : 'border-border',
    )}>
      {(hasBuy || hasSell) && (
        <div className={cn('absolute top-0 left-0 right-0 h-0.5', hasBuy ? 'bg-green-500' : 'bg-red-500')} />
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono font-bold text-sm text-foreground">{symbol}</span>
          <span className="text-[9px] text-muted-foreground font-mono hidden sm:inline">{CRYPTO_NAMES[symbol] ?? ''}</span>
        </div>
        {pct !== null && (
          <span className={cn('text-[10px] font-mono font-bold', pct >= 0 ? 'text-green-400' : 'text-red-400')}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className={cn('font-mono text-base font-bold leading-none tabular-nums', price ? 'text-foreground' : 'text-muted-foreground/40')}>
          {price ? `$${fmtPrice(price.price)}` : '—'}
        </span>
        <Sparkline candles={candles} />
      </div>
      {signal && (
        <div className={cn('text-[9px] font-mono font-bold tracking-wider', hasBuy ? 'text-green-400' : 'text-red-400')}>
          {hasBuy ? '▲ BUY' : '▼ SELL'} · {(signal.confidence * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}

// ── AiBrainFeedItem ──────────────────────────────────────────────────────────

function AiBrainFeedItem({ event, highlight }: { event: ActivityEvent; highlight: boolean }) {
  const [open, setOpen] = useState(false);
  const { icon, color } = actionMeta(event.action);
  const time = event.created_at
    ? new Date(event.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : '--:--';
  const details = (event.details ?? {}) as Record<string, unknown>;
  const confidence = details.confidence as number | undefined;
  const bull = details.bull_score as number | undefined;
  const bear = details.bear_score as number | undefined;
  const reasons = (details.reasons ?? details.warnings) as string[] | undefined;
  const asset = details.asset as string | undefined;
  const notional = details.notional as number | undefined;
  const direction = details.direction as string | undefined;
  const short = event.message
    ? event.message.slice(0, 90)
    : `${asset ? `${asset}: ` : ''}${event.action.replace(/_/g, ' ')}`;

  const hasDetail = confidence !== undefined || (bull !== undefined && bear !== undefined) || (reasons && reasons.length > 0);

  return (
    <div
      className={cn(
        'border-b border-border/40 transition-colors',
        hasDetail ? 'cursor-pointer hover:bg-accent/20' : '',
        highlight ? 'bg-amber-500/10' : '',
      )}
      onClick={() => hasDetail && setOpen(o => !o)}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-[10px] text-muted-foreground font-mono w-9 shrink-0 tabular-nums">{time}</span>
        <span className="text-sm shrink-0 w-5 text-center leading-none">{icon}</span>
        <span className={cn('flex-1 text-[11px] font-mono truncate', color)}>{short}</span>
        {hasDetail && (
          <span className="text-muted-foreground/50 shrink-0">
            {open ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
          </span>
        )}
      </div>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30 bg-card/40">
          {direction && asset && (
            <p className="text-[10px] text-foreground font-mono font-bold">
              {direction.toUpperCase()} {asset}{notional ? ` · $${notional.toFixed(0)}` : ''}
            </p>
          )}
          {confidence !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-mono shrink-0 w-20">Confidence</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(confidence * 100).toFixed(0)}%` }} />
              </div>
              <span className="text-[10px] text-amber-400 font-mono tabular-nums shrink-0">{(confidence * 100).toFixed(0)}%</span>
            </div>
          )}
          {bull !== undefined && bear !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-green-400 font-mono shrink-0 w-20">Bull {(bull * 100).toFixed(0)}%</span>
              <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-muted">
                <div className="bg-green-500" style={{ width: `${((bull / ((bull + bear) || 1)) * 100).toFixed(0)}%` }} />
                <div className="bg-red-500 flex-1" />
              </div>
              <span className="text-[10px] text-red-400 font-mono shrink-0 w-14 text-right">Bear {(bear * 100).toFixed(0)}%</span>
            </div>
          )}
          {reasons && reasons.length > 0 && (
            <p className="text-[10px] text-muted-foreground font-mono leading-relaxed">
              {reasons.slice(0, 2).join(' · ')}
            </p>
          )}
          {event.message && event.message.length > 90 && (
            <p className="text-[10px] text-foreground/60 font-mono leading-relaxed">{event.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── PositionsStrip ───────────────────────────────────────────────────────────

function PositionsStrip({ positions }: { positions: AlpacaPosition[] }) {
  return (
    <div className="border-t border-border h-14 shrink-0 flex items-center overflow-x-auto bg-card/30">
      <div className="flex items-center gap-2 px-4 min-w-max h-full">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider shrink-0 mr-1">Posities</span>
        {positions.length === 0 ? (
          <span className="text-[11px] text-muted-foreground font-mono">Geen open posities</span>
        ) : positions.map((pos, i) => {
          const pnl = parseFloat(pos.unrealized_pl ?? '0');
          const pnlPct = parseFloat(pos.unrealized_plpc ?? '0') * 100;
          const entry = parseFloat(pos.avg_entry_price ?? '0');
          const isLong = pos.side === 'long';
          const sym = pos.symbol.split('/')[0];
          return (
            <div key={i} className={cn(
              'flex items-center gap-2 bg-card border rounded px-3 h-9 text-[11px] font-mono shrink-0',
              pnl >= 0 ? 'border-green-500/30' : 'border-red-500/30',
            )}>
              <span className="font-bold text-foreground">{sym}</span>
              <span className={cn('text-[9px] font-bold', isLong ? 'text-green-400' : 'text-red-400')}>
                {isLong ? 'LONG' : 'SHORT'}
              </span>
              {entry > 0 && <span className="text-muted-foreground">@${fmtPrice(entry)}</span>}
              <span className={cn('font-bold tabular-nums', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}&nbsp;({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function LiveSessionPage() {
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [candles, setCandles] = useState<Record<string, OHLCVCandle[]>>({});
  const [signals, setSignals] = useState<SignalData[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(new Set());
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);

  // Positions polling
  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getPositions() as AlpacaPosition[];
        setPositions(Array.isArray(data) ? data : []);
      } catch { /* Alpaca might not be configured */ }
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  // SSE handlers
  const handlePrice = useCallback((data: Record<string, unknown>) => {
    const pd = data as unknown as PriceData;
    if (pd.symbol) setPrices(prev => ({ ...prev, [pd.symbol]: pd }));
  }, []);

  const handleChartData = useCallback((data: Record<string, unknown>) => {
    const sym = data.symbol as string;
    const cs = data.candles as OHLCVCandle[];
    if (sym && Array.isArray(cs)) setCandles(prev => ({ ...prev, [sym]: cs }));
  }, []);

  const handleSignals = useCallback((data: Record<string, unknown>) => {
    const sigs = data.signals as SignalData[];
    if (Array.isArray(sigs)) setSignals(sigs);
  }, []);

  const handleNewSignal = useCallback((data: Record<string, unknown>) => {
    const sig = data.signal as SignalData;
    if (!sig) return;
    setSignals(prev => prev.find(s => s.id === sig.id) ? prev : [sig, ...prev]);
  }, []);

  const handleActivity = useCallback((data: Record<string, unknown>) => {
    const events = data.events as ActivityEvent[];
    if (!Array.isArray(events)) return;
    setActivityFeed(prev => {
      const existingKeys = new Set(prev.map(e => `${e.created_at}::${e.action}`));
      const fresh = events.filter(e => !existingKeys.has(`${e.created_at}::${e.action}`));
      if (fresh.length === 0) return prev;
      setHighlightKeys(new Set(fresh.map(e => `${e.created_at}::${e.action}`)));
      setTimeout(() => setHighlightKeys(new Set()), 4000);
      return [...fresh, ...prev].slice(0, 60);
    });
  }, []);

  const handlePortfolio = useCallback((data: Record<string, unknown>) => {
    setPortfolio(data as unknown as Portfolio);
  }, []);

  const handleHeartbeat = useCallback((data: Record<string, unknown>) => {
    setTick(data.tick as number);
  }, []);

  useSSE(
    `/api/stream/session?symbols=${SYMBOLS_PARAM}`,
    { chart_data: handleChartData, price: handlePrice, signals: handleSignals, new_signal: handleNewSignal, activity_batch: handleActivity, portfolio: handlePortfolio, heartbeat: handleHeartbeat },
    { onConnected: () => setConnected(true), onDisconnected: () => setConnected(false) },
  );

  const signalMap = Object.fromEntries(signals.map(s => [s.asset, s]));

  return (
    <div className="flex flex-col -m-3 md:-m-4 bg-background overflow-hidden" style={{ height: 'calc(100dvh - 48px)' }}>

      <SessionHeader connected={connected} tick={tick} portfolio={portfolio} />

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

        {/* ── Crypto grid ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-3 border-b md:border-b-0 md:border-r border-border">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {CRYPTO_SYMBOLS.map(sym => (
              <CryptoTile
                key={sym}
                symbol={sym}
                price={prices[sym]}
                candles={candles[sym] ?? []}
                signal={signalMap[sym]}
              />
            ))}
          </div>
        </div>

        {/* ── AI Brain feed ───────────────────────────────────────────────── */}
        <div className="w-full md:w-80 xl:w-96 flex flex-col shrink-0">
          <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0 bg-card/60">
            <span className="text-[11px] font-mono font-bold text-amber-400 uppercase tracking-wider">🧠 AI Brain</span>
            {connected && (
              <div className="flex items-center gap-1 text-[9px] font-mono text-green-400">
                <span className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
                LIVE
              </div>
            )}
          </div>
          <div ref={feedRef} className="flex-1 overflow-y-auto min-h-0">
            {activityFeed.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-16">
                <span className="text-3xl opacity-20">🧠</span>
                <span className="text-xs font-mono">Wachten op AI activiteit…</span>
              </div>
            ) : activityFeed.map((event, idx) => (
              <AiBrainFeedItem
                key={`${event.created_at}::${event.action}::${idx}`}
                event={event}
                highlight={highlightKeys.has(`${event.created_at}::${event.action}`)}
              />
            ))}
          </div>
        </div>

      </div>

      <PositionsStrip positions={positions} />
    </div>
  );
}
