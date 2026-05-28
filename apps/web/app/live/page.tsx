'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { fmtUSD } from '@/lib/utils';
import { useSSE } from '@/hooks/useSSE';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { useToast } from '@/contexts/toast';
import { CandlestickChart } from '@/components/live/CandlestickChart';
import { Button } from '@/components/ui/button';
import { X, ChevronDown, ChevronUp } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OHLCVCandle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface PriceData { symbol: string; price: number; open: number; high: number; low: number; volume: number; }
interface AiAnalysis {
  bull_score?: number; bear_score?: number; bull_catalyst?: string; bear_risk?: string;
  ta_score?: number; ta_rsi?: number; ta_macd?: string; ta_trend?: string;
  news_count?: number; social_count?: number; key_risks?: string; invalidation?: string;
}
interface SignalData {
  id: string; asset: string; direction: string; confidence: number;
  reason?: string; status?: string;
  suggested_entry?: number; suggested_stop?: number; suggested_take_profit?: number;
  risk_reward?: number; ai_analysis?: AiAnalysis;
}
interface ActivityEvent {
  action: string; actor: string; message?: string; status?: string;
  details?: Record<string, unknown>; created_at: string;
}
interface Portfolio { equity: number; cash: number; buying_power: number; day_pnl: number; }
interface AlpacaPosition {
  symbol: string; qty: string; side: string;
  avg_entry_price: string; unrealized_pl: string; unrealized_plpc: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'LTC', 'BCH', 'UNI', 'AAVE', 'ALGO'];
const SYMBOLS_PARAM = CRYPTO_SYMBOLS.join(',');
const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', DOGE: 'Dogecoin',
  AVAX: 'Avalanche', LINK: 'Chainlink', LTC: 'Litecoin', BCH: 'Bitcoin Cash',
  UNI: 'Uniswap', AAVE: 'Aave', ALGO: 'Algorand',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}

function isPending(s?: SignalData) {
  return s && (!s.status || s.status === 'pending');
}

