'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { fmtUSD } from '@/lib/utils';
import { useSSE } from '@/hooks/useSSE';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { useToast } from '@/contexts/toast';
import { CandlestickChart } from '@/components/live/CandlestickChart';
import { X, TrendingUp, TrendingDown, Wifi, WifiOff, ChevronDown, ChevronUp, Activity, Layers, Zap } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface OHLCVCandle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface PriceData { symbol: string; price: number; open: number; high: number; low: number; volume: number; }
interface AiAnalysis {
  bull_score?: number; bear_score?: number; bull_catalyst?: string; bear_risk?: string;
  ta_score?: number; ta_rsi?: number; ta_macd?: string; ta_trend?: string;
  news_count?: number; social_count?: number; key_risks?: string; invalidation?: string;
}
interface SignalData {
  id: string; asset: string; direction: string; confidence: number;
  reason?: string; status?: string; timeframe?: string;
  suggested_entry?: number; suggested_stop?: number; suggested_take_profit?: number;
  risk_reward?: number; ai_analysis?: AiAnalysis; created_at?: string;
}
interface ActivityEvent {
  action: string; actor: string; message?: string; status?: string;
  details?: Record<string, unknown>; created_at: string;
}
interface Portfolio { equity: number; cash: number; buying_power: number; day_pnl: number; }
interface AlpacaPosition {
  symbol: string; qty: string; side: string;
  avg_entry_price: string; unrealized_pl: string; unrealized_plpc: string;
  current_price?: string; market_value?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'LTC', 'BCH', 'UNI', 'AAVE', 'ALGO'];
const SYMBOLS_PARAM = CRYPTO_SYMBOLS.join(',');
const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', DOGE: 'Dogecoin',
  AVAX: 'Avalanche', LINK: 'Chainlink', LTC: 'Litecoin', BCH: 'Bitcoin Cash',
  UNI: 'Uniswap', AAVE: 'Aave', ALGO: 'Algorand',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}

function isPending(s?: SignalData) {
  return s && (!s.status || s.status === 'pending');
}

function relTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s`;
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function actionMeta(action: string): { icon: string; label: string; color: string } {
  if (action === 'signal_generated') return { icon: '⚖️', label: 'Signaal', color: 'text-amber-500' };
  if (action === 'auto_trade_executed') return { icon: '✅', label: 'Trade', color: 'text-green-500' };
  if (action === 'auto_trade_risk_rejected') return { icon: '🚫', label: 'Geweigerd', color: 'text-orange-500' };
  if (action === 'circuit_breaker_triggered') return { icon: '🔴', label: 'Circuit', color: 'text-red-500' };
  if (action.includes('reflection') || action === 'trade_reflection_written') return { icon: '💡', label: 'Reflectie', color: 'text-purple-500' };
  if (action === 'ai_provider_paused') return { icon: '⏸️', label: 'AI Pauze', color: 'text-amber-500' };
  if (action.includes('position_close') || action === 'position_auto_closed') return { icon: '📤', label: 'Gesloten', color: 'text-blue-500' };
  if (action === 'signal_skipped') return { icon: '⏭️', label: 'Skip', color: 'text-muted-foreground' };
  return { icon: '🔄', label: 'Update', color: 'text-muted-foreground' };
}

// ── Sparkline ──────────────────────────────────────────────────────────────────

function Sparkline({ candles, width = 72, height = 32, uid }: {
  candles: OHLCVCandle[]; width?: number; height?: number; uid: string;
}) {
  if (candles.length < 2) return <div style={{ width, height }} className="opacity-20 border-b border-border" />;
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
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────────

function LiveHeader({ connected, tick, portfolio }: {
  connected: boolean; tick: number; portfolio: Portfolio | null;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const pnl = portfolio?.day_pnl ?? null;
  const equity = portfolio?.equity ?? null;
  const buying = portfolio?.buying_power ?? null;

  return (
    <div className="shrink-0 bg-card border-b border-border px-4 py-2.5 flex items-center gap-6 overflow-x-auto">
      {/* Status */}
      <div className="flex items-center gap-2 shrink-0">
        <div className={cn(
          'flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1',
          connected ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'
        )}>
          {connected
            ? <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> LIVE</>
            : <><WifiOff size={12} /> OFFLINE</>
          }
        </div>
        <span className="text-xs text-muted-foreground font-mono tabular-nums">{now.toLocaleTimeString('nl-NL')}</span>
      </div>

      <div className="w-px h-5 bg-border shrink-0" />

      {/* Portfolio metrics */}
      <div className="flex items-center gap-5">
        {equity !== null && (
          <div className="shrink-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none mb-0.5">Portfolio</p>
            <p className="text-sm font-bold tabular-nums text-foreground">{fmtUSD(equity)}</p>
          </div>
        )}
        {buying !== null && (
          <div className="hidden sm:block shrink-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none mb-0.5">Beschikbaar</p>
            <p className="text-sm font-semibold tabular-nums text-foreground">{fmtUSD(buying)}</p>
          </div>
        )}
        {pnl !== null && (
          <div className="shrink-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none mb-0.5">Vandaag</p>
            <p className={cn('text-sm font-bold tabular-nums', pnl >= 0 ? 'text-green-600' : 'text-red-500')}>
              {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
            </p>
          </div>
        )}
      </div>

      <div className="ml-auto shrink-0 flex items-center gap-1.5 text-[11px] text-amber-600 font-medium">
        <Zap size={12} />
        AI actief
      </div>
    </div>
  );
}

// ── AssetCard ──────────────────────────────────────────────────────────────────

function AssetCard({ symbol, price, candles, signal, selected, onClick }: {
  symbol: string; price?: PriceData; candles: OHLCVCandle[]; signal?: SignalData;
  selected?: boolean; onClick: () => void;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const isUp = pct !== null && pct >= 0;
  const hasBuy = signal?.direction === 'buy';
  const hasPending = isPending(signal);

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative text-left w-full rounded-xl border bg-card transition-all overflow-hidden',
        'hover:shadow-md hover:-translate-y-px',
        selected
          ? 'border-primary shadow-md ring-2 ring-primary/20'
          : hasPending
            ? hasBuy ? 'border-green-400/60 shadow-sm' : 'border-red-400/60 shadow-sm'
            : 'border-border hover:border-primary/30',
      )}
    >
      {hasPending && (
        <div className={cn('absolute inset-x-0 top-0 h-0.5', hasBuy ? 'bg-green-500' : 'bg-red-500')} />
      )}

      <div className="p-3 space-y-2.5">
        {/* Symbol row */}
        <div className="flex items-start justify-between">
          <div>
            <p className="font-bold text-sm text-foreground">{symbol}</p>
            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">{CRYPTO_NAMES[symbol] ?? symbol}</p>
          </div>
          {hasPending && (
            <span className={cn(
              'text-[9px] font-bold px-1.5 py-0.5 rounded-full',
              hasBuy ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'
            )}>
              {hasBuy ? '▲ BUY' : '▼ SELL'}
            </span>
          )}
        </div>

        {/* Price row */}
        <div className="flex items-end justify-between gap-1">
          <div>
            <p className={cn(
              'text-xl font-bold tabular-nums leading-none',
              price ? 'text-foreground' : 'text-muted-foreground/30'
            )}>
              {price ? `$${fmtPrice(price.price)}` : '—'}
            </p>
            {pct !== null && (
              <p className={cn(
                'text-xs font-semibold tabular-nums mt-0.5 flex items-center gap-0.5',
                isUp ? 'text-green-600' : 'text-red-500'
              )}>
                {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                {isUp ? '+' : ''}{pct.toFixed(2)}%
              </p>
            )}
          </div>
          <Sparkline candles={candles} uid={symbol} />
        </div>

        {/* Signal confidence bar */}
        {hasPending && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Confidence</span>
              <span className={cn('text-[10px] font-bold', hasBuy ? 'text-green-600' : 'text-red-500')}>
                {(signal!.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', hasBuy ? 'bg-green-500' : 'bg-red-500')}
                style={{ width: `${(signal!.confidence * 100).toFixed(0)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </button>
  );
}

// ── Chart Drawer ───────────────────────────────────────────────────────────────

