'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { fmtUSD } from '@/lib/utils';
import { useSSE } from '@/hooks/useSSE';
import { api } from '@/lib/api';
import { useToast } from '@/contexts/toast';
import { CandlestickChart } from '@/components/live/CandlestickChart';
import { X, TrendingUp, TrendingDown, ChevronDown, ChevronUp, Zap, BarChart2, Wallet, Activity } from 'lucide-react';

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
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ALL_SYMBOLS = ['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'LTC', 'AAVE', 'BCH', 'UNI', 'ALGO'];
const STREAM_SYMBOLS = ALL_SYMBOLS.join(',');
const NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', DOGE: 'Dogecoin',
  AVAX: 'Avalanche', LINK: 'Chainlink', LTC: 'Litecoin', BCH: 'Bitcoin Cash',
  UNI: 'Uniswap', AAVE: 'Aave', ALGO: 'Algorand',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(p: number) {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}
function isPending(s?: SignalData) { return s && (!s.status || s.status === 'pending'); }
function relTime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
function eventMeta(action: string) {
  if (action === 'signal_generated') return { icon: '⚖️', color: 'text-amber-600' };
  if (action === 'auto_trade_executed') return { icon: '✅', color: 'text-green-600' };
  if (action === 'auto_trade_risk_rejected') return { icon: '🚫', color: 'text-orange-500' };
  if (action === 'circuit_breaker_triggered') return { icon: '🔴', color: 'text-red-600' };
  if (action.includes('reflection') || action === 'trade_reflection_written') return { icon: '💡', color: 'text-purple-600' };
  if (action === 'ai_provider_paused') return { icon: '⏸️', color: 'text-amber-600' };
  if (action.includes('position_close') || action === 'position_auto_closed') return { icon: '📤', color: 'text-blue-600' };
  return { icon: '🔄', color: 'text-muted-foreground' };
}

// ── Sparkline ──────────────────────────────────────────────────────────────────

function Sparkline({ candles, w = 64, h = 28, id }: { candles: OHLCVCandle[]; w?: number; h?: number; id: string }) {
  if (candles.length < 2) return <div style={{ width: w, height: h }} />;
  const prices = candles.map(c => c.close);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const rng = hi - lo || lo * 0.01 || 1;
  const P = 1.5;
  const pts = prices.map((p, i) => `${P + (i / (prices.length - 1)) * (w - P * 2)},${h - P - ((p - lo) / rng) * (h - P * 2)}`);
  const up = prices.at(-1)! >= prices[0];
  const c = up ? '#16a34a' : '#dc2626';
  const gid = `sp-${id}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.25" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M${P},${h} ${pts.map(p => `L${p}`).join(' ')} L${w - P},${h} Z`} fill={`url(#${gid})`} />
      <polyline points={pts.join(' ')} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────────

function Header({ connected, tick, portfolio, openCount, pendingCount }: {
  connected: boolean; tick: number; portfolio: Portfolio | null;
  openCount: number; pendingCount: number;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const pnl = portfolio?.day_pnl ?? null;

  return (
    <div className="shrink-0 border-b border-border bg-card">
      <div className="flex items-center gap-2 px-4 h-8 border-b border-border/50">
        <div className={cn('flex items-center gap-1.5 text-[11px] font-semibold', connected ? 'text-green-600' : 'text-muted-foreground')}>
          <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-500 animate-pulse' : 'bg-muted')} />
          {connected ? `LIVE · ${tick}` : 'VERBINDEN…'}
        </div>
        <span className="text-[11px] text-muted-foreground font-mono ml-1">{now.toLocaleTimeString('nl-NL')}</span>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          {pendingCount > 0 && (
            <span className="flex items-center gap-1 text-amber-600 font-semibold">
              <Zap size={10} /> {pendingCount} signaal{pendingCount > 1 ? 'en' : ''}
            </span>
          )}
          <span className="text-muted-foreground">{openCount} positie{openCount !== 1 ? 's' : ''} open</span>
        </div>
      </div>
      <div className="flex items-center gap-6 px-4 h-12 overflow-x-auto">
        {portfolio ? (
          <>
            <Metric label="Portfolio" value={fmtUSD(portfolio.equity)} />
            <Metric label="Beschikbaar" value={fmtUSD(portfolio.buying_power)} />
            <Metric label="Vandaag" value={`${pnl !== null && pnl >= 0 ? '+' : ''}${fmtUSD(pnl ?? 0)}`} valueClass={pnl !== null && pnl >= 0 ? 'text-green-600' : 'text-red-500'} />
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Portfolio laden…</span>
        )}
        <div className="ml-auto text-[11px] text-amber-600 flex items-center gap-1 shrink-0">
          <Zap size={11} /> AI actief
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="shrink-0">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">{label}</p>
      <p className={cn('text-sm font-bold tabular-nums mt-0.5', valueClass ?? 'text-foreground')}>{value}</p>
    </div>
  );
}

// ── Asset Card ─────────────────────────────────────────────────────────────────

function AssetCard({ symbol, price, candles, signal, selected, onClick }: {
  symbol: string; price?: PriceData; candles: OHLCVCandle[];
  signal?: SignalData; selected: boolean; onClick: () => void;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const up = pct !== null && pct >= 0;
  const hasPending = isPending(signal);
  const isBuy = signal?.direction === 'buy';

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative text-left w-full rounded-xl border bg-card transition-all group',
        'hover:shadow-md hover:-translate-y-px active:translate-y-0',
        selected ? 'border-primary ring-2 ring-primary/20 shadow-md'
          : hasPending ? (isBuy ? 'border-green-400/70' : 'border-red-400/70')
            : 'border-border hover:border-primary/40',
      )}
    >
      {hasPending && <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-xl', isBuy ? 'bg-green-500' : 'bg-red-500')} />}
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-bold text-sm">{symbol}</p>
            <p className="text-[10px] text-muted-foreground">{NAMES[symbol] ?? symbol}</p>
          </div>
          {hasPending && (
            <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5', isBuy ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500')}>
              {isBuy ? '▲ BUY' : '▼ SELL'}
            </span>
          )}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className={cn('text-xl font-bold tabular-nums leading-none', price ? 'text-foreground' : 'text-muted-foreground/30')}>
              {price ? `$${fmt(price.price)}` : '—'}
            </p>
            {pct !== null ? (
              <p className={cn('text-xs font-semibold mt-0.5 flex items-center gap-0.5', up ? 'text-green-600' : 'text-red-500')}>
                {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}{up ? '+' : ''}{pct.toFixed(2)}%
              </p>
            ) : <p className="text-xs text-muted-foreground/30 mt-0.5">—</p>}
          </div>
          <Sparkline candles={candles} id={symbol} />
        </div>
        {hasPending && (
          <div>
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-muted-foreground">Confidence</span>
              <span className={cn('font-bold', isBuy ? 'text-green-600' : 'text-red-500')}>{(signal!.confidence * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div className={cn('h-full rounded-full', isBuy ? 'bg-green-500' : 'bg-red-500')} style={{ width: `${(signal!.confidence * 100).toFixed(0)}%` }} />
            </div>
          </div>
        )}
      </div>
    </button>
  );
}

// ── Chart View ─────────────────────────────────────────────────────────────────

function ChartView({ symbol, price, candles, signal, onClose, onTrade, onReject, acting }: {
  symbol: string; price?: PriceData; candles: OHLCVCandle[]; signal?: SignalData;
  onClose: () => void; onTrade: (id: string) => void; onReject: (id: string) => void; acting: string | null;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const up = pct !== null && pct >= 0;
  const isBuy = signal?.direction === 'buy';
  const canAct = isPending(signal);
  const ai = signal?.ai_analysis;

  const chartSignals = signal && candles.length > 0 ? [{
    time: candles.at(-1)!.time,
    direction: isBuy ? 'long' as const : 'short' as const,
    symbol,
  }] : [];

  const chartLevels = signal ? {
    entry: signal.suggested_entry,
    stopLoss: signal.suggested_stop,
    takeProfit: signal.suggested_take_profit,
  } : undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Chart header */}
      <div className="flex items-center gap-3 px-4 h-11 border-b border-border shrink-0 bg-card">
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
        <span className="font-bold">{symbol}</span>
        <span className="text-sm text-muted-foreground">{NAMES[symbol]}</span>
        {price && <span className="font-bold text-lg tabular-nums ml-auto">${fmt(price.price)}</span>}
        {pct !== null && (
          <span className={cn('text-sm font-semibold', up ? 'text-green-600' : 'text-red-500')}>
            {up ? '+' : ''}{pct.toFixed(2)}%
          </span>
        )}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {candles.length > 1
          ? <CandlestickChart candles={candles} signals={chartSignals} levels={chartLevels} dark />
          : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <BarChart2 size={32} className="mx-auto opacity-20 mb-2" />
                <p className="text-sm">Grafiekdata laden…</p>
              </div>
            </div>
          )
        }
      </div>

      {/* Signal detail */}
      {signal && (
        <div className="shrink-0 border-t border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', isBuy ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500')}>
                {isBuy ? '▲ BUY' : '▼ SELL'} · {(signal.confidence * 100).toFixed(0)}%
              </span>
              {signal.risk_reward && <span className="text-xs text-muted-foreground">R/R {signal.risk_reward.toFixed(2)}</span>}
              {signal.timeframe && <span className="text-xs text-muted-foreground capitalize">{signal.timeframe}</span>}
            </div>
            {canAct && (
              <div className="flex gap-2">
                <button onClick={() => onTrade(signal.id)} disabled={acting === signal.id}
                  className={cn('h-8 px-4 text-xs font-bold rounded-lg transition-colors disabled:opacity-50', isBuy ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white hover:bg-red-700')}>
                  {acting === signal.id ? '…' : isBuy ? '📄 Paper koop' : '📄 Paper verkoop'}
                </button>
                <button onClick={() => onReject(signal.id)} disabled={acting === signal.id}
                  className="h-8 px-3 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50">
                  Afwijzen
                </button>
              </div>
            )}
          </div>

          {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
            <div className="grid grid-cols-3 gap-2">
              {signal.suggested_entry && (
                <div className="bg-muted/50 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Entry</p>
                  <p className="text-sm font-bold mt-0.5">${fmt(signal.suggested_entry)}</p>
                </div>
              )}
              {signal.suggested_stop && (
                <div className="bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-red-500/70 uppercase tracking-wide">Stop</p>
                  <p className="text-sm font-bold text-red-500 mt-0.5">${fmt(signal.suggested_stop)}</p>
                </div>
              )}
              {signal.suggested_take_profit && (
                <div className="bg-green-500/5 border border-green-500/10 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-green-600/70 uppercase tracking-wide">Target</p>
                  <p className="text-sm font-bold text-green-600 mt-0.5">${fmt(signal.suggested_take_profit)}</p>
                </div>
              )}
            </div>
          )}

          {ai?.bull_score !== undefined && ai.bear_score !== undefined && (
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-green-600 w-12 shrink-0">🐂 {(ai.bull_score * 100).toFixed(0)}%</span>
              <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-muted">
                <div className="bg-green-500 transition-all" style={{ width: `${(ai.bull_score / ((ai.bull_score + ai.bear_score) || 1) * 100).toFixed(0)}%` }} />
                <div className="bg-red-500 flex-1" />
              </div>
              <span className="text-xs font-semibold text-red-500 w-12 text-right shrink-0">🐻 {(ai.bear_score * 100).toFixed(0)}%</span>
            </div>
          )}

          {signal.reason && (
            <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-2 line-clamp-3">{signal.reason}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Position Row ───────────────────────────────────────────────────────────────

function PositionRow({ pos, onClose, closing, signal }: {
  pos: AlpacaPosition; onClose: (s: string) => void; closing: string | null; signal?: SignalData;
}) {
  const pnl = parseFloat(pos.unrealized_pl ?? '0');
  const pct = parseFloat(pos.unrealized_plpc ?? '0') * 100;
  const sym = pos.symbol.split('/')[0];
  const qty = parseFloat(pos.qty ?? '0');
  const entry = parseFloat(pos.avg_entry_price ?? '0');
  const currentPrice = entry * (1 + pct / 100);
  const sl = signal?.suggested_stop;
  const tp = signal?.suggested_take_profit;

  // Progress: how far from entry to TP (0-100%)
  const progress = tp && sl && tp !== entry
    ? Math.max(0, Math.min(100, ((currentPrice - entry) / (tp - entry)) * 100))
    : null;

  return (
    <div className="px-4 py-3 border-b border-border/40 last:border-0 hover:bg-accent/20 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm font-num">{sym}</span>
            <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', pnl >= 0 ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400')}>
              LONG
            </span>
            <span className={cn('text-sm font-bold font-num tabular-nums ml-auto', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
              {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground font-num">
            <span>{qty < 1 ? qty.toFixed(5) : qty.toFixed(3)} stuks</span>
            <span>Entry <span className="text-foreground">${fmt(entry)}</span></span>
            {sl && <span>SL <span className="text-red-400">${fmt(sl)}</span></span>}
            {tp && <span>TP <span className="text-green-400">${fmt(tp)}</span></span>}
          </div>
        </div>
        <button onClick={() => onClose(sym)} disabled={closing === sym}
          className="h-7 px-2.5 text-[11px] rounded-lg border border-border text-muted-foreground hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-40 shrink-0">
          {closing === sym ? '…' : 'Sluit'}
        </button>
      </div>

      {/* Progress: entry → current → TP */}
      {progress !== null && (
        <div className="mt-2 space-y-0.5">
          <div className="flex justify-between text-[9px] text-muted-foreground font-num">
            <span>Entry ${fmt(entry)}</span>
            <span className={cn('font-bold', pct >= 0 ? 'text-green-400' : 'text-red-400')}>
              {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
            </span>
            <span className="text-green-400">TP ${fmt(tp!)}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', pnl >= 0 ? 'bg-green-500' : 'bg-red-500')}
              style={{ width: `${Math.max(2, progress)}%` }}
            />
          </div>
          {sl && (
            <div className="flex justify-between text-[9px] text-muted-foreground font-num">
              <span className="text-red-400/60">SL ${fmt(sl)}</span>
              <span>{progress.toFixed(0)}% naar target</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Signal Card ────────────────────────────────────────────────────────────────

function SignalCard({ signal, onTrade, onReject, acting, onClick }: {
  signal: SignalData; onTrade: (id: string) => void; onReject: (id: string) => void;
  acting: string | null; onClick: () => void;
}) {
  const isBuy = signal.direction === 'buy';
  const canAct = isPending(signal);

  return (
    <div onClick={onClick} className={cn('mx-3 my-2 rounded-xl border p-3 cursor-pointer hover:shadow-sm transition-all', isBuy ? 'border-green-400/40 bg-green-500/[0.03]' : 'border-red-400/40 bg-red-500/[0.03]')}>
      <div className="flex items-center justify-between mb-2">
        <span className={cn('text-sm font-bold px-2 py-0.5 rounded-full', isBuy ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500')}>
          {isBuy ? '▲' : '▼'} {signal.asset}
        </span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{(signal.confidence * 100).toFixed(0)}% conf</span>
          {signal.created_at && <span>{relTime(signal.created_at)}</span>}
        </div>
      </div>

      <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
        <div className={cn('h-full rounded-full', isBuy ? 'bg-green-500' : 'bg-red-500')} style={{ width: `${(signal.confidence * 100).toFixed(0)}%` }} />
      </div>

      {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
        <div className="flex gap-3 text-xs font-mono mb-2">
          {signal.suggested_entry && <span className="text-muted-foreground">E <span className="text-foreground font-bold">${fmt(signal.suggested_entry)}</span></span>}
          {signal.suggested_stop && <span className="text-muted-foreground">SL <span className="text-red-500 font-bold">${fmt(signal.suggested_stop)}</span></span>}
          {signal.suggested_take_profit && <span className="text-muted-foreground">TP <span className="text-green-600 font-bold">${fmt(signal.suggested_take_profit)}</span></span>}
          {signal.risk_reward && <span className="text-muted-foreground ml-auto">R/R <span className="text-foreground">{signal.risk_reward.toFixed(2)}</span></span>}
        </div>
      )}

      {canAct && (
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <button onClick={() => onTrade(signal.id)} disabled={acting === signal.id}
            className={cn('flex-1 h-8 text-xs font-bold rounded-lg transition-colors disabled:opacity-50', isBuy ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white hover:bg-red-700')}>
            {acting === signal.id ? '…' : isBuy ? '📄 Paper koop' : '📄 Paper verkoop'}
          </button>
          <button onClick={() => onReject(signal.id)} disabled={acting === signal.id}
            className="h-8 px-3 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ── Feed Item ──────────────────────────────────────────────────────────────────

function FeedItem({ event, fresh }: { event: ActivityEvent; fresh: boolean }) {
  const [open, setOpen] = useState(false);
  const { icon, color } = eventMeta(event.action);
  const d = (event.details ?? {}) as Record<string, unknown>;
  const conf = d.confidence as number | undefined;
  const bull = d.bull_score as number | undefined;
  const bear = d.bear_score as number | undefined;
  const hasDetail = conf !== undefined || (bull !== undefined && bear !== undefined);
  const time = new Date(event.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const text = (event.message || '').slice(0, 120) || event.action.replace(/_/g, ' ');

  return (
    <div className={cn('border-b border-border/40 transition-colors', fresh && 'bg-amber-500/5', hasDetail && 'cursor-pointer hover:bg-accent/20')} onClick={() => hasDetail && setOpen(o => !o)}>
      <div className="flex items-start gap-2.5 px-4 py-2.5">
        <span className="text-base shrink-0 leading-none mt-px">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className={cn('text-xs leading-snug', color)}>{text}</p>
          <span className="text-[10px] text-muted-foreground tabular-nums">{time}</span>
        </div>
        {hasDetail && <span className="text-muted-foreground/40 shrink-0 mt-1">{open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}</span>}
      </div>
      {open && hasDetail && (
        <div className="px-4 pb-3 space-y-2">
          {conf !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-16">Confidence</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-amber-400" style={{ width: `${(conf * 100).toFixed(0)}%` }} />
              </div>
              <span className="text-[10px] text-amber-600 font-bold w-8 text-right">{(conf * 100).toFixed(0)}%</span>
            </div>
          )}
          {bull !== undefined && bear !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-green-600 w-12 shrink-0">🐂 {(bull * 100).toFixed(0)}%</span>
              <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-muted">
                <div className="bg-green-500" style={{ width: `${(bull / ((bull + bear) || 1) * 100).toFixed(0)}%` }} />
                <div className="bg-red-500 flex-1" />
              </div>
              <span className="text-[10px] text-red-500 w-12 text-right shrink-0">🐻 {(bear * 100).toFixed(0)}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function LivePage() {
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [candles, setCandles] = useState<Record<string, OHLCVCandle[]>>({});
  const [signals, setSignals] = useState<SignalData[]>([]);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set());
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [tab, setTab] = useState<'signals' | 'positions' | 'feed'>('signals');
  const [filter, setFilter] = useState<'all' | 'signals'>('all');
  const { toast } = useToast();

  // ── REST initial load — ensures data shows before SSE connects ──────────────
  useEffect(() => {
    async function loadInitial() {
      try {
        const [sigs, audit, pos] = await Promise.allSettled([
          api.getSignals(50),
          api.getAuditLogs(50),
          api.getPositions(),
        ]);
        if (sigs.status === 'fulfilled' && Array.isArray(sigs.value)) setSignals(sigs.value as SignalData[]);
        if (audit.status === 'fulfilled' && Array.isArray(audit.value)) setFeed(audit.value as ActivityEvent[]);
        if (pos.status === 'fulfilled' && Array.isArray(pos.value)) setPositions(pos.value as AlpacaPosition[]);
      } catch {}
    }
    loadInitial();
  }, []);

  // ── Load candles via REST for every symbol — gives charts data immediately ──
  useEffect(() => {
    async function loadAllCandles() {
      const results = await Promise.allSettled(
        ALL_SYMBOLS.map(sym =>
          fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/stream/candles/${sym}?timeframe=1Day&limit=30`, {
            headers: { 'X-Dashboard-Pin': sessionStorage.getItem('dashboard_pin') || '' },
          }).then(r => r.json())
        )
      );
      const nextCandles: Record<string, OHLCVCandle[]> = {};
      const nextPrices: Record<string, PriceData> = {};
      results.forEach((r, i) => {
        const sym = ALL_SYMBOLS[i];
        if (r.status === 'fulfilled' && r.value?.candles?.length > 0) {
          const cs: OHLCVCandle[] = r.value.candles;
          nextCandles[sym] = cs;
          const last = cs.at(-1)!;
          nextPrices[sym] = { symbol: sym, price: last.close, open: cs[0].open, high: last.high, low: last.low, volume: last.volume };
        }
      });
      setCandles(prev => ({ ...nextCandles, ...prev }));
      setPrices(prev => ({ ...nextPrices, ...prev }));
    }
    loadAllCandles();
  }, []);

  // ── Polling: positions every 10s ────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try { const d = await api.getPositions() as AlpacaPosition[]; setPositions(Array.isArray(d) ? d : []); } catch {}
    };
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  // ── SSE handlers ─────────────────────────────────────────────────────────────
  const onPrice = useCallback((d: Record<string, unknown>) => {
    const p = d as unknown as PriceData;
    if (p.symbol) setPrices(prev => ({ ...prev, [p.symbol]: p }));
  }, []);

  const onChartData = useCallback((d: Record<string, unknown>) => {
    const sym = d.symbol as string;
    const cs = d.candles as OHLCVCandle[];
    if (sym && Array.isArray(cs) && cs.length > 0) {
      setCandles(prev => ({ ...prev, [sym]: cs }));
      const last = cs.at(-1)!;
      setPrices(prev => ({ ...prev, [sym]: { symbol: sym, price: last.close, open: cs[0].open, high: last.high, low: last.low, volume: last.volume } }));
    }
  }, []);

  const onSignals = useCallback((d: Record<string, unknown>) => {
    const s = d.signals as SignalData[];
    if (Array.isArray(s)) setSignals(s);
  }, []);

  const onNewSignal = useCallback((d: Record<string, unknown>) => {
    const s = d.signal as SignalData;
    if (!s) return;
    setSignals(prev => prev.find(x => x.id === s.id) ? prev : [s, ...prev]);
    setTab('signals');
  }, []);

  const onActivity = useCallback((d: Record<string, unknown>) => {
    const evs = d.events as ActivityEvent[];
    if (!Array.isArray(evs)) return;
    setFeed(prev => {
      const keys = new Set(prev.map(e => `${e.created_at}::${e.action}`));
      const fresh = evs.filter(e => !keys.has(`${e.created_at}::${e.action}`));
      if (!fresh.length) return prev;
      const fk = new Set(fresh.map(e => `${e.created_at}::${e.action}`));
      setFreshKeys(fk);
      setTimeout(() => setFreshKeys(new Set()), 5000);
      return [...fresh, ...prev].slice(0, 100);
    });
  }, []);

  const onPortfolio = useCallback((d: Record<string, unknown>) => setPortfolio(d as unknown as Portfolio), []);
  const onHeartbeat = useCallback((d: Record<string, unknown>) => setTick(d.tick as number), []);

  useSSE(
    `/api/stream/session?symbols=${STREAM_SYMBOLS}`,
    { price: onPrice, chart_data: onChartData, signals: onSignals, new_signal: onNewSignal, activity_batch: onActivity, portfolio: onPortfolio, heartbeat: onHeartbeat },
    { onConnected: () => setConnected(true), onDisconnected: () => setConnected(false) },
  );

  // ── Derived ───────────────────────────────────────────────────────────────────
  const signalMap = useMemo(() => {
    const m: Record<string, SignalData> = {};
    [...signals].reverse().forEach(s => { m[s.asset] = s; });
    signals.filter(s => isPending(s)).forEach(s => { m[s.asset] = s; });
    return m;
  }, [signals]);

  const pendingSignals = useMemo(() => signals.filter(isPending), [signals]);

  const gridSymbols = useMemo(() => {
    const extras = signals.map(s => s.asset).filter(a => !ALL_SYMBOLS.includes(a)).filter((v, i, a) => a.indexOf(v) === i);
    const base = filter === 'signals' ? [...ALL_SYMBOLS, ...extras].filter(s => !!signalMap[s]) : [...ALL_SYMBOLS, ...extras];
    return base.sort((a, b) => (isPending(signalMap[a]) ? -1 : 0) - (isPending(signalMap[b]) ? -1 : 0));
  }, [signals, signalMap, filter]);

  // ── Actions ───────────────────────────────────────────────────────────────────
  async function doTrade(id: string) {
    setActing(id);
    try {
      let r = await api.paperTradeSignal(id);
      if (r.status === 'requires_manual_approval') {
        if (!confirm('Risk check vereist bevestiging. Doorgaan?')) { setActing(null); return; }
        r = await api.paperTradeSignal(id, true);
      }
      toast('✅ Trade ingediend', 'success');
      const s = await api.getSignals(100);
      if (Array.isArray(s)) setSignals(s);
    } catch (e: any) {
      toast(`❌ ${e?.detail?.reasons?.join(', ') || e?.detail || 'Fout'}`, 'error');
    } finally { setActing(null); }
  }

  async function doReject(id: string) {
    setActing(id);
    try {
      await api.rejectSignal(id);
      toast('Signal afgewezen', 'info');
      const s = await api.getSignals(100);
      if (Array.isArray(s)) setSignals(s);
    } catch {}
    setActing(null);
  }

  async function doClose(sym: string) {
    setClosing(sym);
    try {
      await api.closePosition(sym);
      toast(`📤 ${sym} gesloten`, 'success');
      const d = await api.getPositions() as AlpacaPosition[];
      setPositions(Array.isArray(d) ? d : []);
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'Fout'}`, 'error');
    } finally { setClosing(null); }
  }

  const totalPnl = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl ?? '0'), 0);

  return (
    <div className="flex flex-col -m-3 md:-m-4 bg-background" style={{ height: 'calc(100dvh - 48px)' }}>

      <Header connected={connected} tick={tick} portfolio={portfolio} openCount={positions.length} pendingCount={pendingSignals.length} />

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left: grid + chart ─────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Filter bar */}
          <div className="flex items-center gap-1 px-4 h-9 border-b border-border shrink-0 bg-card/40">
            {(['all', 'signals'] as const).map(k => (
              <button key={k} onClick={() => setFilter(k)}
                className={cn('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors', filter === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}>
                {k === 'all' ? `Alle (${gridSymbols.length})` : `Signalen (${pendingSignals.length})`}
              </button>
            ))}
          </div>

          {/* Grid / Chart */}
          <div className="flex-1 min-h-0 overflow-hidden relative">
            {/* Asset grid — always rendered, hidden behind chart overlay */}
            <div className={cn('h-full overflow-y-auto p-4', selected && 'invisible')}>
              {filter === 'signals' && gridSymbols.length === 0
                ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                    <span className="text-4xl opacity-20">⚖️</span>
                    <p className="text-sm">Geen actieve signalen</p>
                    <p className="text-xs opacity-60">AI analyseert de markt…</p>
                  </div>
                )
                : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                    {gridSymbols.map(sym => (
                      <AssetCard key={sym} symbol={sym} price={prices[sym]} candles={candles[sym] ?? []}
                        signal={signalMap[sym]} selected={selected === sym}
                        onClick={() => setSelected(p => p === sym ? null : sym)} />
                    ))}
                  </div>
                )}
            </div>

            {/* Chart overlay */}
            {selected && (
              <div className="absolute inset-0 bg-background">
                <ChartView
                  symbol={selected} price={prices[selected]} candles={candles[selected] ?? []}
                  signal={signalMap[selected]} onClose={() => setSelected(null)}
                  onTrade={doTrade} onReject={doReject} acting={acting}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── Right sidebar ─────────────────────────────────────────────── */}
        <div className="w-72 xl:w-80 border-l border-border flex flex-col shrink-0 bg-card/20">

          {/* Tabs */}
          <div className="flex border-b border-border shrink-0">
            {([
              { k: 'signals', label: 'Signalen', icon: <Zap size={11} />, n: pendingSignals.length },
              { k: 'positions', label: 'Posities', icon: <Wallet size={11} />, n: positions.length },
              { k: 'feed', label: 'AI Feed', icon: <Activity size={11} /> },
            ] as const).map(({ k, label, icon, n }) => (
              <button key={k} onClick={() => setTab(k)}
                className={cn('flex-1 flex items-center justify-center gap-1 h-9 text-xs font-medium border-b-2 -mb-px transition-colors',
                  tab === k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/20')}>
                {icon}{label}
                {n !== undefined && n > 0 && (
                  <span className={cn('min-w-[14px] h-3.5 rounded-full text-[9px] font-bold flex items-center justify-center px-0.5',
                    tab === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{n}</span>
                )}
              </button>
            ))}
          </div>

          {/* Signals tab */}
          {tab === 'signals' && (
            <div className="flex-1 overflow-y-auto">
              {pendingSignals.length === 0
                ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-16">
                    <span className="text-3xl opacity-20">⚖️</span>
                    <p className="text-sm">Geen actieve signalen</p>
                    <p className="text-xs opacity-60">Volgende check: ~5 min</p>
                  </div>
                )
                : pendingSignals.map(s => (
                  <SignalCard key={s.id} signal={s} onTrade={doTrade} onReject={doReject} acting={acting} onClick={() => setSelected(s.asset)} />
                ))}
            </div>
          )}

          {/* Positions tab */}
          {tab === 'positions' && (
            <div className="flex-1 overflow-y-auto">
              {positions.length === 0
                ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-16">
                    <span className="text-3xl opacity-20">📊</span>
                    <p className="text-sm">Geen open posities</p>
                  </div>
                )
                : (
                  <>
                    <div className="px-4 py-3 border-b border-border bg-card">
                      <p className="text-xs text-muted-foreground">Totaal ongerealiseerd</p>
                      <p className={cn('text-lg font-bold tabular-nums', totalPnl >= 0 ? 'text-green-600' : 'text-red-500')}>
                        {totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}
                      </p>
                    </div>
                    {positions.map((p, i) => {
                      const sym = p.symbol.split('/')[0];
                      const relSignal = signals.find(s => s.asset === sym && s.status === 'paper_traded');
                      return <PositionRow key={i} pos={p} onClose={doClose} closing={closing} signal={relSignal} />;
                    })}
                  </>
                )}
            </div>
          )}

          {/* Feed tab */}
          {tab === 'feed' && (
            <div className="flex-1 overflow-y-auto">
              {feed.length === 0
                ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-16">
                    <span className="text-3xl opacity-20">🧠</span>
                    <p className="text-sm">Wachten op AI activiteit…</p>
                  </div>
                )
                : feed.map((ev, i) => (
                  <FeedItem key={`${ev.created_at}::${ev.action}::${i}`} event={ev} fresh={freshKeys.has(`${ev.created_at}::${ev.action}`)} />
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