function actionMeta(action: string) {
  if (action === 'signal_generated') return { icon: '⚖️', color: 'text-amber-400' };
  if (action === 'auto_trade_executed') return { icon: '✅', color: 'text-green-400' };
  if (action === 'auto_trade_risk_rejected') return { icon: '🚫', color: 'text-orange-400' };
  if (action === 'auto_trade_manual_required') return { icon: '⚠️', color: 'text-amber-400' };
  if (action === 'circuit_breaker_triggered') return { icon: '🔴', color: 'text-red-500' };
  if (action.includes('reflection') || action.includes('lesson') || action === 'trade_reflection_written') return { icon: '💡', color: 'text-purple-400' };
  if (action === 'ai_provider_paused') return { icon: '⏸️', color: 'text-amber-400' };
  if (action.includes('position_close') || action === 'position_auto_closed') return { icon: '📤', color: 'text-blue-400' };
  if (action === 'skipped_existing' || action === 'skipped_conflict') return { icon: '⏭️', color: 'text-muted-foreground' };
  if (action === 'auto_trade_broker_error') return { icon: '⚡', color: 'text-red-400' };
  return { icon: '🔄', color: 'text-muted-foreground' };
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ candles, width = 80, height = 34, uid }: {
  candles: OHLCVCandle[]; width?: number; height?: number; uid: string;
}) {
  if (candles.length < 2) {
    return <div style={{ width, height }} className="flex items-end"><div className="w-full h-px bg-border opacity-40" /></div>;
  }
  const PAD = 2;
  const prices = candles.map(c => c.close);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || min * 0.005 || 1;
  const pts = prices.map((p, i) => {
    const x = PAD + (i / (prices.length - 1)) * (width - PAD * 2);
    const y = height - PAD - ((p - min) / range) * (height - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const isUp = prices[prices.length - 1] >= prices[0];
  const color = isUp ? '#22c55e' : '#ef4444';
  const area = `M${PAD},${height} ${pts.map(pt => `L${pt}`).join(' ')} L${width - PAD},${height} Z`;
  const gid = `sg-${uid}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible shrink-0">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── SessionHeader ─────────────────────────────────────────────────────────────

function SessionHeader({ connected, tick, portfolio }: {
  connected: boolean; tick: number; portfolio: Portfolio | null;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const pnl = portfolio?.day_pnl ?? null;
  const equity = portfolio?.equity ?? null;
  const buyingPower = portfolio?.buying_power ?? null;

  return (
    <div className="flex items-center justify-between px-4 h-10 border-b border-border shrink-0 bg-card/60 gap-4 overflow-x-auto">
      <div className="flex items-center gap-3 text-[11px] font-mono shrink-0">
        <div className={cn('flex items-center gap-1.5 font-bold', connected ? 'text-green-400' : 'text-red-400')}>
          <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-400 animate-pulse' : 'bg-red-400')} />
          {connected ? `LIVE · ${tick}` : 'OFFLINE'}
        </div>
        <span className="text-muted-foreground tabular-nums">{now.toLocaleTimeString('nl-NL')}</span>
      </div>
      <div className="flex items-center gap-4 text-[11px] font-mono">
        {equity !== null && (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Equity</span>
            <span className="font-bold text-foreground tabular-nums">{fmtUSD(equity)}</span>
          </div>
        )}
        {buyingPower !== null && (
          <div className="hidden md:flex items-center gap-1">
            <span className="text-muted-foreground">Beschikbaar</span>
            <span className="font-bold text-foreground tabular-nums">{fmtUSD(buyingPower)}</span>
          </div>
        )}
        {pnl !== null && (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Vandaag</span>
            <span className={cn('font-bold tabular-nums', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
              {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
            </span>
          </div>
        )}
      </div>
      <span className="text-[10px] font-mono text-amber-400 shrink-0 hidden sm:block">🤖 AI actief</span>
    </div>
  );
}

// ── AssetTile ─────────────────────────────────────────────────────────────────

function AssetTile({ symbol, price, candles, signal, selected, onClick, onTrade, onReject, acting }: {
  symbol: string; price?: PriceData; candles: OHLCVCandle[]; signal?: SignalData;
  selected?: boolean; onClick: () => void;
  onTrade: (id: string) => void; onReject: (id: string) => void; acting: string | null;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const hasBuy = signal?.direction === 'buy';
  const hasSell = signal?.direction === 'sell';
  const hasSignal = !!signal;
  const canAct = isPending(signal);

  return (
    <div
      onClick={onClick}
      className={cn(
        'relative border rounded-lg bg-card transition-all overflow-hidden cursor-pointer',
        'hover:shadow-sm hover:border-primary/40',
        selected
          ? 'border-primary shadow-sm ring-1 ring-primary/20'
          : hasSignal
            ? hasBuy ? 'border-green-500/50' : 'border-red-500/50'
            : 'border-border',
      )}
    >
      {hasSignal && (
        <div className={cn('absolute top-0 left-0 right-0 h-0.5', hasBuy ? 'bg-green-500' : 'bg-red-500')} />
      )}
      <div className="p-3 space-y-2">
        {/* Symbol + % */}
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono font-bold text-sm">{symbol}</span>
            <span className="text-[9px] text-muted-foreground hidden sm:inline">{CRYPTO_NAMES[symbol] ?? symbol}</span>
          </div>
          {pct !== null && (
            <span className={cn('text-[10px] font-mono font-bold tabular-nums', pct >= 0 ? 'text-green-400' : 'text-red-400')}>
              {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
            </span>
          )}
        </div>

        {/* Price + sparkline */}
        <div className="flex items-end justify-between gap-2">
          <span className={cn('font-mono text-lg font-bold leading-none tabular-nums', price ? 'text-foreground' : 'text-muted-foreground/30')}>
            {price ? `$${fmtPrice(price.price)}` : '—'}
          </span>
          <Sparkline candles={candles} uid={symbol} />
        </div>

        {/* Signal section */}
        {hasSignal && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={cn(
                'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded',
                hasBuy ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400',
              )}>
                {hasBuy ? '▲ BUY' : '▼ SELL'}
              </span>
              <div className="flex items-center gap-1.5 flex-1">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', hasBuy ? 'bg-green-500' : 'bg-red-500')}
                    style={{ width: `${(signal.confidence * 100).toFixed(0)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-7 text-right">
                  {(signal.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
              <div className="grid grid-cols-3 gap-1 text-[9px] font-mono">
                {signal.suggested_entry && (
                  <div><span className="text-muted-foreground block">Entry</span><span className="text-foreground">${fmtPrice(signal.suggested_entry)}</span></div>
                )}
                {signal.suggested_stop && (
                  <div><span className="text-muted-foreground block">Stop</span><span className="text-red-400">${fmtPrice(signal.suggested_stop)}</span></div>
                )}
                {signal.suggested_take_profit && (
                  <div><span className="text-muted-foreground block">Target</span><span className="text-green-400">${fmtPrice(signal.suggested_take_profit)}</span></div>
                )}
              </div>
            )}

            {canAct && (
              <div className="flex gap-1.5 pt-0.5" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => onTrade(signal.id)}
                  disabled={acting === signal.id}
                  className="flex-1 h-7 text-[10px] font-mono font-bold rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {acting === signal.id ? '…' : '📄 Trade'}
                </button>
                <button
                  onClick={() => onReject(signal.id)}
                  disabled={acting === signal.id}
                  className="w-8 h-7 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ChartPanel ────────────────────────────────────────────────────────────────

function ChartPanel({ symbol, price, candles, signal, onClose, onTrade, onReject, acting }: {
  symbol: string; price?: PriceData; candles: OHLCVCandle[]; signal?: SignalData;
  onClose: () => void; onTrade: (id: string) => void; onReject: (id: string) => void; acting: string | null;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const lastCandle = candles.at(-1);
  const chartSignals = signal && lastCandle ? [{
    time: lastCandle.time,
    direction: signal.direction === 'buy' ? 'long' as const : 'short' as const,
    symbol,
  }] : [];
  const ai = signal?.ai_analysis;
  const canAct = isPending(signal);

  return (
    <div className="border-b border-border bg-card shrink-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 h-9 border-b border-border/50">
        <span className="font-mono font-bold text-sm">{symbol}</span>
        <span className="text-[10px] text-muted-foreground hidden sm:block">{CRYPTO_NAMES[symbol] ?? ''}</span>
        {price && <span className="font-mono font-bold text-foreground">${fmtPrice(price.price)}</span>}
        {pct !== null && (
          <span className={cn('text-[10px] font-mono font-bold', pct >= 0 ? 'text-green-400' : 'text-red-400')}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-auto w-6 h-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <X size={12} />
        </button>
      </div>

      {/* Chart */}
      <div style={{ height: 200 }}>
        <CandlestickChart candles={candles} signals={chartSignals} />
      </div>

      {/* Signal detail */}
      {signal && (
        <div className="px-3 py-2 border-t border-border/50 space-y-1.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded',
                signal.direction === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400',
              )}>
                {signal.direction === 'buy' ? '▲ BUY' : '▼ SELL'}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {(signal.confidence * 100).toFixed(0)}% confidence
              </span>
              {signal.risk_reward && (
                <span className="text-[10px] text-muted-foreground font-mono">R/R {signal.risk_reward.toFixed(2)}</span>
              )}
            </div>
            {canAct && (
              <div className="flex gap-1.5">
                <button
                  onClick={() => onTrade(signal.id)}
                  disabled={acting === signal.id}
                  className="h-7 px-3 text-xs font-mono font-bold rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {acting === signal.id ? '…' : '📄 Trade'}
                </button>
                <button
                  onClick={() => onReject(signal.id)}
                  disabled={acting === signal.id}
                  className="h-7 px-2.5 text-xs font-mono rounded border border-border text-muted-foreground hover:text-foreground"
                >
                  ✕ Afwijzen
                </button>
              </div>
            )}
          </div>

          {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
            <div className="flex gap-4 text-[10px] font-mono flex-wrap">
              {signal.suggested_entry && <span className="text-muted-foreground">Entry: <span className="text-foreground font-medium">${fmtPrice(signal.suggested_entry)}</span></span>}
              {signal.suggested_stop && <span className="text-muted-foreground">Stop: <span className="text-red-400 font-medium">${fmtPrice(signal.suggested_stop)}</span></span>}
              {signal.suggested_take_profit && <span className="text-muted-foreground">Target: <span className="text-green-400 font-medium">${fmtPrice(signal.suggested_take_profit)}</span></span>}
            </div>
          )}

          {signal.reason && (
            <p className="text-[10px] text-muted-foreground font-mono leading-snug line-clamp-2">{signal.reason}</p>
          )}

          {ai?.bull_score !== undefined && ai?.bear_score !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-green-400 font-mono shrink-0">🐂 {(ai.bull_score * 100).toFixed(0)}%</span>
              <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-muted">
                <div className="bg-green-500" style={{ width: `${((ai.bull_score / ((ai.bull_score + ai.bear_score) || 1)) * 100).toFixed(0)}%` }} />
                <div className="bg-red-500 flex-1" />
              </div>
              <span className="text-[10px] text-red-400 font-mono shrink-0">🐻 {(ai.bear_score * 100).toFixed(0)}%</span>
            </div>
          )}

          {(ai?.ta_rsi !== undefined || ai?.ta_trend) && (
            <div className="flex gap-3 text-[10px] text-muted-foreground font-mono flex-wrap">
              {ai?.ta_rsi !== undefined && <span>RSI {ai.ta_rsi.toFixed(0)}</span>}
              {ai?.ta_trend && <span>Trend: {ai.ta_trend}</span>}
              {ai?.ta_macd && <span>MACD: {ai.ta_macd}</span>}
              {ai?.news_count !== undefined && <span>{ai.news_count} nieuws</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── PositionCard ──────────────────────────────────────────────────────────────

function PositionCard({ pos, onClose, closing }: {
  pos: AlpacaPosition; onClose: (sym: string) => void; closing: string | null;
}) {
  const pnl = parseFloat(pos.unrealized_pl ?? '0');
  const pnlPct = parseFloat(pos.unrealized_plpc ?? '0') * 100;
  const entry = parseFloat(pos.avg_entry_price ?? '0');
  const qty = parseFloat(pos.qty ?? '0');
  const isLong = pos.side === 'long';
  const sym = pos.symbol.split('/')[0];

  return (
    <div className={cn(
      'flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0',
      pnl >= 0 ? 'bg-green-500/[0.03]' : 'bg-red-500/[0.03]',
    )}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono font-bold text-sm">{sym}</span>
          <span className={cn(
            'text-[9px] font-mono font-bold px-1 py-0.5 rounded',
            isLong ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400',
          )}>
            {isLong ? 'LONG' : 'SHORT'}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted-foreground font-mono">
            {qty < 1 ? qty.toFixed(4) : qty.toFixed(2)} @ ${fmtPrice(entry)}
          </span>
          <span className={cn('text-xs font-mono font-bold tabular-nums', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
            <span className="font-normal text-[10px] ml-1">({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)</span>
          </span>
        </div>
      </div>
      <button
        onClick={() => onClose(sym)}
        disabled={closing === sym}
        className="h-7 px-2 text-[10px] font-mono rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/40 transition-colors disabled:opacity-40 shrink-0"
      >
        {closing === sym ? '…' : 'Sluit'}
      </button>
    </div>
  );
}

// ── ActivityItem ──────────────────────────────────────────────────────────────

function ActivityItem({ event, highlight }: { event: ActivityEvent; highlight: boolean }) {
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
  const text = event.message
    ? event.message.slice(0, 100)
    : `${asset ? `${asset}: ` : ''}${event.action.replace(/_/g, ' ')}`;
  const hasDetail = confidence !== undefined || (bull !== undefined && bear !== undefined) || (reasons && reasons.length > 0);

  return (
    <div
      className={cn(
        'border-b border-border/40 transition-colors',
        hasDetail && 'cursor-pointer hover:bg-accent/20',
        highlight && 'bg-amber-500/8',
      )}
      onClick={() => hasDetail && setOpen(o => !o)}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="text-[10px] text-muted-foreground font-mono w-9 shrink-0 tabular-nums pt-0.5">{time}</span>
        <span className="text-base shrink-0 leading-none mt-px">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className={cn('text-xs font-mono leading-snug', color)}>{text}</p>
          {asset && direction && (
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
              {direction.toUpperCase()} {asset}{notional ? ` · $${notional.toFixed(0)}` : ''}
            </p>
          )}
        </div>
        {hasDetail && (
          <span className="text-muted-foreground/50 shrink-0 pt-1">
            {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </span>
        )}
      </div>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30 bg-card/40">
          {confidence !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-mono w-20 shrink-0">Confidence</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(confidence * 100).toFixed(0)}%` }} />
              </div>
              <span className="text-[10px] text-amber-400 font-mono tabular-nums shrink-0">{(confidence * 100).toFixed(0)}%</span>
            </div>
          )}
          {bull !== undefined && bear !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-green-400 font-mono shrink-0 w-16">🐂 {(bull * 100).toFixed(0)}%</span>
              <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-muted">
                <div className="bg-green-500" style={{ width: `${((bull / ((bull + bear) || 1)) * 100).toFixed(0)}%` }} />
                <div className="bg-red-500 flex-1" />
              </div>
              <span className="text-[10px] text-red-400 font-mono shrink-0 w-16 text-right">🐻 {(bear * 100).toFixed(0)}%</span>
            </div>
          )}
          {reasons && reasons.length > 0 && (
            <p className="text-[10px] text-muted-foreground font-mono leading-relaxed">{reasons.slice(0, 3).join(' · ')}</p>
          )}
          {event.message && event.message.length > 100 && (
            <p className="text-[10px] text-foreground/60 font-mono leading-relaxed">{event.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

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
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);

  // Pre-populate from REST so the page isn't empty while SSE connects
  const { data: initialAudit } = useApi(() => api.getAuditLogs(40), []);
  const { data: initialSignals } = useApi(() => api.getSignals(50), []);
  useEffect(() => {
    if (initialAudit && activityFeed.length === 0) setActivityFeed(initialAudit as any[]);
  }, [initialAudit]);
  useEffect(() => {
    if (initialSignals && signals.length === 0) setSignals(initialSignals as any[]);
  }, [initialSignals]);
  const [filterMode, setFilterMode] = useState<'all' | 'signals'>('all');
  const { toast } = useToast();

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

  // Signal map: latest per asset, pending wins
  const signalMap = useMemo((): Record<string, SignalData> => {
    const map: Record<string, SignalData> = {};
    [...signals].reverse().forEach(s => { map[s.asset] = s; });
    signals.filter(s => !s.status || s.status === 'pending').forEach(s => { map[s.asset] = s; });
    return map;
  }, [signals]);

  // Grid symbols: crypto base + stocks from signals
  const gridSymbols = useMemo(() => {
    const extraStocks = signals
      .map(s => s.asset)
      .filter(a => !CRYPTO_SYMBOLS.includes(a))
      .filter((v, i, arr) => arr.indexOf(v) === i);
    const all = [...CRYPTO_SYMBOLS, ...extraStocks];
    const base = filterMode === 'signals' ? all.filter(sym => !!signalMap[sym]) : all;
    return [...base].sort((a, b) => {
      const aP = isPending(signalMap[a]) ? -1 : 0;
      const bP = isPending(signalMap[b]) ? -1 : 0;
      return aP - bP;
    });
  }, [signals, signalMap, filterMode]);

  // Counts for filter bar
  const allCount = useMemo(() => {
    const extras = signals.map(s => s.asset).filter(a => !CRYPTO_SYMBOLS.includes(a));
    return [...new Set([...CRYPTO_SYMBOLS, ...extras])].length;
  }, [signals]);
  const signalCount = useMemo(() => new Set(signals.map(s => s.asset)).size, [signals]);

  // SSE handlers
  const handlePrice = useCallback((data: Record<string, unknown>) => {
    const pd = data as unknown as PriceData;
    if (pd.symbol) setPrices(prev => ({ ...prev, [pd.symbol]: pd }));
  }, []);

  const handleChartData = useCallback((data: Record<string, unknown>) => {
    const sym = data.symbol as string;
    const cs = data.candles as OHLCVCandle[];
    if (sym && Array.isArray(cs)) {
      setCandles(prev => ({ ...prev, [sym]: cs }));
      // Extract price from last candle so tiles show immediately (before per-symbol price ticks arrive)
      const last = cs[cs.length - 1];
      if (last) {
        setPrices(prev => prev[sym] ? prev : { ...prev, [sym]: { symbol: sym, price: last.close, open: cs[0]?.open ?? last.open, high: last.high, low: last.low, volume: last.volume } });
      }
    }
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
      return [...fresh, ...prev].slice(0, 80);
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

  // Actions
  async function handleTrade(id: string) {
    setActing(id);
    try {
      let result = await api.paperTradeSignal(id);
      if (result.status === 'requires_manual_approval') {
        if (!confirm('Risk check vereist bevestiging. Doorgaan?')) { setActing(null); return; }
        result = await api.paperTradeSignal(id, true);
      }
      toast('✅ Trade ingediend', 'success');
      const sigs = await api.getSignals(100);
      if (Array.isArray(sigs)) setSignals(sigs);
    } catch (e: any) {
      toast(`❌ ${e?.detail?.reasons?.join(', ') || e?.detail || 'Risk check mislukt'}`, 'error');
    } finally {
      setActing(null);
    }
  }

  async function handleReject(id: string) {
    setActing(id);
    try {
      await api.rejectSignal(id);
      toast('Signal afgewezen', 'info');
      const sigs = await api.getSignals(100);
      if (Array.isArray(sigs)) setSignals(sigs);
    } catch { /* ignore */ }
    setActing(null);
  }

  async function handleClose(sym: string) {
    setClosing(sym);
    try {
      await api.closePosition(sym);
      toast(`📤 ${sym} positie gesloten`, 'success');
      const data = await api.getPositions() as AlpacaPosition[];
      setPositions(Array.isArray(data) ? data : []);
    } catch (e: any) {
      toast(`❌ Sluiten mislukt: ${e?.detail || 'Onbekende fout'}`, 'error');
    } finally {
      setClosing(null);
    }
  }

  return (
    <div className="flex flex-col -m-3 md:-m-4 bg-background overflow-hidden" style={{ height: 'calc(100dvh - 48px)' }}>

      <SessionHeader connected={connected} tick={tick} portfolio={portfolio} />

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

        {/* ── Left: Asset grid ──────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden border-b md:border-b-0 md:border-r border-border">

          {/* Chart panel */}
          {selectedSymbol && (
            <ChartPanel
              symbol={selectedSymbol}
              price={prices[selectedSymbol]}
              candles={candles[selectedSymbol] ?? []}
              signal={signalMap[selectedSymbol]}
              onClose={() => setSelectedSymbol(null)}
              onTrade={handleTrade}
              onReject={handleReject}
              acting={acting}
            />
          )}

          {/* Filter bar */}
          <div className="flex items-center gap-1 px-3 h-8 border-b border-border shrink-0 bg-card/40">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mr-2">Assets</span>
            {([
              { key: 'all', label: `Alle (${allCount})` },
              { key: 'signals', label: `Signalen (${signalCount})` },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterMode(key)}
                className={cn(
                  'px-2.5 py-1 text-[10px] font-mono rounded transition-colors',
                  filterMode === key ? 'bg-accent text-foreground font-bold' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {filterMode === 'signals' && gridSymbols.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
                <span className="text-2xl opacity-20">⚖️</span>
                <span className="text-xs font-mono">Geen actieve signalen</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {gridSymbols.map(sym => (
                  <AssetTile
                    key={sym}
                    symbol={sym}
                    price={prices[sym]}
                    candles={candles[sym] ?? []}
                    signal={signalMap[sym]}
                    selected={selectedSymbol === sym}
                    onClick={() => setSelectedSymbol(prev => prev === sym ? null : sym)}
                    onTrade={handleTrade}
                    onReject={handleReject}
                    acting={acting}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Positions + AI feed ────────────────────────────────── */}
        <div className="w-full md:w-80 xl:w-96 flex flex-col shrink-0 overflow-hidden">

          {/* Positions section */}
          <div className="shrink-0 border-b border-border">
            <div className="flex items-center justify-between px-3 h-8 bg-card/60 border-b border-border/50">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-foreground">
                Open Posities
              </span>
              <span className={cn('text-[10px] font-mono', positions.length > 0 ? 'text-foreground font-bold' : 'text-muted-foreground')}>
                {positions.length}
              </span>
            </div>
            {positions.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground font-mono">Geen open posities</div>
            ) : (
              <div className="max-h-44 overflow-y-auto">
                {positions.map((pos, i) => (
                  <PositionCard key={i} pos={pos} onClose={handleClose} closing={closing} />
                ))}
              </div>
            )}
          </div>

          {/* AI Brain feed */}
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="flex items-center justify-between px-3 h-8 border-b border-border shrink-0 bg-card/60">
              <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider">🧠 AI Brain</span>
              {connected && (
                <div className="flex items-center gap-1 text-[9px] font-mono text-green-400">
                  <span className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
                  LIVE
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {activityFeed.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-12">
                  <span className="text-3xl opacity-20">🧠</span>
                  <span className="text-xs font-mono">Wachten op AI activiteit…</span>
                </div>
              ) : activityFeed.map((event, idx) => (
                <ActivityItem
                  key={`${event.created_at}::${event.action}::${idx}`}
                  event={event}
                  highlight={highlightKeys.has(`${event.created_at}::${event.action}`)}
                />
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
