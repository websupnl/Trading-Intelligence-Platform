'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn, fmtUSD, cleanSym } from '@/lib/utils';
import { useSSE } from '@/hooks/useSSE';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { useToast } from '@/contexts/toast';
import { PriceChart } from '@/components/charts/PriceChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { X, TrendingUp, TrendingDown, Zap, Activity, Wallet, Brain, ChevronDown, ChevronUp, BarChart2 } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface PriceData { symbol: string; price: number; open: number; high: number; low: number; volume: number; }
interface AiAnalysis { bull_score?: number; bear_score?: number; ta_rsi?: number; ta_trend?: string; ta_macd?: string; news_count?: number; key_risks?: string; }
interface Signal { id: string; asset: string; direction: string; confidence: number; reason?: string; status?: string; timeframe?: string; suggested_entry?: number; suggested_stop?: number; suggested_take_profit?: number; risk_reward?: number; ai_analysis?: AiAnalysis; created_at?: string; }
interface Event { action: string; actor: string; message?: string; details?: Record<string, unknown>; created_at: string; }
interface Portfolio { equity: number; cash: number; buying_power: number; day_pnl: number; }
interface Position { symbol: string; qty: string; side: string; avg_entry_price: string; unrealized_pl: string; unrealized_plpc: string; }

// ── Helpers ────────────────────────────────────────────────────────────────────

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
function eventIcon(a: string) {
  if (a === 'signal_generated') return { i: '⚖️', c: 'text-amber-400' };
  if (a === 'auto_trade_executed') return { i: '✅', c: 'text-green-400' };
  if (a === 'position_auto_closed') return { i: '📤', c: 'text-blue-400' };
  if (a === 'trailing_stop_updated') return { i: '📈', c: 'text-green-400/70' };
  if (a === 'ai_provider_paused') return { i: '⏸️', c: 'text-amber-400' };
  if (a.includes('circuit')) return { i: '🔴', c: 'text-red-400' };
  return { i: '🔄', c: 'text-muted-foreground' };
}

const ALL = ['BTC','ETH','SOL','DOGE','AVAX','LINK','LTC','AAVE','BCH','UNI','ALGO'];
const NAMES: Record<string,string> = { BTC:'Bitcoin',ETH:'Ethereum',SOL:'Solana',DOGE:'Dogecoin',AVAX:'Avalanche',LINK:'Chainlink',LTC:'Litecoin',AAVE:'Aave',BCH:'Bitcoin Cash',UNI:'Uniswap',ALGO:'Algorand' };

// ── Asset Card ─────────────────────────────────────────────────────────────────