function ChartDrawer({ symbol, price, candles, signal, onClose, onTrade, onReject, acting }: {
  symbol: string; price?: PriceData; candles: OHLCVCandle[]; signal?: SignalData;
  onClose: () => void; onTrade: (id: string) => void; onReject: (id: string) => void; acting: string | null;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const isUp = pct !== null && pct >= 0;
  const lastCandle = candles.at(-1);
  const chartSignals = signal && lastCandle ? [{
    time: lastCandle.time,
    direction: signal.direction === 'buy' ? 'long' as const : 'short' as const,
    symbol,
  }] : [];
  const ai = signal?.ai_analysis;
  const canAct = isPending(signal);
  const hasBuy = signal?.direction === 'buy';

  return (
    <div className="absolute inset-0 bg-background z-20 flex flex-col">
      {/* Drawer header */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border shrink-0 bg-card">
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
          <X size={16} />
        </button>
        <div>
          <p className="font-bold text-base">{symbol} <span className="text-muted-foreground font-normal text-sm">{CRYPTO_NAMES[symbol] ?? ''}</span></p>
        </div>
        {price && (
          <div className="ml-auto text-right">
            <p className="font-bold text-lg tabular-nums">${fmtPrice(price.price)}</p>
            {pct !== null && (
              <p className={cn('text-xs font-semibold', isUp ? 'text-green-600' : 'text-red-500')}>
                {isUp ? '+' : ''}{pct.toFixed(2)}%
              </p>
            )}
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <CandlestickChart candles={candles} signals={chartSignals} />
      </div>

      {/* Signal detail */}
      {signal && (
        <div className="shrink-0 border-t border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                'text-xs font-bold px-2.5 py-1 rounded-full',
                hasBuy ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'
              )}>
                {hasBuy ? '▲ BUY' : '▼ SELL'} · {(signal.confidence * 100).toFixed(0)}%
              </span>
              {signal.risk_reward && (
                <span className="text-xs text-muted-foreground">R/R {signal.risk_reward.toFixed(2)}</span>
              )}
              {signal.timeframe && (
                <span className="text-xs text-muted-foreground capitalize">{signal.timeframe}</span>
              )}
            </div>
            {canAct && (
              <div className="flex gap-2">
                <button
                  onClick={() => onTrade(signal.id)}
                  disabled={acting === signal.id}
                  className={cn(
                    'h-8 px-4 text-xs font-bold rounded-lg transition-colors disabled:opacity-50',
                    hasBuy
                      ? 'bg-green-500 text-white hover:bg-green-600'
                      : 'bg-red-500 text-white hover:bg-red-600'
                  )}
                >
                  {acting === signal.id ? '…' : hasBuy ? '📄 Koop' : '📄 Verkoop'}
                </button>
                <button
                  onClick={() => onReject(signal.id)}
                  disabled={acting === signal.id}
                  className="h-8 px-3 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                  Afwijzen
                </button>
              </div>
            )}
          </div>

          {/* Entry/Stop/Target */}
          {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
            <div className="grid grid-cols-3 gap-3">
              {signal.suggested_entry && (
                <div className="bg-muted/50 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Entry</p>
                  <p className="text-sm font-bold mt-0.5">${fmtPrice(signal.suggested_entry)}</p>
                </div>
              )}
              {signal.suggested_stop && (
                <div className="bg-red-500/5 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-red-500/70 uppercase tracking-wide">Stop</p>
                  <p className="text-sm font-bold text-red-500 mt-0.5">${fmtPrice(signal.suggested_stop)}</p>
                </div>
              )}
              {signal.suggested_take_profit && (
                <div className="bg-green-500/5 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-green-600/70 uppercase tracking-wide">Target</p>
                  <p className="text-sm font-bold text-green-600 mt-0.5">${fmtPrice(signal.suggested_take_profit)}</p>
                </div>
              )}
            </div>
          )}

          {/* Bull/Bear bar */}
          {ai?.bull_score !== undefined && ai?.bear_score !== undefined && (
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-green-600 shrink-0 w-12">🐂 {(ai.bull_score * 100).toFixed(0)}%</span>
              <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-muted">
                <div className="bg-green-500 transition-all" style={{ width: `${((ai.bull_score / ((ai.bull_score + ai.bear_score) || 1)) * 100).toFixed(0)}%` }} />
                <div className="bg-red-500 flex-1" />
              </div>
              <span className="text-xs font-semibold text-red-500 shrink-0 w-12 text-right">🐻 {(ai.bear_score * 100).toFixed(0)}%</span>
            </div>
          )}

          {signal.reason && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 border-t border-border pt-2">{signal.reason}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Position Row ───────────────────────────────────────────────────────────────

function PositionRow({ pos, onClose, closing }: {
  pos: AlpacaPosition; onClose: (sym: string) => void; closing: string | null;
}) {
  const pnl = parseFloat(pos.unrealized_pl ?? '0');
  const pnlPct = parseFloat(pos.unrealized_plpc ?? '0') * 100;
  const entry = parseFloat(pos.avg_entry_price ?? '0');
  const qty = parseFloat(pos.qty ?? '0');
  const sym = pos.symbol.split('/')[0];

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm">{sym}</span>
          <span className="text-[10px] text-muted-foreground">
            {qty < 1 ? qty.toFixed(4) : qty.toFixed(2)} @ ${fmtPrice(entry)}
          </span>
        </div>
        <p className={cn('text-sm font-bold tabular-nums mt-0.5', pnl >= 0 ? 'text-green-600' : 'text-red-500')}>
          {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
          <span className="font-normal text-xs ml-1.5 opacity-70">({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
        </p>
      </div>
      <button
        onClick={() => onClose(sym)}
        disabled={closing === sym}
        className="h-7 px-3 text-xs rounded-lg border border-border text-muted-foreground hover:text-red-500 hover:border-red-400/50 transition-colors disabled:opacity-40 shrink-0"
      >
        {closing === sym ? '…' : 'Sluiten'}
      </button>
    </div>
  );
}

// ── Signal Card ────────────────────────────────────────────────────────────────

function SignalCard({ signal, onTrade, onReject, acting, onClick }: {
  signal: SignalData; onTrade: (id: string) => void; onReject: (id: string) => void;
  acting: string | null; onClick: () => void;
}) {
  const hasBuy = signal.direction === 'buy';
  const canAct = isPending(signal);
  const age = signal.created_at ? relTime(signal.created_at) : '';

  return (
    <div
      onClick={onClick}
      className={cn(
        'mx-4 my-2 rounded-xl border p-3 cursor-pointer transition-all hover:shadow-sm',
        hasBuy ? 'border-green-400/40 bg-green-500/[0.03]' : 'border-red-400/40 bg-red-500/[0.03]'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-bold px-2 py-0.5 rounded-full',
            hasBuy ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'
          )}>
            {hasBuy ? '▲' : '▼'} {signal.asset}
          </span>
          <span className="text-xs text-muted-foreground">{(signal.confidence * 100).toFixed(0)}%</span>
        </div>
        {age && <span className="text-[10px] text-muted-foreground shrink-0">{age}</span>}
      </div>

      {/* Confidence bar */}
      <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full', hasBuy ? 'bg-green-500' : 'bg-red-500')}
          style={{ width: `${(signal.confidence * 100).toFixed(0)}%` }}
        />
      </div>

      {/* Entry/Stop/Target compact */}
      {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
        <div className="flex gap-3 mt-2 text-xs font-mono">
          {signal.suggested_entry && <span className="text-muted-foreground">E: <span className="text-foreground">${fmtPrice(signal.suggested_entry)}</span></span>}
          {signal.suggested_stop && <span className="text-muted-foreground">SL: <span className="text-red-500">${fmtPrice(signal.suggested_stop)}</span></span>}
          {signal.suggested_take_profit && <span className="text-muted-foreground">TP: <span className="text-green-600">${fmtPrice(signal.suggested_take_profit)}</span></span>}
        </div>
      )}

      {canAct && (
        <div className="flex gap-2 mt-2.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onTrade(signal.id)}
            disabled={acting === signal.id}
            className={cn(
              'flex-1 h-8 text-xs font-bold rounded-lg transition-colors disabled:opacity-50',
              hasBuy ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-red-500 text-white hover:bg-red-600'
            )}
          >
            {acting === signal.id ? '…' : hasBuy ? '📄 Koop' : '📄 Verkoop'}
          </button>
          <button
            onClick={() => onReject(signal.id)}
            disabled={acting === signal.id}
            className="h-8 px-3 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ── Activity Feed Item ─────────────────────────────────────────────────────────

function FeedItem({ event, highlight }: { event: ActivityEvent; highlight: boolean }) {
  const [open, setOpen] = useState(false);
  const { icon, label, color } = actionMeta(event.action);
  const details = (event.details ?? {}) as Record<string, unknown>;
  const confidence = details.confidence as number | undefined;
  const bull = details.bull_score as number | undefined;
  const bear = details.bear_score as number | undefined;
  const asset = details.asset as string | undefined;
  const notional = details.notional as number | undefined;
  const hasDetail = confidence !== undefined || (bull !== undefined && bear !== undefined);
  const time = event.created_at
    ? new Date(event.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--';

  const text = event.message
    ? event.message.slice(0, 120)
    : `${asset ? `${asset} ` : ''}${label.toLowerCase()}`;

  return (
    <div
      className={cn(
        'px-4 py-2.5 border-b border-border/50 transition-colors',
        highlight && 'bg-amber-500/8',
        hasDetail && 'cursor-pointer hover:bg-accent/20',
      )}
      onClick={() => hasDetail && setOpen(o => !o)}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-base shrink-0 mt-px leading-none">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className={cn('text-xs leading-snug', color)}>{text}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground tabular-nums">{time}</span>
            {notional && <span className="text-[10px] text-muted-foreground">${notional.toFixed(0)}</span>}
          </div>
        </div>
        {hasDetail && (
          <span className="text-muted-foreground/50 mt-1 shrink-0">
            {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </span>
        )}
      </div>

      {open && hasDetail && (
        <div className="mt-2 space-y-2 pl-7">
          {confidence !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-16 shrink-0">Confidence</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(confidence * 100).toFixed(0)}%` }} />
              </div>
              <span className="text-[10px] text-amber-500 font-bold tabular-nums w-8 text-right">{(confidence * 100).toFixed(0)}%</span>
            </div>
          )}
          {bull !== undefined && bear !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-green-600 w-16 shrink-0">🐂 {(bull * 100).toFixed(0)}%</span>
              <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-muted">
                <div className="bg-green-500" style={{ width: `${((bull / ((bull + bear) || 1)) * 100).toFixed(0)}%` }} />
                <div className="bg-red-500 flex-1" />
              </div>
              <span className="text-[10px] text-red-500 w-16 text-right shrink-0">🐻 {(bear * 100).toFixed(0)}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section Header ─────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, count, badge }: {
  icon: React.ReactNode; title: string; count?: number; badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-4 h-10 bg-card/60 border-b border-border shrink-0">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs font-bold uppercase tracking-wide text-foreground">{title}</span>
      {count !== undefined && (
        <span className={cn(
          'ml-0.5 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1',
          count > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        )}>
          {count}
        </span>
      )}
      {badge && <div className="ml-auto">{badge}</div>}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

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
  const [filterMode, setFilterMode] = useState<'all' | 'signals'>('all');
  const [rightTab, setRightTab] = useState<'positions' | 'signals' | 'feed'>('signals');
  const { toast } = useToast();

  const { data: initialAudit } = useApi(() => api.getAuditLogs(50), []);
  const { data: initialSignals } = useApi(() => api.getSignals(50), []);
  useEffect(() => { if (initialAudit && activityFeed.length === 0) setActivityFeed(initialAudit as any[]); }, [initialAudit]);
  useEffect(() => { if (initialSignals && signals.length === 0) setSignals(initialSignals as any[]); }, [initialSignals]);

  useEffect(() => {
    const load = async () => {
      try { const d = await api.getPositions() as AlpacaPosition[]; setPositions(Array.isArray(d) ? d : []); } catch {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const signalMap = useMemo((): Record<string, SignalData> => {
    const map: Record<string, SignalData> = {};
    [...signals].reverse().forEach(s => { map[s.asset] = s; });
    signals.filter(s => !s.status || s.status === 'pending').forEach(s => { map[s.asset] = s; });
    return map;
  }, [signals]);

  const pendingSignals = useMemo(() => signals.filter(s => isPending(s)), [signals]);

  const gridSymbols = useMemo(() => {
    const extras = signals.map(s => s.asset).filter(a => !CRYPTO_SYMBOLS.includes(a)).filter((v, i, a) => a.indexOf(v) === i);
    const all = [...CRYPTO_SYMBOLS, ...extras];
    const base = filterMode === 'signals' ? all.filter(sym => !!signalMap[sym]) : all;
    return [...base].sort((a, b) => {
      const aP = isPending(signalMap[a]) ? -1 : 0;
      const bP = isPending(signalMap[b]) ? -1 : 0;
      return aP - bP;
    });
  }, [signals, signalMap, filterMode]);

  const handlePrice = useCallback((data: Record<string, unknown>) => {
    const pd = data as unknown as PriceData;
    if (pd.symbol) setPrices(prev => ({ ...prev, [pd.symbol]: pd }));
  }, []);

  const handleChartData = useCallback((data: Record<string, unknown>) => {
    const sym = data.symbol as string;
    const cs = data.candles as OHLCVCandle[];
    if (sym && Array.isArray(cs)) {
      setCandles(prev => ({ ...prev, [sym]: cs }));
      const last = cs[cs.length - 1];
      if (last) setPrices(prev => prev[sym] ? prev : { ...prev, [sym]: { symbol: sym, price: last.close, open: cs[0]?.open ?? last.open, high: last.high, low: last.low, volume: last.volume } });
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
    setRightTab('signals');
  }, []);

  const handleActivity = useCallback((data: Record<string, unknown>) => {
    const events = data.events as ActivityEvent[];
    if (!Array.isArray(events)) return;
    setActivityFeed(prev => {
      const keys = new Set(prev.map(e => `${e.created_at}::${e.action}`));
      const fresh = events.filter(e => !keys.has(`${e.created_at}::${e.action}`));
      if (fresh.length === 0) return prev;
      setHighlightKeys(new Set(fresh.map(e => `${e.created_at}::${e.action}`)));
      setTimeout(() => setHighlightKeys(new Set()), 4000);
      return [...fresh, ...prev].slice(0, 100);
    });
  }, []);

  const handlePortfolio = useCallback((d: Record<string, unknown>) => setPortfolio(d as unknown as Portfolio), []);
  const handleHeartbeat = useCallback((d: Record<string, unknown>) => setTick(d.tick as number), []);

  useSSE(
    `/api/stream/session?symbols=${SYMBOLS_PARAM}`,
    { chart_data: handleChartData, price: handlePrice, signals: handleSignals, new_signal: handleNewSignal, activity_batch: handleActivity, portfolio: handlePortfolio, heartbeat: handleHeartbeat },
    { onConnected: () => setConnected(true), onDisconnected: () => setConnected(false) },
  );

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
    } finally { setActing(null); }
  }

  async function handleReject(id: string) {
    setActing(id);
    try {
      await api.rejectSignal(id);
      toast('Signal afgewezen', 'info');
      const sigs = await api.getSignals(100);
      if (Array.isArray(sigs)) setSignals(sigs);
    } catch {}
    setActing(null);
  }

  async function handleClose(sym: string) {
    setClosing(sym);
    try {
      await api.closePosition(sym);
      toast(`📤 ${sym} positie gesloten`, 'success');
      const d = await api.getPositions() as AlpacaPosition[];
      setPositions(Array.isArray(d) ? d : []);
    } catch (e: any) {
      toast(`❌ Sluiten mislukt: ${e?.detail || 'Onbekende fout'}`, 'error');
    } finally { setClosing(null); }
  }

  function openSignalAsset(asset: string) {
    setSelectedSymbol(asset);
  }

  const signalCount = pendingSignals.length;
  const allCount = gridSymbols.length;

  return (
    <div className="flex flex-col -m-3 md:-m-4 bg-background" style={{ height: 'calc(100dvh - 48px)' }}>

      <LiveHeader connected={connected} tick={tick} portfolio={portfolio} />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Market Grid ────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Filter bar */}
          <div className="flex items-center gap-1 px-4 h-10 border-b border-border shrink-0 bg-card/40">
            <span className="text-xs text-muted-foreground font-medium mr-2">Markt</span>
            {([
              { key: 'all', label: `Alle ${allCount}` },
              { key: 'signals', label: `Signalen ${signalCount > 0 ? signalCount : ''}` },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterMode(key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  filterMode === key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Grid with optional chart overlay */}
          <div className="flex-1 overflow-hidden relative">
            {/* Asset grid */}
            <div className="h-full overflow-y-auto p-4">
              {filterMode === 'signals' && gridSymbols.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                  <span className="text-4xl opacity-20">⚖️</span>
                  <p className="text-sm">Geen actieve signalen</p>
                  <p className="text-xs opacity-60">AI analyseert de markt…</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                  {gridSymbols.map(sym => (
                    <AssetCard
                      key={sym}
                      symbol={sym}
                      price={prices[sym]}
                      candles={candles[sym] ?? []}
                      signal={signalMap[sym]}
                      selected={selectedSymbol === sym}
                      onClick={() => setSelectedSymbol(prev => prev === sym ? null : sym)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Chart drawer overlay */}
            {selectedSymbol && (
              <ChartDrawer
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
          </div>
        </div>

        {/* ── Right sidebar ────────────────────────────────────────────── */}
        <div className="w-80 xl:w-96 border-l border-border flex flex-col shrink-0 overflow-hidden bg-card/30">

          {/* Tab bar */}
          <div className="flex border-b border-border shrink-0">
            {([
              { key: 'signals', label: 'Signalen', icon: <Zap size={12} />, badge: signalCount },
              { key: 'positions', label: 'Posities', icon: <Layers size={12} />, badge: positions.length },
              { key: 'feed', label: 'AI Feed', icon: <Activity size={12} /> },
            ] as const).map(({ key, label, icon, badge }) => (
              <button
                key={key}
                onClick={() => setRightTab(key)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 h-10 text-xs font-medium transition-colors border-b-2 -mb-px',
                  rightTab === key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30',
                )}
              >
                {icon}
                {label}
                {badge !== undefined && badge > 0 && (
                  <span className={cn(
                    'min-w-[16px] h-4 rounded-full text-[9px] font-bold flex items-center justify-center px-1',
                    rightTab === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  )}>
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab: Signals */}
          {rightTab === 'signals' && (
            <div className="flex-1 overflow-y-auto">
              {pendingSignals.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-16">
                  <span className="text-4xl opacity-20">⚖️</span>
                  <p className="text-sm">Geen actieve signalen</p>
                  <p className="text-xs opacity-60">AI genereert elke 5 minuten</p>
                </div>
              ) : pendingSignals.map(sig => (
                <SignalCard
                  key={sig.id}
                  signal={sig}
                  onTrade={handleTrade}
                  onReject={handleReject}
                  acting={acting}
                  onClick={() => openSignalAsset(sig.asset)}
                />
              ))}
            </div>
          )}

          {/* Tab: Positions */}
          {rightTab === 'positions' && (
            <div className="flex-1 overflow-y-auto">
              {positions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-16">
                  <span className="text-4xl opacity-20">📊</span>
                  <p className="text-sm">Geen open posities</p>
                </div>
              ) : (
                <div>
                  {/* Total P&L summary */}
                  {(() => {
                    const total = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl ?? '0'), 0);
                    return (
                      <div className="px-4 py-3 bg-card border-b border-border">
                        <p className="text-xs text-muted-foreground">Totaal ongerealiseerd</p>
                        <p className={cn('text-lg font-bold tabular-nums', total >= 0 ? 'text-green-600' : 'text-red-500')}>
                          {total >= 0 ? '+' : ''}{fmtUSD(total)}
                        </p>
                      </div>
                    );
                  })()}
                  {positions.map((pos, i) => (
                    <PositionRow key={i} pos={pos} onClose={handleClose} closing={closing} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: AI Feed */}
          {rightTab === 'feed' && (
            <div className="flex-1 overflow-y-auto">
              {activityFeed.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-16">
                  <span className="text-4xl opacity-20">🧠</span>
                  <p className="text-sm">Wachten op AI activiteit…</p>
                </div>
              ) : activityFeed.map((event, idx) => (
                <FeedItem
                  key={`${event.created_at}::${event.action}::${idx}`}
                  event={event}
                  highlight={highlightKeys.has(`${event.created_at}::${event.action}`)}
                />
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
