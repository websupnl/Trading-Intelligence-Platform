'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { cn, fmtUSD } from '@/lib/utils';
import { useSSE } from '@/hooks/useSSE';
import { api } from '@/lib/api';
import { useToast } from '@/contexts/toast';
import { PriceChart } from '@/components/charts/PriceChart';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface PriceData { symbol: string; price: number; open: number; high: number; low: number; volume: number; }
interface AiAnalysis {
  bull_score?: number; bear_score?: number; ta_rsi?: number; ta_trend?: string;
  ta_macd?: string; news_count?: number; key_risks?: string; reason?: string;
  direction?: string; confidence?: number;
}
interface Signal {
  id: string; asset: string; direction: string; confidence: number;
  reason?: string; status?: string; timeframe?: string;
  suggested_entry?: number; suggested_stop?: number; suggested_take_profit?: number;
  risk_reward?: number; ai_analysis?: AiAnalysis; created_at?: string;
}
interface ActivityEvent { action: string; actor: string; message?: string; status?: string; details?: Record<string, unknown>; created_at: string; }
interface Portfolio { equity: number; cash: number; buying_power: number; day_pnl: number; }
interface AlpacaPosition { symbol: string; qty: string; side: string; avg_entry_price: string; unrealized_pl: string; unrealized_plpc: string; market_value: string; }

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtP(p: number): string {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}
function isPending(s?: Signal) { return s && (!s.status || s.status === 'pending'); }
function relTime(iso: string): string {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

const ALL_SYMBOLS = ['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'LTC', 'AAVE', 'BCH', 'UNI', 'ALGO'];
const ASSET_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', DOGE: 'Dogecoin',
  AVAX: 'Avalanche', LINK: 'Chainlink', LTC: 'Litecoin', AAVE: 'Aave',
  BCH: 'Bitcoin Cash', UNI: 'Uniswap', ALGO: 'Algorand',
};

// ── RegimeBadge ────────────────────────────────────────────────────────────────

function RegimeBadge({ regime }: { regime: string }) {
  const cfg: Record<string, { label: string; className: string }> = {
    bull:    { label: '🐂 BULL',    className: 'bg-[#3fb950]/10 text-[#3fb950] border border-[#3fb950]/20' },
    bear:    { label: '🐻 BEAR',    className: 'bg-[#f85149]/10 text-[#f85149] border border-[#f85149]/20' },
    ranging: { label: '➡️ RANGING', className: 'bg-amber-500/10 text-amber-400 border border-amber-500/20' },
    unknown: { label: '? ONBEKEND', className: 'bg-muted text-muted-foreground border border-border' },
  };
  const c = cfg[regime] ?? cfg.unknown;
  return (
    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${c.className}`}>
      {c.label}
    </span>
  );
}

// ── WatchlistRow ───────────────────────────────────────────────────────────────

function WatchlistRow({ sym, price, signal, selected, onClick }: {
  sym: string; price?: PriceData; signal?: Signal; selected: boolean; onClick: () => void;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const up = pct !== null && pct >= 0;
  const hasSig = isPending(signal);
  const isBuy = signal?.direction === 'buy';

  return (
    <button onClick={onClick} className={cn(
      'w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[#21262d]',
      selected ? 'bg-[#21262d] border-l-2 border-[#58a6ff]' : 'border-l-2 border-transparent'
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
        hasSig ? (isBuy ? 'bg-[#3fb950] animate-pulse' : 'bg-[#f85149] animate-pulse') : 'bg-[#30363d]'
      )} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-bold text-xs text-white">{sym}</span>
          {pct !== null && (
            <span className={cn('text-[10px] font-semibold font-num', up ? 'text-[#3fb950]' : 'text-[#f85149]')}>
              {up ? '+' : ''}{pct.toFixed(2)}%
            </span>
          )}
        </div>
        <span className="text-[10px] font-num text-[#7d8590]">
          {price ? `$${fmtP(price.price)}` : '—'}
        </span>
      </div>
      {hasSig && (
        <span className={cn('text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0',
          isBuy ? 'bg-[#3fb950]/15 text-[#3fb950]' : 'bg-[#f85149]/15 text-[#f85149]'
        )}>
          {isBuy ? '▲' : '▼'}
        </span>
      )}
    </button>
  );
}

// ── RsiBar ─────────────────────────────────────────────────────────────────────

function RsiBar({ rsi, trend, macd }: { rsi?: number; trend?: string; macd?: string }) {
  if (!rsi && !trend) return null;
  const pct = rsi ?? 50;
  const rsiColor = rsi ? (rsi > 70 ? '#f85149' : rsi < 30 ? '#3fb950' : '#7d8590') : '#7d8590';
  const trendColor = trend === 'bullish' ? '#3fb950' : trend === 'bearish' ? '#f85149' : '#7d8590';

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-t border-[#21262d] bg-[#0d1117] text-[10px] shrink-0">
      {rsi !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-[#7d8590] w-6">RSI</span>
          <div className="relative w-28 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
            <div className="absolute left-0 top-0 h-full w-[30%] bg-[#3fb950]/10 rounded-l-full" />
            <div className="absolute right-0 top-0 h-full w-[30%] bg-[#f85149]/10 rounded-r-full" />
            <div className="absolute top-0 w-0.5 h-full rounded-full" style={{ left: `${pct}%`, backgroundColor: rsiColor }} />
          </div>
          <span className="font-num w-6" style={{ color: rsiColor }}>{rsi.toFixed(0)}</span>
        </div>
      )}
      {trend && (
        <div className="flex items-center gap-1.5">
          <span className="text-[#7d8590]">Trend</span>
          <span className="font-semibold capitalize" style={{ color: trendColor }}>{trend}</span>
        </div>
      )}
      {macd && (
        <div className="flex items-center gap-1.5">
          <span className="text-[#7d8590]">MACD</span>
          <span className="text-[#7d8590] max-w-[120px] truncate">{macd}</span>
        </div>
      )}
    </div>
  );
}

// ── AiBrainEntry ───────────────────────────────────────────────────────────────

function AiBrainEntry({ signal }: { signal: Signal }) {
  const [expanded, setExpanded] = useState(false);
  const ai = signal.ai_analysis;
  const isBuy = signal.direction === 'buy';
  const isSkip = signal.direction === 'skip';
  const conf = signal.confidence;
  const confPct = (conf * 100).toFixed(0);
  const age = signal.created_at ? relTime(signal.created_at) : '';

  const icon = isSkip ? '🔍' : isBuy ? '📈' : '📉';
  const actionColor = isSkip ? '#7d8590' : isBuy ? '#3fb950' : '#f85149';
  const actionLabel = isSkip ? 'SKIP' : isBuy ? 'BUY' : 'SELL';

  const bull = ai?.bull_score ?? 0;
  const bear = ai?.bear_score ?? 0;
  const total = bull + bear || 1;
  const bullPct = (bull / total * 100).toFixed(0);

  return (
    <div
      className="border-b border-[#21262d] cursor-pointer hover:bg-[#21262d]/30 transition-colors"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-start gap-2.5 px-4 py-3">
        <span className="text-base shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-xs text-white">{signal.asset}</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ color: actionColor, backgroundColor: `${actionColor}18` }}>
              {actionLabel}
            </span>
            {!isSkip && (
              <span className="text-[10px] font-num text-[#7d8590] ml-auto">{confPct}%</span>
            )}
            <span className="text-[9px] text-[#7d8590]/60">{age}</span>
          </div>

          {!isSkip && (
            <div className="h-1 bg-[#21262d] rounded-full overflow-hidden mb-2">
              <div className="h-full rounded-full"
                style={{ width: `${confPct}%`, backgroundColor: actionColor }} />
            </div>
          )}

          {(bull > 0 || bear > 0) && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] text-[#3fb950] font-num w-8 shrink-0">🐂 {bull.toFixed(1)}</span>
              <div className="flex-1 flex h-1 rounded-full overflow-hidden bg-[#21262d]">
                <div className="bg-[#3fb950]/70 transition-all" style={{ width: `${bullPct}%` }} />
                <div className="bg-[#f85149]/70 flex-1" />
              </div>
              <span className="text-[9px] text-[#f85149] font-num w-8 text-right shrink-0">🐻 {bear.toFixed(1)}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            {ai?.ta_rsi !== undefined && (
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-num',
                ai.ta_rsi > 70 ? 'bg-[#f85149]/10 text-[#f85149]' :
                ai.ta_rsi < 30 ? 'bg-[#3fb950]/10 text-[#3fb950]' :
                'bg-[#21262d] text-[#7d8590]'
              )}>RSI {ai.ta_rsi.toFixed(0)}</span>
            )}
            {ai?.ta_trend && (
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded capitalize',
                ai.ta_trend === 'bullish' ? 'bg-[#3fb950]/10 text-[#3fb950]' :
                ai.ta_trend === 'bearish' ? 'bg-[#f85149]/10 text-[#f85149]' :
                'bg-[#21262d] text-[#7d8590]'
              )}>{ai.ta_trend}</span>
            )}
            {ai?.news_count !== undefined && ai.news_count > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                📰 {ai.news_count} nieuws
              </span>
            )}
          </div>
        </div>
      </div>

      {expanded && (signal.reason || ai?.key_risks) && (
        <div className="px-4 pb-3 ml-7 space-y-2">
          {signal.reason && (
            <p className="text-[10px] text-[#7d8590] leading-relaxed bg-[#21262d] rounded-xl p-2.5">
              {signal.reason}
            </p>
          )}
          {ai?.key_risks && (
            <p className="text-[10px] text-amber-400/80 flex items-start gap-1">
              <span className="shrink-0">⚠️</span>
              <span>{ai.key_risks}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── EventFeedItem ──────────────────────────────────────────────────────────────

function EventFeedItem({ ev, fresh }: { ev: ActivityEvent; fresh: boolean }) {
  const actionMap: Record<string, { icon: string; color: string }> = {
    signal_generated:      { icon: '⚡', color: 'text-amber-400' },
    auto_trade_executed:   { icon: '✅', color: 'text-[#3fb950]' },
    auto_trade_skipped:    { icon: '⏭️', color: 'text-[#7d8590]' },
    position_auto_closed:  { icon: '📤', color: 'text-[#58a6ff]' },
    trailing_stop_updated: { icon: '📈', color: 'text-[#3fb950]/70' },
    ai_provider_paused:    { icon: '⏸️', color: 'text-amber-400' },
    ai_provider_resumed:   { icon: '▶️', color: 'text-[#3fb950]' },
    trade_data_reset:      { icon: '🗑️', color: 'text-[#7d8590]' },
  };
  const cfg = actionMap[ev.action] ?? { icon: '🔄', color: 'text-[#7d8590]' };
  const text = ev.message?.slice(0, 100) || ev.action.replace(/_/g, ' ');
  const time = new Date(ev.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className={cn('flex items-start gap-2.5 px-4 py-2 border-b border-[#21262d]/50 last:border-0', fresh && 'bg-amber-500/5')}>
      <span className="text-sm shrink-0 mt-px">{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <p className={cn('text-[10px] leading-snug break-words', cfg.color)}>{text}</p>
        <span className="text-[9px] text-[#7d8590]/60 font-num">{time}</span>
      </div>
    </div>
  );
}

// ── PositionRow ────────────────────────────────────────────────────────────────

function PositionRow({ pos, signalMap, onClose, closing }: {
  pos: AlpacaPosition;
  signalMap: Record<string, Signal>;
  onClose: (sym: string) => void;
  closing: string | null;
}) {
  const sym = pos.symbol.replace(/\/USD$/, '').replace(/USD$/, '');
  const pnl = parseFloat(pos.unrealized_pl ?? '0');
  const pct = parseFloat(pos.unrealized_plpc ?? '0') * 100;
  const entry = parseFloat(pos.avg_entry_price ?? '0');
  const relSignal = signalMap[sym];
  const tp = relSignal?.suggested_take_profit;
  const sl = relSignal?.suggested_stop;
  const progress = tp && entry && tp !== entry
    ? Math.max(0, Math.min(100, ((entry * (1 + pct / 100) - entry) / (tp - entry)) * 100))
    : null;

  return (
    <div className="px-4 py-3 border-b border-[#21262d] last:border-0">
      <div className="flex items-center gap-2.5 mb-2">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0',
          pnl >= 0 ? 'bg-[#3fb950]/10 text-[#3fb950]' : 'bg-[#f85149]/10 text-[#f85149]')}>
          {sym.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs text-white">{sym}</span>
            <span className={cn('font-bold text-sm font-num', pnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>
              {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
            </span>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-[10px] text-[#7d8590] font-num">@ ${fmtP(entry)}</span>
            <span className={cn('text-[10px] font-num', pnl >= 0 ? 'text-[#3fb950]/70' : 'text-[#f85149]/70')}>
              {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {(sl || tp) && (
        <div className="flex gap-3 text-[10px] font-num text-[#7d8590] mb-2">
          {sl && <span>SL <span className="text-[#f85149]">${fmtP(sl)}</span></span>}
          {tp && <span>TP <span className="text-[#3fb950]">${fmtP(tp)}</span></span>}
        </div>
      )}

      {progress !== null && (
        <div className="mb-2">
          <div className="h-1 bg-[#21262d] rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full', pnl >= 0 ? 'bg-[#3fb950]' : 'bg-[#f85149]')}
              style={{ width: `${Math.max(2, progress)}%` }} />
          </div>
        </div>
      )}

      <button
        onClick={() => onClose(sym)}
        disabled={closing === sym}
        className="w-full h-7 text-[10px] font-medium rounded-lg border border-[#30363d] text-[#7d8590] hover:text-[#f85149] hover:border-[#f85149]/30 transition-colors disabled:opacity-40"
      >
        {closing === sym ? '⏳ Sluiten…' : '✕ Positie sluiten'}
      </button>
    </div>
  );
}

// ── SignalDetailCard ───────────────────────────────────────────────────────────

function SignalDetailCard({ signal, onTrade, onReject, acting, onSelectChart }: {
  signal: Signal;
  onTrade: (id: string) => void;
  onReject: (id: string) => void;
  acting: string | null;
  onSelectChart: (sym: string) => void;
}) {
  const isBuy = signal.direction === 'buy';
  const canAct = isPending(signal);
  const ai = signal.ai_analysis;

  return (
    <div className={cn('mx-3 my-2 rounded-xl border p-3',
      isBuy ? 'border-[#3fb950]/25 bg-[#3fb950]/[0.03]' : 'border-[#f85149]/25 bg-[#f85149]/[0.03]')}>
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => onSelectChart(signal.asset)}
          className="font-bold text-sm text-white hover:text-[#58a6ff] transition-colors">
          {signal.asset}
        </button>
        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
          isBuy ? 'bg-[#3fb950]/15 text-[#3fb950]' : 'bg-[#f85149]/15 text-[#f85149]')}>
          {isBuy ? '▲ BUY' : '▼ SELL'}
        </span>
        <span className="text-[10px] text-[#7d8590] ml-auto font-num">{(signal.confidence * 100).toFixed(0)}%</span>
        {signal.created_at && <span className="text-[9px] text-[#7d8590]/60">{relTime(signal.created_at)}</span>}
      </div>

      <div className="h-1.5 bg-[#21262d] rounded-full overflow-hidden mb-2.5">
        <div className={cn('h-full rounded-full', isBuy ? 'bg-[#3fb950]' : 'bg-[#f85149]')}
          style={{ width: `${(signal.confidence * 100).toFixed(0)}%` }} />
      </div>

      {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
        <div className="grid grid-cols-3 gap-1.5 mb-2.5">
          {signal.suggested_entry && (
            <div className="bg-[#21262d] rounded-lg px-2 py-1.5">
              <p className="text-[8px] text-[#7d8590] uppercase">Entry</p>
              <p className="text-[10px] font-bold font-num text-white">${fmtP(signal.suggested_entry)}</p>
            </div>
          )}
          {signal.suggested_stop && (
            <div className="bg-[#f85149]/5 border border-[#f85149]/10 rounded-lg px-2 py-1.5">
              <p className="text-[8px] text-[#f85149]/60 uppercase">Stop</p>
              <p className="text-[10px] font-bold font-num text-[#f85149]">${fmtP(signal.suggested_stop)}</p>
            </div>
          )}
          {signal.suggested_take_profit && (
            <div className="bg-[#3fb950]/5 border border-[#3fb950]/10 rounded-lg px-2 py-1.5">
              <p className="text-[8px] text-[#3fb950]/60 uppercase">Target</p>
              <p className="text-[10px] font-bold font-num text-[#3fb950]">${fmtP(signal.suggested_take_profit)}</p>
            </div>
          )}
        </div>
      )}

      {ai?.bull_score !== undefined && ai.bear_score !== undefined && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] text-[#3fb950] font-num w-8 shrink-0">🐂 {ai.bull_score.toFixed(1)}</span>
          <div className="flex-1 flex h-1 rounded-full overflow-hidden bg-[#21262d]">
            <div className="bg-[#3fb950]"
              style={{ width: `${(ai.bull_score / ((ai.bull_score + ai.bear_score) || 1) * 100).toFixed(0)}%` }} />
            <div className="bg-[#f85149] flex-1" />
          </div>
          <span className="text-[9px] text-[#f85149] font-num w-8 text-right shrink-0">🐻 {ai.bear_score.toFixed(1)}</span>
        </div>
      )}

      {(signal.risk_reward || signal.timeframe) && (
        <div className="flex gap-3 text-[10px] text-[#7d8590] mb-2.5">
          {signal.risk_reward && <span>R/R <span className="text-white font-num">{signal.risk_reward.toFixed(2)}</span></span>}
          {signal.timeframe && <span>⏱ {signal.timeframe}</span>}
        </div>
      )}

      {canAct && (
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onTrade(signal.id)}
            disabled={acting === signal.id}
            className={cn('flex-1 h-8 text-xs font-bold rounded-xl transition-colors disabled:opacity-50',
              isBuy ? 'bg-[#3fb950] text-black hover:bg-[#3fb950]/90' : 'bg-[#f85149] text-white hover:bg-[#f85149]/90')}>
            {acting === signal.id ? '…' : '📄 Paper trade'}
          </button>
          <button
            onClick={() => onReject(signal.id)}
            disabled={acting === signal.id}
            className="h-8 px-3 text-[11px] rounded-xl border border-[#30363d] text-[#7d8590] hover:text-white hover:bg-[#21262d] transition-colors disabled:opacity-50">
            ✕
          </button>
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
  const [candles, setCandles] = useState<Record<string, Candle[]>>({});
  const [signals, setSignals] = useState<Signal[]>([]);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [selected, setSelected] = useState<string>('BTC');
  const [timeframe, setTimeframe] = useState<'15Min' | '1Hour' | '4Hour' | '1Day'>('1Day');
  const [acting, setActing] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'chart' | 'signals' | 'ai' | 'positions'>('chart');
  const [rightTab, setRightTab] = useState<'ai' | 'signals' | 'positions'>('ai');
  const [regime, setRegime] = useState<string>('unknown');
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  // ── Load candles ────────────────────────────────────────────────────────────

  const candlesRef = React.useRef(candles);
  candlesRef.current = candles;

  const loadCandles = useCallback(async (sym: string, tf: string, force?: boolean) => {
    if (!force && (candlesRef.current[sym]?.length ?? 0) > 1) return;
    try {
      const pin = typeof window !== 'undefined' ? sessionStorage.getItem('dashboard_pin') || '' : '';
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/api/stream/candles/${sym}?timeframe=${tf}&limit=100`,
        { headers: { 'X-Dashboard-Pin': pin } }
      );
      const d = await r.json();
      if (d?.candles?.length > 0) {
        setCandles(prev => ({ ...prev, [sym]: d.candles }));
        const last = d.candles.at(-1);
        if (last) {
          setPrices(prev => prev[sym] ? prev : {
            ...prev,
            [sym]: { symbol: sym, price: last.close, open: d.candles[0].open, high: last.high, low: last.low, volume: last.volume },
          });
        }
      }
    } catch {}
  }, []);

  // Load initial candles
  useEffect(() => { loadCandles('BTC', '1Day'); }, []); // eslint-disable-line

  // ── SSE handlers ────────────────────────────────────────────────────────────

  const onPrice = useCallback((d: Record<string, unknown>) => {
    const p = d as unknown as PriceData;
    if (p.symbol) setPrices(prev => ({ ...prev, [p.symbol]: p }));
  }, []);

  const onChartData = useCallback((d: Record<string, unknown>) => {
    const sym = d.symbol as string;
    const cs = d.candles as Candle[];
    if (sym && Array.isArray(cs) && cs.length > 0) {
      setCandles(prev => ({ ...prev, [sym]: cs }));
      const last = cs.at(-1)!;
      setPrices(prev => prev[sym] ? prev : {
        ...prev,
        [sym]: { symbol: sym, price: last.close, open: cs[0].open, high: last.high, low: last.low, volume: last.volume },
      });
    }
  }, []);

  const onSignals = useCallback((d: Record<string, unknown>) => {
    const s = d.signals as Signal[];
    if (Array.isArray(s)) setSignals(s);
  }, []);

  const onNewSignal = useCallback((d: Record<string, unknown>) => {
    const s = d.signal as Signal;
    if (s) {
      setSignals(prev => prev.find(x => x.id === s.id) ? prev : [s, ...prev]);
      setRightTab('ai');
    }
  }, []);

  const onActivity = useCallback((d: Record<string, unknown>) => {
    const evs = d.events as ActivityEvent[];
    if (!Array.isArray(evs)) return;
    setFeed(prev => {
      const keys = new Set(prev.map(e => `${e.created_at}::${e.action}`));
      const fresh = evs.filter(e => !keys.has(`${e.created_at}::${e.action}`));
      if (!fresh.length) return prev;
      setFreshKeys(new Set(fresh.map(e => `${e.created_at}::${e.action}`)));
      setTimeout(() => setFreshKeys(new Set()), 5000);
      return [...fresh, ...prev].slice(0, 100);
    });
  }, []);

  const onPortfolio = useCallback((d: Record<string, unknown>) => {
    setPortfolio(d as unknown as Portfolio);
  }, []);

  const onHeartbeat = useCallback((d: Record<string, unknown>) => {
    setTick(d.tick as number);
  }, []);

  const onRegime = useCallback((d: Record<string, unknown>) => {
    setRegime((d.regime as string) || 'unknown');
  }, []);

  const onPositions = useCallback((d: Record<string, unknown>) => {
    if (Array.isArray(d.positions)) setPositions(d.positions as AlpacaPosition[]);
  }, []);

  useSSE(
    `/api/stream/session?symbols=${ALL_SYMBOLS.join(',')}`,
    {
      price: onPrice,
      chart_data: onChartData,
      signals: onSignals,
      new_signal: onNewSignal,
      activity_batch: onActivity,
      portfolio: onPortfolio,
      heartbeat: onHeartbeat,
      positions: onPositions,
      regime: onRegime,
    },
    { onConnected: () => setConnected(true), onDisconnected: () => setConnected(false) }
  );

  // ── Derived state ────────────────────────────────────────────────────────────

  const signalMap = useMemo(() => {
    const m: Record<string, Signal> = {};
    [...signals].reverse().forEach(s => { m[s.asset] = s; });
    signals.filter(s => isPending(s)).forEach(s => { m[s.asset] = s; });
    return m;
  }, [signals]);

  const pendingSignals = useMemo(() => signals.filter(isPending), [signals]);

  const recentSignalsForAI = useMemo(() =>
    [...signals]
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 20),
    [signals]
  );

  const totalPnl = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl ?? '0'), 0);

  const selectedPrice = prices[selected];
  const selectedCandles = candles[selected] ?? [];
  const selectedSignal = signalMap[selected];
  const selectedTa = selectedSignal?.ai_analysis;

  const selectedLevels = selectedSignal ? [
    ...(selectedSignal.suggested_entry ? [{ price: selectedSignal.suggested_entry, color: '#58a6ff', label: 'Entry' }] : []),
    ...(selectedSignal.suggested_stop ? [{ price: selectedSignal.suggested_stop, color: '#f85149', label: 'SL', dashed: true }] : []),
    ...(selectedSignal.suggested_take_profit ? [{ price: selectedSignal.suggested_take_profit, color: '#3fb950', label: 'TP', dashed: true }] : []),
  ] : [];

  const selectedMarkers = selectedSignal && selectedCandles.length > 0 ? [
    {
      time: selectedCandles.at(-1)!.time,
      direction: selectedSignal.direction === 'buy' ? 'buy' as const : 'sell' as const,
    },
  ] : [];

  const sortedSymbols = useMemo(() =>
    [...ALL_SYMBOLS].sort((a, b) => {
      const ap = isPending(signalMap[a]) ? -1 : 0;
      const bp = isPending(signalMap[b]) ? -1 : 0;
      if (ap !== bp) return ap - bp;
      return a.localeCompare(b);
    }),
    [signalMap]
  );

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function doTrade(id: string) {
    setActing(id);
    try {
      let r = await api.paperTradeSignal(id);
      if (r.status === 'requires_manual_approval') {
        if (!confirm('Doorgaan?')) { setActing(null); return; }
        r = await api.paperTradeSignal(id, true);
      }
      toast('✅ Trade ingediend', 'success');
      const s = await api.getSignals(100);
      if (Array.isArray(s)) setSignals(s);
    } catch (e: any) {
      toast(`❌ ${e?.detail?.reasons?.join(', ') || e?.detail || 'Fout'}`, 'error');
    }
    setActing(null);
  }

  async function doReject(id: string) {
    setActing(id);
    try {
      await api.rejectSignal(id);
      toast('Afgewezen', 'info');
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
    }
    setClosing(null);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col -m-3 md:-m-4 bg-[#0d1117]" style={{ height: 'calc(100dvh - 48px)' }}>

      {/* ── Top stats bar ─────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-[#161b22] border-b border-[#30363d] flex items-center gap-4 px-4 h-14">
        <div className="flex items-center gap-2">
          <span className={cn('w-2 h-2 rounded-full', connected ? 'bg-[#3fb950] animate-pulse' : 'bg-[#f85149]')} />
          <span className="text-[11px] font-mono font-semibold text-[#7d8590]">
            {connected ? 'LIVE' : 'OFFLINE'} · {String(tick).padStart(4, '0')}
          </span>
        </div>

        <div className="h-4 border-l border-[#30363d] mx-1" />
        <RegimeBadge regime={regime} />

        {portfolio && (
          <>
            <div className="h-4 border-l border-[#30363d] mx-1 hidden sm:block" />
            <div className="hidden sm:flex items-center gap-5">
              <div>
                <p className="text-[9px] text-[#7d8590] uppercase tracking-wide">Portfolio</p>
                <p className="text-sm font-bold font-num text-white">{fmtUSD(portfolio.equity)}</p>
              </div>
              <div>
                <p className="text-[9px] text-[#7d8590] uppercase tracking-wide">Vandaag</p>
                <p className={cn('text-sm font-bold font-num',
                  portfolio.day_pnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                  {portfolio.day_pnl >= 0 ? '+' : ''}{fmtUSD(portfolio.day_pnl)}
                </p>
              </div>
              <div>
                <p className="text-[9px] text-[#7d8590] uppercase tracking-wide">Open P&L</p>
                <p className={cn('text-sm font-bold font-num',
                  totalPnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                  {totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}
                </p>
              </div>
              <div className="hidden xl:block">
                <p className="text-[9px] text-[#7d8590] uppercase tracking-wide">Cash</p>
                <p className="text-sm font-num text-[#7d8590]">{fmtUSD(portfolio.buying_power)}</p>
              </div>
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {pendingSignals.length > 0 && (
            <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1 animate-pulse">
              <span>⚡</span> {pendingSignals.length} signaal{pendingSignals.length > 1 ? 'en' : ''}
            </span>
          )}
          <span className="text-[11px] text-[#7d8590] font-num hidden sm:block">
            {new Date().toLocaleTimeString('nl-NL')}
          </span>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left watchlist ──────────────────────────────────────────────── */}
        <div className="hidden lg:flex flex-col w-[220px] shrink-0 border-r border-[#30363d] bg-[#161b22] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#30363d] shrink-0">
            <p className="text-[9px] font-bold text-[#7d8590] uppercase tracking-wide">Watchlist</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sortedSymbols.map(sym => (
              <WatchlistRow
                key={sym}
                sym={sym}
                price={prices[sym]}
                signal={signalMap[sym]}
                selected={selected === sym}
                onClick={() => { setSelected(sym); loadCandles(sym, timeframe); }}
              />
            ))}
          </div>
          {positions.length > 0 && (
            <div className="border-t border-[#30363d] px-3 py-2 bg-[#0d1117]">
              <p className="text-[9px] text-[#7d8590] uppercase tracking-wide mb-1.5">Open ({positions.length})</p>
              {positions.slice(0, 4).map((p, i) => {
                const sym = p.symbol.replace(/\/USD$/, '').replace(/USD$/, '');
                const pnl = parseFloat(p.unrealized_pl ?? '0');
                return (
                  <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                    <span className="text-white font-bold">{sym}</span>
                    <span className={cn('font-num', pnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                      {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Center chart ────────────────────────────────────────────────── */}
        <div className={cn('flex-1 flex flex-col overflow-hidden', mobileTab !== 'chart' && 'hidden md:flex')}>
          <div className="shrink-0 flex items-center gap-3 px-4 h-12 border-b border-[#30363d] bg-[#161b22]">
            <span className="font-bold text-base text-white">{selected}</span>
            <span className="text-sm text-[#7d8590] hidden sm:block">{ASSET_NAMES[selected] ?? selected}</span>
            {selectedPrice && (
              <>
                <span className="font-bold text-lg font-num text-white">${fmtP(selectedPrice.price)}</span>
                {(() => {
                  const pct = ((selectedPrice.price - selectedPrice.open) / selectedPrice.open) * 100;
                  return (
                    <span className={cn('text-sm font-semibold font-num',
                      pct >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                    </span>
                  );
                })()}
              </>
            )}
            <div className="ml-auto flex items-center gap-1">
              {(['15Min', '1Hour', '4Hour', '1Day'] as const).map(tf => (
                <button
                  key={tf}
                  onClick={() => { setTimeframe(tf); loadCandles(selected, tf, true); }}
                  className={cn('px-2 py-1 text-[10px] font-bold rounded transition-colors',
                    timeframe === tf
                      ? 'bg-[#58a6ff]/15 text-[#58a6ff]'
                      : 'text-[#7d8590] hover:text-white hover:bg-[#21262d]'
                  )}>
                  {tf === '15Min' ? '15m' : tf === '1Hour' ? '1H' : tf === '4Hour' ? '4H' : '1D'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 p-2 relative">
            {selectedCandles.length > 1 ? (
              <div className="absolute inset-2">
                <PriceChart
                  candles={selectedCandles}
                  levels={selectedLevels}
                  markers={selectedMarkers}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-[#7d8590] gap-2">
                <span className="text-3xl opacity-20">📈</span>
                <span className="text-sm">Candles laden voor {selected}…</span>
              </div>
            )}
          </div>

          <RsiBar
            rsi={selectedTa?.ta_rsi}
            trend={selectedTa?.ta_trend}
            macd={selectedTa?.ta_macd}
          />
        </div>

        {/* ── Right panel ─────────────────────────────────────────────────── */}
        <div className="hidden md:flex flex-col w-[300px] xl:w-[340px] shrink-0 border-l border-[#30363d] bg-[#161b22]">
          <div className="flex border-b border-[#30363d] shrink-0">
            {([
              { k: 'ai' as const,        label: 'AI Brein',  icon: '🧠' },
              { k: 'signals' as const,   label: 'Signalen',  icon: '⚡',  count: pendingSignals.length },
              { k: 'positions' as const, label: 'Posities',  icon: '💼',  count: positions.length },
            ]).map(({ k, label, icon, count }) => (
              <button
                key={k}
                onClick={() => setRightTab(k)}
                className={cn('flex-1 flex items-center justify-center gap-1 h-9 text-[11px] font-medium border-b-2 -mb-px transition-colors',
                  rightTab === k
                    ? 'border-[#58a6ff] text-[#58a6ff]'
                    : 'border-transparent text-[#7d8590] hover:text-white hover:bg-[#21262d]/50'
                )}>
                <span>{icon}</span>
                <span>{label}</span>
                {count !== undefined && count > 0 && (
                  <span className={cn('min-w-[14px] h-3.5 rounded-full text-[9px] font-bold flex items-center justify-center px-0.5',
                    rightTab === k ? 'bg-[#58a6ff] text-black' : 'bg-[#21262d] text-[#7d8590]'
                  )}>{count}</span>
                )}
              </button>
            ))}
          </div>

          {/* AI Brein */}
          {rightTab === 'ai' && (
            <div className="flex-1 overflow-y-auto">
              <div className="px-4 py-3 border-b border-[#21262d] bg-[#0d1117] flex items-center gap-2">
                <RegimeBadge regime={regime} />
                <span className="text-[10px] text-[#7d8590] ml-auto">
                  {connected ? (
                    <span className="flex items-center gap-1 text-[#3fb950]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-pulse inline-block" />
                      AI actief
                    </span>
                  ) : 'Verbinden…'}
                </span>
              </div>

              {recentSignalsForAI.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#7d8590] gap-3">
                  <span className="text-4xl opacity-10">🧠</span>
                  <p className="text-sm">Wachten op AI analyse…</p>
                  <p className="text-xs opacity-60">AI scant elke 10 minuten</p>
                </div>
              ) : (
                <>
                  <div className="px-3 pt-2 pb-1">
                    <p className="text-[9px] font-bold text-[#7d8590]/60 uppercase tracking-widest">Recente analyses</p>
                  </div>
                  {recentSignalsForAI.map(sig => (
                    <AiBrainEntry key={sig.id} signal={sig} />
                  ))}
                </>
              )}

              {feed.length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-1 border-t border-[#21262d] mt-2">
                    <p className="text-[9px] font-bold text-[#7d8590]/60 uppercase tracking-widest">Acties log</p>
                  </div>
                  {feed.slice(0, 20).map((ev, i) => (
                    <EventFeedItem
                      key={`${ev.created_at}::${ev.action}::${i}`}
                      ev={ev}
                      fresh={freshKeys.has(`${ev.created_at}::${ev.action}`)}
                    />
                  ))}
                </>
              )}
            </div>
          )}

          {/* Signalen */}
          {rightTab === 'signals' && (
            <div className="flex-1 overflow-y-auto">
              {pendingSignals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#7d8590] gap-3">
                  <span className="text-3xl opacity-20">⚡</span>
                  <p className="text-sm">Geen actieve signalen</p>
                  <p className="text-xs opacity-60">Volgende check: ~10 min</p>
                </div>
              ) : pendingSignals.map(sig => (
                <SignalDetailCard
                  key={sig.id}
                  signal={sig}
                  onTrade={doTrade}
                  onReject={doReject}
                  acting={acting}
                  onSelectChart={(sym) => { setSelected(sym); loadCandles(sym, timeframe); }}
                />
              ))}
            </div>
          )}

          {/* Posities */}
          {rightTab === 'positions' && (
            <div className="flex-1 overflow-y-auto">
              {positions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#7d8590] gap-3">
                  <span className="text-3xl opacity-20">💼</span>
                  <p className="text-sm">Geen open posities</p>
                </div>
              ) : (
                <>
                  <div className="px-4 py-3 border-b border-[#21262d] bg-[#0d1117]">
                    <p className="text-[10px] text-[#7d8590] uppercase tracking-wide">Totaal ongerealiseerd</p>
                    <p className={cn('text-xl font-bold font-num mt-0.5',
                      totalPnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                      {totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}
                    </p>
                  </div>
                  {positions.map((p, i) => (
                    <PositionRow key={i} pos={p} signalMap={signalMap} onClose={doClose} closing={closing} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile bottom nav ─────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 md:hidden bg-[#161b22] border-t border-[#30363d] flex bottom-nav z-50">
        {([
          { k: 'chart' as const,     icon: '📈', label: 'Chart' },
          { k: 'signals' as const,   icon: '⚡', label: pendingSignals.length ? `Signals (${pendingSignals.length})` : 'Signals' },
          { k: 'ai' as const,        icon: '🧠', label: 'AI Brein' },
          { k: 'positions' as const, icon: '💼', label: positions.length ? `Posities (${positions.length})` : 'Posities' },
        ]).map(({ k, icon, label }) => (
          <button
            key={k}
            onClick={() => setMobileTab(k)}
            className={cn('flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[9px] font-medium transition-colors',
              mobileTab === k ? 'text-[#58a6ff]' : 'text-[#7d8590]'
            )}>
            <span className="text-base">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* ── Mobile overlay panels ──────────────────────────────────────────── */}
      {mobileTab === 'signals' && (
        <div className="fixed inset-0 top-[112px] bottom-[56px] md:hidden bg-[#0d1117] z-40 overflow-y-auto">
          {pendingSignals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#7d8590] gap-3">
              <span className="text-3xl opacity-20">⚡</span>
              <p className="text-sm">Geen actieve signalen</p>
            </div>
          ) : pendingSignals.map(sig => (
            <SignalDetailCard
              key={sig.id}
              signal={sig}
              onTrade={doTrade}
              onReject={doReject}
              acting={acting}
              onSelectChart={(sym) => { setSelected(sym); setMobileTab('chart'); loadCandles(sym, timeframe); }}
            />
          ))}
        </div>
      )}

      {mobileTab === 'ai' && (
        <div className="fixed inset-0 top-[112px] bottom-[56px] md:hidden bg-[#0d1117] z-40 overflow-y-auto">
          <div className="px-4 py-3 border-b border-[#21262d] bg-[#0d1117] flex items-center gap-2">
            <RegimeBadge regime={regime} />
            <span className="text-[10px] text-[#7d8590] ml-auto">
              {connected ? (
                <span className="flex items-center gap-1 text-[#3fb950]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-pulse inline-block" />
                  AI actief
                </span>
              ) : 'Verbinden…'}
            </span>
          </div>
          {recentSignalsForAI.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#7d8590] gap-3">
              <span className="text-4xl opacity-10">🧠</span>
              <p className="text-sm">Wachten op AI analyse…</p>
            </div>
          ) : (
            <>
              <div className="px-3 pt-2 pb-1">
                <p className="text-[9px] font-bold text-[#7d8590]/60 uppercase tracking-widest">Recente analyses</p>
              </div>
              {recentSignalsForAI.map(sig => (
                <AiBrainEntry key={sig.id} signal={sig} />
              ))}
            </>
          )}
          {feed.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1 border-t border-[#21262d] mt-2">
                <p className="text-[9px] font-bold text-[#7d8590]/60 uppercase tracking-widest">Acties log</p>
              </div>
              {feed.slice(0, 15).map((ev, i) => (
                <EventFeedItem
                  key={`${ev.created_at}::${ev.action}::${i}`}
                  ev={ev}
                  fresh={freshKeys.has(`${ev.created_at}::${ev.action}`)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {mobileTab === 'positions' && (
        <div className="fixed inset-0 top-[112px] bottom-[56px] md:hidden bg-[#0d1117] z-40 overflow-y-auto">
          {positions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#7d8590] gap-3">
              <span className="text-3xl opacity-20">💼</span>
              <p className="text-sm">Geen open posities</p>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-[#21262d] bg-[#0d1117]">
                <p className="text-[10px] text-[#7d8590] uppercase tracking-wide">Totaal ongerealiseerd</p>
                <p className={cn('text-xl font-bold font-num mt-0.5',
                  totalPnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                  {totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}
                </p>
              </div>
              {positions.map((p, i) => (
                <PositionRow key={i} pos={p} signalMap={signalMap} onClose={doClose} closing={closing} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