function AssetCard({ sym, price, candles, signal, selected, onClick }: {
  sym: string; price?: PriceData; candles: Candle[];
  signal?: Signal; selected: boolean; onClick: () => void;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const up = pct !== null && pct >= 0;
  const pending = isPending(signal);
  const isBuy = signal?.direction === 'buy';
  const sparkData = candles.slice(-20).map(c => c.close);

  return (
    <button onClick={onClick} className={cn(
      'w-full text-left rounded-2xl border bg-[#161b22] p-4 transition-all hover:shadow-lg hover:-translate-y-px active:translate-y-0',
      selected ? 'border-[#58a6ff] ring-2 ring-[#58a6ff]/20 shadow-lg'
        : pending ? (isBuy ? 'border-[#3fb950]/50' : 'border-[#f85149]/50')
          : 'border-[#30363d] hover:border-[#58a6ff]/40',
    )}>
      {pending && <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl', isBuy ? 'bg-[#3fb950]' : 'bg-[#f85149]')} style={{ position: 'relative', marginBottom: -2 }} />}

      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-bold text-sm text-white">{sym}</p>
          <p className="text-[10px] text-[#7d8590] mt-0.5">{NAMES[sym] ?? sym}</p>
        </div>
        {pending && (
          <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full', isBuy ? 'bg-[#3fb950]/15 text-[#3fb950]' : 'bg-[#f85149]/15 text-[#f85149]')}>
            {isBuy ? '▲ BUY' : '▼ SELL'}
          </span>
        )}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <p className={cn('text-2xl font-bold font-num leading-none', price ? 'text-white' : 'text-[#7d8590]/30')}>
            {price ? `$${fmt(price.price)}` : '—'}
          </p>
          {pct !== null ? (
            <p className={cn('text-xs font-semibold mt-1 flex items-center gap-0.5', up ? 'text-[#3fb950]' : 'text-[#f85149]')}>
              {up ? <TrendingUp size={10}/> : <TrendingDown size={10}/>} {up ? '+' : ''}{pct.toFixed(2)}%
            </p>
          ) : <p className="text-xs text-[#7d8590]/40 mt-1">—</p>}
        </div>
        <div className="w-20">
          <Sparkline data={sparkData} height={36} />
        </div>
      </div>

      {pending && signal && (
        <div className="mt-3 pt-2.5 border-t border-[#21262d]">
          <div className="flex justify-between text-[10px] text-[#7d8590] mb-1">
            <span>Confidence</span>
            <span className={cn('font-bold', isBuy ? 'text-[#3fb950]' : 'text-[#f85149]')}>{(signal.confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1 bg-[#21262d] rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full', isBuy ? 'bg-[#3fb950]' : 'bg-[#f85149]')} style={{ width: `${(signal.confidence * 100).toFixed(0)}%` }} />
          </div>
        </div>
      )}
    </button>
  );
}

// ── Chart Panel ────────────────────────────────────────────────────────────────

function ChartPanel({ sym, price, candles, signal, onClose, onTrade, onReject, acting }: {
  sym: string; price?: PriceData; candles: Candle[]; signal?: Signal;
  onClose: () => void; onTrade: (id: string) => void; onReject: (id: string) => void; acting: string | null;
}) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const up = pct !== null && pct >= 0;
  const isBuy = signal?.direction === 'buy';
  const canAct = isPending(signal);
  const ai = signal?.ai_analysis;

  const levels = signal ? [
    ...(signal.suggested_entry ? [{ price: signal.suggested_entry, color: '#58a6ff', label: 'Entry' }] : []),
    ...(signal.suggested_stop ? [{ price: signal.suggested_stop, color: '#f85149', label: 'SL', dashed: true }] : []),
    ...(signal.suggested_take_profit ? [{ price: signal.suggested_take_profit, color: '#3fb950', label: 'TP', dashed: true }] : []),
  ] : [];

  const markers = signal && candles.length ? [{ time: candles.at(-1)!.time, direction: isBuy ? 'buy' as const : 'sell' as const }] : [];

  return (
    <div className="absolute inset-0 bg-[#0d1117] z-20 flex flex-col">
      <div className="flex items-center gap-3 px-4 h-12 border-b border-[#30363d] shrink-0 bg-[#161b22]">
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#21262d] text-[#7d8590] hover:text-white transition-colors">
          <X size={14} />
        </button>
        <span className="font-bold text-white">{sym}</span>
        <span className="text-sm text-[#7d8590]">{NAMES[sym]}</span>
        {price && <span className="font-bold text-lg font-num text-white ml-auto">${fmt(price.price)}</span>}
        {pct !== null && <span className={cn('text-sm font-semibold font-num', up ? 'text-[#3fb950]' : 'text-[#f85149]')}>{up ? '+' : ''}{pct.toFixed(2)}%</span>}
      </div>

      <div className="flex-1 min-h-0 p-2 relative">
        {candles.length > 1
          ? <div className="absolute inset-2"><PriceChart candles={candles} levels={levels} markers={markers} /></div>
          : <div className="flex items-center justify-center h-full text-[#7d8590]"><BarChart2 size={28} className="mr-2 opacity-30" />Laden…</div>
        }
      </div>

      {signal && (
        <div className="shrink-0 border-t border-[#30363d] bg-[#161b22] p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', isBuy ? 'bg-[#3fb950]/15 text-[#3fb950]' : 'bg-[#f85149]/15 text-[#f85149]')}>
                {isBuy ? '▲ BUY' : '▼ SELL'} · {(signal.confidence * 100).toFixed(0)}%
              </span>
              {signal.risk_reward && <span className="text-xs text-[#7d8590] font-num">R/R {signal.risk_reward.toFixed(2)}</span>}
              {signal.timeframe && <span className="text-xs text-[#7d8590] capitalize">{signal.timeframe}</span>}
            </div>
            {canAct && (
              <div className="flex gap-2">
                <button onClick={() => onTrade(signal.id)} disabled={acting === signal.id}
                  className={cn('h-8 px-4 text-xs font-bold rounded-lg transition-colors disabled:opacity-50', isBuy ? 'bg-[#3fb950] text-black hover:bg-[#3fb950]/90' : 'bg-[#f85149] text-white hover:bg-[#f85149]/90')}>
                  {acting === signal.id ? '…' : '📄 Paper trade'}
                </button>
                <button onClick={() => onReject(signal.id)} disabled={acting === signal.id}
                  className="h-8 px-3 text-xs rounded-lg border border-[#30363d] text-[#7d8590] hover:text-white hover:bg-[#21262d] transition-colors disabled:opacity-50">
                  Afwijzen
                </button>
              </div>
            )}
          </div>

          {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
            <div className="grid grid-cols-3 gap-2">
              {signal.suggested_entry && <div className="bg-[#21262d] rounded-xl px-3 py-2"><p className="text-[9px] text-[#7d8590] uppercase">Entry</p><p className="text-sm font-bold font-num text-white">${fmt(signal.suggested_entry)}</p></div>}
              {signal.suggested_stop && <div className="bg-[#f85149]/5 border border-[#f85149]/10 rounded-xl px-3 py-2"><p className="text-[9px] text-[#f85149]/70 uppercase">Stop</p><p className="text-sm font-bold font-num text-[#f85149]">${fmt(signal.suggested_stop)}</p></div>}
              {signal.suggested_take_profit && <div className="bg-[#3fb950]/5 border border-[#3fb950]/10 rounded-xl px-3 py-2"><p className="text-[9px] text-[#3fb950]/70 uppercase">Target</p><p className="text-sm font-bold font-num text-[#3fb950]">${fmt(signal.suggested_take_profit)}</p></div>}
            </div>
          )}

          {ai?.bull_score !== undefined && ai.bear_score !== undefined && (
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-[#3fb950] w-12 font-num shrink-0">🐂 {(ai.bull_score * 100).toFixed(0)}%</span>
              <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-[#21262d]">
                <div className="bg-[#3fb950]" style={{ width: `${(ai.bull_score / ((ai.bull_score + ai.bear_score) || 1) * 100).toFixed(0)}%` }} />
                <div className="bg-[#f85149] flex-1" />
              </div>
              <span className="text-[10px] text-[#f85149] w-12 text-right font-num shrink-0">🐻 {(ai.bear_score * 100).toFixed(0)}%</span>
            </div>
          )}

          {signal.reason && <p className="text-xs text-[#7d8590] leading-relaxed border-t border-[#30363d] pt-2 line-clamp-3">{signal.reason}</p>}
        </div>
      )}
    </div>
  );
}

// ── Position Row ───────────────────────────────────────────────────────────────

function PositionRow({ pos, signal, onClose, closing }: {
  pos: Position; signal?: Signal; onClose: (s: string) => void; closing: string | null;
}) {
  const sym = cleanSym(pos.symbol);
  const pnl = parseFloat(pos.unrealized_pl ?? '0');
  const pct = parseFloat(pos.unrealized_plpc ?? '0') * 100;
  const entry = parseFloat(pos.avg_entry_price ?? '0');
  const qty = parseFloat(pos.qty ?? '0');
  const sl = signal?.suggested_stop;
  const tp = signal?.suggested_take_profit;
  const current = entry * (1 + pct / 100);
  const progress = tp && entry && tp !== entry ? Math.max(0, Math.min(100, ((current - entry) / (tp - entry)) * 100)) : null;

  return (
    <div className="px-4 py-3 border-b border-[#21262d] last:border-0 hover:bg-[#21262d]/40 transition-colors">
      <div className="flex items-center gap-3">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0', pnl >= 0 ? 'bg-[#3fb950]/10 text-[#3fb950]' : 'bg-[#f85149]/10 text-[#f85149]')}>
          {sym.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm text-white">{sym}</span>
            <span className="text-[9px] font-bold bg-[#58a6ff]/10 text-[#58a6ff] px-1.5 py-0.5 rounded-full">LONG</span>
          </div>
          <p className="text-[10px] text-[#7d8590] font-num mt-0.5">{qty < 1 ? qty.toFixed(5) : qty.toFixed(3)} @ ${fmt(entry)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={cn('font-bold text-base font-num', pnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>{pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}</p>
          <p className={cn('text-[10px] font-num', pnl >= 0 ? 'text-[#3fb950]/70' : 'text-[#f85149]/70')}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</p>
        </div>
        <button onClick={() => onClose(sym)} disabled={closing === sym}
          className="h-7 px-2.5 text-[11px] rounded-lg border border-[#30363d] text-[#7d8590] hover:text-[#f85149] hover:border-[#f85149]/40 transition-colors disabled:opacity-40 shrink-0">
          {closing === sym ? '…' : 'Sluit'}
        </button>
      </div>

      {(sl || tp) && (
        <div className="flex gap-3 mt-1.5 text-[10px] font-num text-[#7d8590] pl-12">
          {sl && <span>SL <span className="text-[#f85149]">${fmt(sl)}</span></span>}
          {tp && <span>TP <span className="text-[#3fb950]">${fmt(tp)}</span></span>}
          {signal?.risk_reward && <span className="ml-auto">R/R {signal.risk_reward.toFixed(2)}</span>}
        </div>
      )}

      {progress !== null && tp && (
        <div className="mt-2 pl-12 space-y-1">
          <div className="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full', pnl >= 0 ? 'bg-[#3fb950]' : 'bg-[#f85149]')} style={{ width: `${Math.max(2, progress)}%` }} />
          </div>
          <div className="flex justify-between text-[9px] font-num text-[#7d8590]">
            <span>${fmt(entry)}</span>
            <span>{progress.toFixed(0)}% → target</span>
            <span className="text-[#3fb950]">${fmt(tp)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Signal Card ────────────────────────────────────────────────────────────────

function SignalCard({ signal, onTrade, onReject, acting, onClick }: {
  signal: Signal; onTrade: (id: string) => void; onReject: (id: string) => void; acting: string | null; onClick: () => void;
}) {
  const isBuy = signal.direction === 'buy';
  const canAct = isPending(signal);

  return (
    <div onClick={onClick} className={cn('mx-3 my-2 rounded-2xl border p-3 cursor-pointer hover:shadow-md transition-all', isBuy ? 'border-[#3fb950]/30 bg-[#3fb950]/[0.04]' : 'border-[#f85149]/30 bg-[#f85149]/[0.04]')}>
      <div className="flex items-center justify-between mb-2">
        <span className={cn('text-sm font-bold px-2 py-0.5 rounded-full', isBuy ? 'bg-[#3fb950]/15 text-[#3fb950]' : 'bg-[#f85149]/15 text-[#f85149]')}>
          {isBuy ? '▲' : '▼'} {signal.asset}
        </span>
        <div className="flex items-center gap-2 text-xs text-[#7d8590]">
          <span className="font-num">{(signal.confidence * 100).toFixed(0)}%</span>
          {signal.created_at && <span>{relTime(signal.created_at)}</span>}
        </div>
      </div>

      <div className="h-1.5 bg-[#21262d] rounded-full overflow-hidden mb-2">
        <div className={cn('h-full rounded-full', isBuy ? 'bg-[#3fb950]' : 'bg-[#f85149]')} style={{ width: `${(signal.confidence * 100).toFixed(0)}%` }} />
      </div>

      {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
        <div className="flex gap-3 text-[10px] font-num text-[#7d8590] mb-2">
          {signal.suggested_entry && <span>E <span className="text-white">${fmt(signal.suggested_entry)}</span></span>}
          {signal.suggested_stop && <span>SL <span className="text-[#f85149]">${fmt(signal.suggested_stop)}</span></span>}
          {signal.suggested_take_profit && <span>TP <span className="text-[#3fb950]">${fmt(signal.suggested_take_profit)}</span></span>}
          {signal.risk_reward && <span className="ml-auto">R/R <span className="text-white">{signal.risk_reward.toFixed(2)}</span></span>}
        </div>
      )}

      {canAct && (
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <button onClick={() => onTrade(signal.id)} disabled={acting === signal.id}
            className={cn('flex-1 h-8 text-xs font-bold rounded-xl transition-colors disabled:opacity-50', isBuy ? 'bg-[#3fb950] text-black hover:bg-[#3fb950]/90' : 'bg-[#f85149] text-white hover:bg-[#f85149]/90')}>
            {acting === signal.id ? '…' : isBuy ? '📄 Koop' : '📄 Verkoop'}
          </button>
          <button onClick={() => onReject(signal.id)} disabled={acting === signal.id}
            className="h-8 px-3 text-[11px] rounded-xl border border-[#30363d] text-[#7d8590] hover:text-white hover:bg-[#21262d] transition-colors disabled:opacity-50">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ── Feed Item ──────────────────────────────────────────────────────────────────

function FeedItem({ ev, fresh }: { ev: Event; fresh: boolean }) {
  const [open, setOpen] = useState(false);
  const { i, c } = eventIcon(ev.action);
  const d = (ev.details ?? {}) as Record<string, unknown>;
  const conf = d.confidence as number | undefined;
  const bull = d.bull_score as number | undefined;
  const bear = d.bear_score as number | undefined;
  const hasDetail = conf !== undefined || (bull !== undefined && bear !== undefined);
  const text = (ev.message || '').slice(0, 120) || ev.action.replace(/_/g, ' ');
  const time = new Date(ev.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className={cn('border-b border-[#21262d] last:border-0 transition-colors', fresh && 'bg-amber-500/5', hasDetail && 'cursor-pointer hover:bg-[#21262d]/50')} onClick={() => hasDetail && setOpen(o => !o)}>
      <div className="flex items-start gap-2.5 px-4 py-2.5">
        <span className="text-sm shrink-0 mt-px">{i}</span>
        <div className="flex-1 min-w-0">
          <p className={cn('text-xs leading-snug', c)}>{text}</p>
          <span className="text-[10px] text-[#7d8590] font-num">{time}</span>
        </div>
        {hasDetail && <span className="text-[#7d8590]/40 shrink-0 mt-1">{open ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}</span>}
      </div>
      {open && hasDetail && (
        <div className="px-4 pb-3 space-y-2">
          {conf !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#7d8590] w-16 shrink-0">Confidence</span>
              <div className="flex-1 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                <div className="h-full bg-amber-400" style={{ width: `${(conf * 100).toFixed(0)}%` }} />
              </div>
              <span className="text-[10px] text-amber-400 font-num w-8 text-right">{(conf * 100).toFixed(0)}%</span>
            </div>
          )}
          {bull !== undefined && bear !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#3fb950] w-12 font-num shrink-0">🐂{(bull * 100).toFixed(0)}%</span>
              <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-[#21262d]">
                <div className="bg-[#3fb950]" style={{ width: `${(bull / ((bull + bear) || 1) * 100).toFixed(0)}%` }} />
                <div className="bg-[#f85149] flex-1" />
              </div>
              <span className="text-[10px] text-[#f85149] w-12 text-right font-num shrink-0">🐻{(bear * 100).toFixed(0)}%</span>
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
  const [candles, setCandles] = useState<Record<string, Candle[]>>({});
  const [signals, setSignals] = useState<Signal[]>([]);
  const [feed, setFeed] = useState<Event[]>([]);
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set());
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [tab, setTab] = useState<'signals'|'positions'|'feed'>('signals');
  const [filter, setFilter] = useState<'all'|'signals'>('all');
  const [now, setNow] = useState(() => new Date());
  const { toast } = useToast();

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

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
  const onNewSignal = useCallback((d: Record<string, unknown>) => { const s = d.signal as Signal; if (s) { setSignals(prev => prev.find(x => x.id === s.id) ? prev : [s, ...prev]); setTab('signals'); } }, []);
  const onActivity = useCallback((d: Record<string, unknown>) => {
    const evs = d.events as Event[];
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
  const onPortfolio = useCallback((d: Record<string, unknown>) => setPortfolio(d as unknown as Portfolio), []);
  const onHeartbeat = useCallback((d: Record<string, unknown>) => setTick(d.tick as number), []);

  useSSE(`/api/stream/session?symbols=${ALL.join(',')}`,
    { price: onPrice, chart_data: onChartData, signals: onSignals, new_signal: onNewSignal, activity_batch: onActivity, portfolio: onPortfolio, heartbeat: onHeartbeat },
    { onConnected: () => setConnected(true), onDisconnected: () => setConnected(false) }
  );

  const signalMap = useMemo(() => {
    const m: Record<string, Signal> = {};
    [...signals].reverse().forEach(s => { m[s.asset] = s; });
    signals.filter(s => isPending(s)).forEach(s => { m[s.asset] = s; });
    return m;
  }, [signals]);

  const pending = useMemo(() => signals.filter(isPending), [signals]);
  const totalPnl = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl ?? '0'), 0);

  const gridSyms = useMemo(() => {
    const extras = signals.map(s => s.asset).filter(a => !ALL.includes(a)).filter((v, i, arr) => arr.indexOf(v) === i);
    const base = filter === 'signals' ? [...ALL, ...extras].filter(s => !!signalMap[s]) : [...ALL, ...extras];
    return base.sort((a, b) => (isPending(signalMap[a]) ? -1 : 0) - (isPending(signalMap[b]) ? -1 : 0));
  }, [signals, signalMap, filter]);

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

  function sigFor(sym: string) { return signals.find(s => s.asset === sym && s.status === 'paper_traded'); }

  return (
    <div className="flex flex-col -m-3 md:-m-4 bg-[#0d1117]" style={{ height: 'calc(100dvh - 48px)' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-[#161b22] border-b border-[#30363d]">
        <div className="flex items-center gap-2 px-4 h-8 border-b border-[#30363d]/50">
          <div className={cn('flex items-center gap-1.5 text-[11px] font-semibold', connected ? 'text-[#3fb950]' : 'text-[#7d8590]')}>
            <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-[#3fb950] animate-pulse' : 'bg-[#7d8590]')} />
            {connected ? `LIVE · ${tick}` : 'VERBINDEN…'}
          </div>
          <span className="text-[11px] text-[#7d8590] font-num ml-1">{now.toLocaleTimeString('nl-NL')}</span>
          {pending.length > 0 && (
            <span className="ml-auto text-[11px] text-amber-400 font-semibold flex items-center gap-1">
              <Zap size={10} className="animate-pulse" /> {pending.length} signaal{pending.length > 1 ? 'en' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-5 px-4 h-11">
          {portfolio ? (
            <>
              <div className="shrink-0"><p className="text-[9px] text-[#7d8590] uppercase tracking-wide">Portfolio</p><p className="text-sm font-bold font-num text-white">{fmtUSD(portfolio.equity)}</p></div>
              <div className="shrink-0 hidden sm:block"><p className="text-[9px] text-[#7d8590] uppercase tracking-wide">Beschikbaar</p><p className="text-sm font-semibold font-num text-white">{fmtUSD(portfolio.buying_power)}</p></div>
              <div className="shrink-0"><p className="text-[9px] text-[#7d8590] uppercase tracking-wide">Vandaag</p><p className={cn('text-sm font-bold font-num', portfolio.day_pnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>{portfolio.day_pnl >= 0 ? '+' : ''}{fmtUSD(portfolio.day_pnl)}</p></div>
              <div className="shrink-0"><p className="text-[9px] text-[#7d8590] uppercase tracking-wide">Open P&L</p><p className={cn('text-sm font-bold font-num', totalPnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>{totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}</p></div>
            </>
          ) : <span className="text-sm text-[#7d8590]">Laden…</span>}
          <span className="ml-auto text-[11px] text-amber-400 flex items-center gap-1 shrink-0"><Zap size={11} /> AI actief</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: grid + chart ───────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-1 px-4 h-9 border-b border-[#30363d] shrink-0 bg-[#161b22]">
            {(['all','signals'] as const).map(k => (
              <button key={k} onClick={() => setFilter(k)}
                className={cn('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors', filter === k ? 'bg-[#58a6ff] text-black font-bold' : 'text-[#7d8590] hover:text-white hover:bg-[#21262d]')}>
                {k === 'all' ? `Alle (${gridSyms.length})` : `Signalen (${pending.length})`}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-hidden relative">
            <div className={cn('h-full overflow-y-auto p-3', selected && 'invisible')}>
              {filter === 'signals' && !gridSyms.length ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-[#7d8590]">
                  <span className="text-4xl opacity-20">⚖️</span>
                  <p className="text-sm">Geen actieve signalen</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {gridSyms.map(sym => (
                    <AssetCard key={sym} sym={sym} price={prices[sym]} candles={candles[sym] ?? []}
                      signal={signalMap[sym]} selected={selected === sym}
                      onClick={() => { const n = selected === sym ? null : sym; setSelected(n); if (n) loadCandles(n); }} />
                  ))}
                </div>
              )}
            </div>

            {selected && (
              <div className="absolute inset-0">
                <ChartPanel sym={selected} price={prices[selected]} candles={candles[selected] ?? []}
                  signal={signalMap[selected]} onClose={() => setSelected(null)}
                  onTrade={doTrade} onReject={doReject} acting={acting} />
              </div>
            )}
          </div>
        </div>

        {/* ── Right sidebar ───────────────────────────────────────────────── */}
        <div className="w-72 xl:w-80 border-l border-[#30363d] flex flex-col shrink-0 bg-[#161b22]">
          <div className="flex border-b border-[#30363d] shrink-0">
            {([
              { k: 'signals', label: 'Signalen', icon: <Zap size={11}/>, n: pending.length },
              { k: 'positions', label: 'Posities', icon: <Wallet size={11}/>, n: positions.length },
              { k: 'feed', label: 'AI Feed', icon: <Activity size={11}/> },
            ] as const).map(({ k, label, icon, n }) => (
              <button key={k} onClick={() => setTab(k)}
                className={cn('flex-1 flex items-center justify-center gap-1 h-9 text-[11px] font-medium border-b-2 -mb-px transition-colors',
                  tab === k ? 'border-[#58a6ff] text-[#58a6ff]' : 'border-transparent text-[#7d8590] hover:text-white hover:bg-[#21262d]/50')}>
                {icon}{label}
                {n !== undefined && n > 0 && (
                  <span className={cn('min-w-[14px] h-3.5 rounded-full text-[9px] font-bold flex items-center justify-center px-0.5', tab === k ? 'bg-[#58a6ff] text-black' : 'bg-[#21262d] text-[#7d8590]')}>{n}</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'signals' && (
            <div className="flex-1 overflow-y-auto">
              {!pending.length ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-[#7d8590] py-16">
                  <span className="text-3xl opacity-20">⚖️</span>
                  <p className="text-sm">Geen actieve signalen</p>
                  <p className="text-xs opacity-60">Volgende check: ~10 min</p>
                </div>
              ) : pending.map(s => (
                <SignalCard key={s.id} signal={s} onTrade={doTrade} onReject={doReject} acting={acting} onClick={() => { setSelected(s.asset); loadCandles(s.asset); }} />
              ))}
            </div>
          )}

          {tab === 'positions' && (
            <div className="flex-1 overflow-y-auto">
              {!positions.length ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-[#7d8590] py-16">
                  <span className="text-3xl opacity-20">📊</span>
                  <p className="text-sm">Geen open posities</p>
                </div>
              ) : (
                <>
                  <div className="px-4 py-3 border-b border-[#21262d] bg-[#0d1117]">
                    <p className="text-[10px] text-[#7d8590] uppercase tracking-wide">Totaal ongerealiseerd</p>
                    <p className={cn('text-xl font-bold font-num mt-0.5', totalPnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>{totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}</p>
                  </div>
                  {positions.map((p, i) => <PositionRow key={i} pos={p} signal={sigFor(cleanSym(p.symbol))} onClose={doClose} closing={closing} />)}
                </>
              )}
            </div>
          )}

          {tab === 'feed' && (
            <div className="flex-1 overflow-y-auto">
              {!feed.length ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-[#7d8590] py-16">
                  <Brain size={28} className="opacity-20" />
                  <p className="text-sm">Wachten op AI activiteit…</p>
                </div>
              ) : feed.map((ev, i) => (
                <FeedItem key={`${ev.created_at}::${ev.action}::${i}`} ev={ev} fresh={freshKeys.has(`${ev.created_at}::${ev.action}`)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
