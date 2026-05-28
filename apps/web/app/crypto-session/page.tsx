'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useSSE } from '@/hooks/useSSE';
import { useToast } from '@/contexts/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  ArrowDownRight, ArrowUpRight, Bot, CheckCircle, ChevronDown, ChevronUp,
  Circle, Clock, Coins, Play, Settings, ShieldCheck, Square, TrendingUp,
  XCircle, Zap,
} from 'lucide-react';

// ── types ─────────────────────────────────────────────────────────────────────

interface PriceData { symbol: string; price: number; open: number; high: number; low: number; volume: number; }
interface SignalData {
  id: string; asset: string; direction: string; confidence: number;
  reason?: string; status?: string; suggested_entry?: number;
  suggested_stop?: number; suggested_take_profit?: number;
  risk_reward?: number; ai_analysis?: Record<string, unknown>;
  created_at?: string;
}
interface ActivityEvent { action: string; actor: string; message?: string; status?: string; details?: Record<string, unknown>; created_at?: string; }
interface Portfolio { equity: number; cash: number; buying_power: number; day_pnl: number; }

// ── constants ─────────────────────────────────────────────────────────────────

const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'AVAX', 'DOGE', 'LINK', 'LTC', 'AAVE', 'UNI', 'ALGO', 'BCH'];
const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', AVAX: 'Avalanche',
  DOGE: 'Dogecoin', LINK: 'Chainlink', LTC: 'Litecoin', AAVE: 'Aave',
  UNI: 'Uniswap', ALGO: 'Algorand', BCH: 'Bitcoin Cash',
};
const SYMBOLS_PARAM = CRYPTO_SYMBOLS.join(',');

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  if (n >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(5);
}
function fmtTime(iso?: string | null) {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function minutesLeft(exp?: string | null) {
  if (!exp) return 0;
  return Math.max(0, Math.ceil((new Date(exp).getTime() - Date.now()) / 60_000));
}

const ACTION_META: Record<string, { icon: string; label: string; color: string }> = {
  auto_trade_executed:            { icon: '✓', label: 'Trade uitgevoerd', color: 'text-green-500' },
  auto_trade_risk_rejected:       { icon: '✕', label: 'Risk afgewezen', color: 'text-red-400' },
  auto_trade_broker_error:        { icon: '!', label: 'Broker fout', color: 'text-red-400' },
  auto_trade_manual_required:     { icon: '⚠', label: 'Handm. vereist', color: 'text-amber-500' },
  signal_generated:               { icon: '◆', label: 'Signaal', color: 'text-amber-400' },
  skipped_existing:               { icon: '→', label: 'Skip: positie', color: 'text-muted-foreground' },
  skipped_no_position:            { icon: '→', label: 'Skip: geen pos', color: 'text-muted-foreground' },
  crypto_session_started:         { icon: '▶', label: 'Sessie start', color: 'text-green-500' },
  crypto_session_stopped:         { icon: '■', label: 'Sessie stop', color: 'text-muted-foreground' },
  crypto_session_cycle_completed: { icon: '↺', label: 'Cycle klaar', color: 'text-blue-400' },
  position_auto_closed:           { icon: '↑', label: 'Positie gesloten', color: 'text-blue-400' },
  circuit_breaker_triggered:      { icon: '⛔', label: 'Circuit breaker', color: 'text-red-500' },
  settings_updated:               { icon: '⚙', label: 'Instelling', color: 'text-muted-foreground' },
  analyze_news:                   { icon: '📰', label: 'Nieuws analyse', color: 'text-purple-400' },
  rumour_detected:                { icon: '💬', label: 'Gerucht', color: 'text-orange-400' },
};

// ── PriceTile ─────────────────────────────────────────────────────────────────

function PriceTile({ symbol, price, flash }: { symbol: string; price?: PriceData; flash: boolean }) {
  const pct = price ? ((price.price - price.open) / price.open) * 100 : null;
  const isUp = pct !== null && pct >= 0;
  return (
    <div className={cn(
      'rounded-lg border bg-card px-2.5 py-2 transition-all duration-300',
      flash ? 'border-amber-400/50 bg-amber-400/5' : 'border-border',
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-bold text-xs">{symbol}</span>
        {pct !== null && (
          <span className={cn('text-[9px] font-mono font-bold', isUp ? 'text-green-500' : 'text-red-400')}>
            {isUp ? '+' : ''}{pct.toFixed(2)}%
          </span>
        )}
      </div>
      <p className={cn('font-mono font-bold text-sm tabular-nums mt-0.5', price ? 'text-foreground' : 'text-muted-foreground/30')}>
        {price ? `$${fmtPrice(price.price)}` : '—'}
      </p>
    </div>
  );
}

// ── SignalCard ─────────────────────────────────────────────────────────────────

function SignalCard({ signal, onTrade, onReject, acting }: {
  signal: SignalData; onTrade: (id: string) => void; onReject: (id: string) => void; acting: string | null;
}) {
  const [open, setOpen] = useState(false);
  const isBuy = signal.direction === 'buy';
  const conf = Math.round((signal.confidence ?? 0) * 100);
  const canAct = !signal.status || signal.status === 'pending';
  const isDone = signal.status === 'paper_traded' || signal.status === 'live_traded';
  const isRejected = !!signal.status && signal.status !== 'pending' && !isDone;
  const ai = signal.ai_analysis ?? {};
  const bull = ai.bull_score as number | undefined;
  const bear = ai.bear_score as number | undefined;

  return (
    <div className={cn(
      'rounded-xl border bg-card transition-all',
      canAct
        ? isBuy ? 'border-green-500/50 shadow-sm shadow-green-500/8' : 'border-red-400/50 shadow-sm shadow-red-400/8'
        : isDone ? 'border-border opacity-60' : 'border-border opacity-50',
    )}>
      <div className={cn('h-0.5 rounded-t-xl', isBuy ? 'bg-green-500' : 'bg-red-400')} />
      <div className="p-3 space-y-2">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-sm">{(signal.asset ?? '').split('/')[0]}</span>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">{CRYPTO_NAMES[(signal.asset ?? '').split('/')[0]] ?? ''}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={cn(
              'text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5',
              isBuy ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500',
            )}>
              {isBuy ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
              {isBuy ? 'BUY' : 'SELL'}
            </span>
            {isDone && <Badge variant="success">Done</Badge>}
            {isRejected && <Badge variant="muted">Skip</Badge>}
          </div>
        </div>

        {/* Confidence */}
        <div>
          <div className="flex justify-between text-[10px] font-mono mb-1">
            <span className="text-muted-foreground">Confidence</span>
            <span className={cn('font-bold', conf >= 65 ? 'text-green-500' : conf >= 55 ? 'text-amber-500' : 'text-muted-foreground')}>
              {conf}%
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', isBuy ? 'bg-green-500' : 'bg-red-400')}
              style={{ width: `${conf}%` }}
            />
          </div>
        </div>

        {/* Bull/Bear bar */}
        {bull !== undefined && bear !== undefined && (
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            <span className="text-green-500 shrink-0 w-8">🐂 {(bull * 100).toFixed(0)}%</span>
            <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-muted">
              <div className="bg-green-500" style={{ width: `${((bull / ((bull + bear) || 1)) * 100).toFixed(0)}%` }} />
              <div className="bg-red-400 flex-1" />
            </div>
            <span className="text-red-400 shrink-0 w-8 text-right">🐻 {(bear * 100).toFixed(0)}%</span>
          </div>
        )}

        {/* Entry / Stop / Target */}
        {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
          <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
            <div className="bg-muted/40 rounded px-1.5 py-1 text-center">
              <p className="text-muted-foreground text-[9px]">Entry</p>
              <p className="font-bold">{signal.suggested_entry ? `$${fmtPrice(signal.suggested_entry)}` : '—'}</p>
            </div>
            <div className="bg-red-500/5 border border-red-500/10 rounded px-1.5 py-1 text-center">
              <p className="text-red-400 text-[9px]">Stop</p>
              <p className="font-bold text-red-400">{signal.suggested_stop ? `$${fmtPrice(signal.suggested_stop)}` : '—'}</p>
            </div>
            <div className="bg-green-500/5 border border-green-500/10 rounded px-1.5 py-1 text-center">
              <p className="text-green-500 text-[9px]">Target</p>
              <p className="font-bold text-green-500">{signal.suggested_take_profit ? `$${fmtPrice(signal.suggested_take_profit)}` : '—'}</p>
            </div>
          </div>
        )}

        {/* Expandable reason */}
        {signal.reason && (
          <button onClick={() => setOpen(o => !o)} className="w-full text-left">
            <p className={cn('text-[10px] text-muted-foreground leading-snug', open ? '' : 'line-clamp-2')}>
              {signal.reason}
            </p>
            <span className="text-[9px] text-muted-foreground/60 flex items-center gap-0.5 mt-0.5">
              {open ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
              {open ? 'Minder' : 'Meer'}
            </span>
          </button>
        )}

        {/* Actions */}
        {canAct && (
          <div className="flex gap-1.5 pt-0.5">
            <button
              onClick={() => onTrade(signal.id)}
              disabled={acting === signal.id}
              className={cn(
                'flex-1 h-8 text-[11px] font-mono font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50',
                isBuy ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-red-500 hover:bg-red-600 text-white',
              )}
            >
              {acting === signal.id
                ? <Zap size={11} className="animate-spin" />
                : isBuy ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
              Paper {isBuy ? 'Buy' : 'Sell'} ${(signal.suggested_entry || 0) > 0 ? fmtPrice(signal.suggested_entry!) : '?'}
            </button>
            <button
              onClick={() => onReject(signal.id)}
              disabled={acting === signal.id}
              className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/40 transition-colors flex items-center justify-center disabled:opacity-50"
            >
              <XCircle size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ActivityFeed ───────────────────────────────────────────────────────────────

function ActivityFeed({ events, connected, tick }: { events: ActivityEvent[]; connected: boolean; tick: number }) {
  const feedRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col h-full">
      {/* Feed header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0 bg-card/60">
        <div className="flex items-center gap-2">
          <Bot size={13} className="text-amber-400" />
          <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider">AI Brain</span>
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <span className="text-[9px] font-mono text-muted-foreground tabular-nums">tick {tick}</span>
          )}
          <div className={cn('flex items-center gap-1 text-[9px] font-mono', connected ? 'text-green-500' : 'text-muted-foreground')}>
            <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40')} />
            {connected ? 'LIVE' : 'OFFLINE'}
          </div>
        </div>
      </div>

      {/* Events */}
      <div ref={feedRef} className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-12">
            <span className="text-3xl opacity-20">🧠</span>
            <span className="text-xs font-mono">Wachten op AI activiteit…</span>
            {!connected && <span className="text-[10px] text-muted-foreground/60">SSE verbinding wordt opgebouwd</span>}
          </div>
        ) : (
          events.map((ev, idx) => {
            const meta = ACTION_META[ev.action] ?? { icon: '·', label: ev.action.replaceAll('_', ' '), color: 'text-muted-foreground' };
            const details = ev.details ?? {};
            const asset = details.asset as string | undefined;
            const confidence = details.confidence as number | undefined;
            const notional = details.notional as number | undefined;
            const isHighlight = ev.action === 'auto_trade_executed' || ev.action === 'signal_generated';

            return (
              <div
                key={`${ev.created_at}::${ev.action}::${idx}`}
                className={cn(
                  'flex items-start gap-2 px-3 py-2 border-b border-border/30 last:border-0 transition-colors',
                  isHighlight ? 'bg-amber-500/5' : 'hover:bg-muted/20',
                )}
              >
                <span className={cn('font-mono text-sm shrink-0 w-4 text-center leading-none mt-0.5', meta.color)}>
                  {meta.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className={cn('text-[11px] font-medium font-mono', meta.color)}>{meta.label}</span>
                    {asset && <span className="text-[10px] font-mono font-bold">{asset.split('/')[0]}</span>}
                    {confidence !== undefined && (
                      <span className="text-[9px] font-mono text-amber-400">{(confidence * 100).toFixed(0)}%</span>
                    )}
                    {notional !== undefined && (
                      <span className="text-[9px] font-mono text-muted-foreground">${notional.toFixed(0)}</span>
                    )}
                  </div>
                  {ev.message && (
                    <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{ev.message}</p>
                  )}
                </div>
                <span className="text-[9px] font-mono text-muted-foreground/60 shrink-0 tabular-nums">{fmtTime(ev.created_at)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── SessionControls ────────────────────────────────────────────────────────────

function SessionControls({ session, settings: cfg, botHealth, onToggle24_7, onStart, onStop, busy }: {
  session: any; settings: any; botHealth: any;
  onToggle24_7: () => void; onStart: (d: number, n: number, t: number) => void; onStop: () => void;
  busy: string | null;
}) {
  const [duration, setDuration] = useState(120);
  const [notional, setNotional] = useState(250);
  const [maxTrades, setMaxTrades] = useState(5);
  const [expanded, setExpanded] = useState(false);

  const active = !!session?.active;
  const crypto24_7 = !!(cfg?.crypto_24_7_enabled ?? session?.crypto_24_7_enabled);
  const blockers: string[] = botHealth?.blockers ?? [];

  return (
    <div className="space-y-2">
      {/* 24/7 toggle row */}
      <div className={cn(
        'rounded-xl border px-4 py-3 transition-all duration-300',
        crypto24_7 ? 'border-green-500/50 bg-green-500/5' : 'border-border bg-card',
      )}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold flex items-center gap-2">
              <span className={cn('text-base font-bold', crypto24_7 ? 'text-green-500' : 'text-muted-foreground')}>∞</span>
              24/7 Crypto Trading
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {crypto24_7 ? 'Actief — handelt altijd in crypto' : 'Alleen handelen tijdens sessie of markturen'}
            </p>
          </div>
          <button
            onClick={onToggle24_7}
            disabled={busy === '24_7'}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 transition-colors focus:outline-none disabled:opacity-50 cursor-pointer',
              crypto24_7 ? 'bg-green-500 border-green-500' : 'bg-muted border-border',
            )}
          >
            <span className={cn(
              'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5',
              crypto24_7 ? 'translate-x-5' : 'translate-x-0.5',
            )} />
          </button>
        </div>
        {crypto24_7 && (
          <p className="mt-2 text-[10px] text-green-600 font-mono flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Signalen ≥ 55% confidence worden automatisch uitgevoerd
          </p>
        )}
      </div>

      {/* Timed session */}
      <div className="rounded-xl border border-border bg-card">
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors rounded-xl"
        >
          <div className="flex items-center gap-2">
            <Clock size={13} />
            <span>Tijdgebonden Sessie</span>
            {active && <Badge variant="success">Actief · {session?.expires_at ? minutesLeft(session.expires_at) : 0} min</Badge>}
          </div>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px]">
                <span className="text-muted-foreground block mb-1">Duur</span>
                <select value={duration} onChange={e => setDuration(+e.target.value)} className="w-full h-8 rounded-md border border-border bg-card px-2 text-xs">
                  <option value={60}>1u</option>
                  <option value={120}>2u</option>
                  <option value={240}>4u</option>
                  <option value={480}>8u</option>
                </select>
              </label>
              <label className="text-[11px]">
                <span className="text-muted-foreground block mb-1">$/Trade</span>
                <input type="number" min={25} max={2500} value={notional} onChange={e => setNotional(+e.target.value)}
                  className="w-full h-8 rounded-md border border-border bg-card px-2 text-xs" />
              </label>
              <label className="text-[11px]">
                <span className="text-muted-foreground block mb-1">Trades</span>
                <input type="number" min={1} max={25} value={maxTrades} onChange={e => setMaxTrades(+e.target.value)}
                  className="w-full h-8 rounded-md border border-border bg-card px-2 text-xs" />
              </label>
            </div>
            {blockers.length > 0 && (
              <div className="text-[10px] text-amber-500 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                {blockers.map((b, i) => <p key={i}>{b}</p>)}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 gap-1.5" onClick={() => onStart(duration, notional, maxTrades)} disabled={busy === 'start'}>
                {busy === 'start' ? <Zap size={11} className="animate-spin" /> : <Play size={11} />} Start
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onStop} disabled={!active || busy === 'stop'}>
                <Square size={11} /> Stop
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Bot status compact */}
      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium flex items-center gap-1.5"><ShieldCheck size={12} /> Bot status</span>
          <Badge variant={botHealth?.ready ? 'success' : 'warning'}>{botHealth?.ready ? 'Gereed' : 'Blokkades'}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
          {[
            { label: 'Kill switch', ok: !botHealth?.kill_switch_enabled },
            { label: 'Trading mode', value: botHealth?.trading_mode ?? '—' },
            { label: 'Alpaca', ok: botHealth?.alpaca_configured },
            { label: 'Anthropic AI', ok: botHealth?.anthropic_configured },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between gap-1">
              <span className="text-muted-foreground">{item.label}</span>
              {item.value
                ? <span className="font-mono font-medium">{item.value}</span>
                : item.ok
                  ? <CheckCircle size={11} className="text-green-500" />
                  : <XCircle size={11} className="text-red-400" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function CryptoPage() {
  const { data: session, reload: reloadSession } = useApi(() => api.getCryptoSession(), [], { pollIntervalMs: 10000 });
  const { data: settings, reload: reloadSettings } = useApi(() => api.getSettings(), [], { pollIntervalMs: 15000 });
  const { data: botHealth } = useApi(() => api.getBotHealth(), [], { pollIntervalMs: 15000 });
  const { data: positionsRaw, reload: reloadPositions } = useApi(() => api.getPositions(), [], { pollIntervalMs: 10000 });

  // SSE live state
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [flashSymbol, setFlashSymbol] = useState<string | null>(null);
  const [signals, setSignals] = useState<SignalData[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();

  // SSE handlers
  const handlePrice = useCallback((data: Record<string, unknown>) => {
    const pd = data as unknown as PriceData;
    if (pd.symbol) {
      setPrices(prev => ({ ...prev, [pd.symbol]: pd }));
      setFlashSymbol(pd.symbol);
      setTimeout(() => setFlashSymbol(null), 800);
    }
  }, []);

  const handleSignals = useCallback((data: Record<string, unknown>) => {
    const sigs = data.signals as SignalData[];
    if (Array.isArray(sigs)) {
      const cryptoSigs = sigs.filter(s =>
        CRYPTO_SYMBOLS.some(k => (s.asset ?? '').toUpperCase().includes(k))
      );
      setSignals(cryptoSigs);
    }
  }, []);

  const handleNewSignal = useCallback((data: Record<string, unknown>) => {
    const sig = data.signal as SignalData;
    if (!sig) return;
    const isCrypto = CRYPTO_SYMBOLS.some(k => (sig.asset ?? '').toUpperCase().includes(k));
    if (!isCrypto) return;
    setSignals(prev => prev.find(s => s.id === sig.id) ? prev : [sig, ...prev]);
  }, []);

  const handleActivity = useCallback((data: Record<string, unknown>) => {
    const events = data.events as ActivityEvent[];
    if (!Array.isArray(events)) return;
    setActivityFeed(prev => {
      const existingKeys = new Set(prev.map(e => `${e.created_at}::${e.action}`));
      const fresh = events.filter(e => !existingKeys.has(`${e.created_at}::${e.action}`));
      if (fresh.length === 0) return prev;
      return [...fresh, ...prev].slice(0, 100);
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
    { price: handlePrice, signals: handleSignals, new_signal: handleNewSignal, activity_batch: handleActivity, portfolio: handlePortfolio, heartbeat: handleHeartbeat },
    { onConnected: () => setConnected(true), onDisconnected: () => setConnected(false) },
  );

  // Derived
  const crypto24_7 = !!(settings?.crypto_24_7_enabled ?? session?.crypto_24_7_enabled);
  const cryptoPositions = useMemo(() =>
    (positionsRaw as any[] ?? []).filter((p: any) =>
      CRYPTO_SYMBOLS.some(k => (p.symbol ?? '').toUpperCase().includes(k))
    ), [positionsRaw]);

  const totalPnl = cryptoPositions.reduce((sum: number, p: any) => sum + parseFloat(p.unrealized_pl ?? '0'), 0);
  const pendingSignals = signals.filter(s => !s.status || s.status === 'pending');
  const doneSignals = signals.filter(s => s.status && s.status !== 'pending');

  // Actions
  async function toggle24_7() {
    setBusy('24_7');
    try {
      await api.updateRuntimeSettings({ crypto_24_7_enabled: !crypto24_7 });
      await Promise.all([reloadSession(), reloadSettings()]);
      toast(crypto24_7 ? '24/7 trading uitgeschakeld' : '24/7 trading ingeschakeld!', crypto24_7 ? 'info' : 'success');
    } catch (e: any) { toast(e?.detail || 'Toggle mislukt', 'error'); }
    finally { setBusy(null); }
  }

  async function startSession(d: number, n: number, t: number) {
    setBusy('start');
    try {
      await api.startCryptoSession({ duration_minutes: d, max_notional_per_trade: n, max_trades: t, note: 'Away-mode' });
      await reloadSession();
      toast('Sessie gestart', 'success');
    } catch (e: any) { toast(e?.detail || 'Start mislukt', 'error'); }
    finally { setBusy(null); }
  }

  async function stopSession() {
    setBusy('stop');
    try {
      await api.stopCryptoSession();
      await reloadSession();
      toast('Sessie gestopt', 'info');
    } catch (e: any) { toast(e?.detail || 'Stop mislukt', 'error'); }
    finally { setBusy(null); }
  }

  async function handleTrade(id: string) {
    setActing(id);
    try {
      let result = await api.paperTradeSignal(id);
      if (result.status === 'requires_manual_approval') {
        if (!confirm('Risk check vereist bevestiging. Doorgaan?')) { setActing(null); return; }
        result = await api.paperTradeSignal(id, true);
      }
      toast('Trade ingediend', 'success');
      setSignals(prev => prev.map(s => s.id === id ? { ...s, status: 'paper_traded' } : s));
    } catch (e: any) {
      toast(e?.detail?.reasons?.join(', ') || e?.detail || 'Trade mislukt', 'error');
    } finally { setActing(null); }
  }

  async function handleReject(id: string) {
    setActing(id);
    try {
      await api.rejectSignal(id);
      setSignals(prev => prev.map(s => s.id === id ? { ...s, status: 'rejected' } : s));
      toast('Signaal afgewezen', 'info');
    } catch { /* ignore */ }
    setActing(null);
  }

  async function handleClose(sym: string) {
    setClosing(sym);
    try {
      await api.closePosition(sym);
      toast(`${sym} positie gesloten`, 'success');
      await reloadPositions();
    } catch (e: any) { toast(e?.detail || 'Sluiten mislukt', 'error'); }
    finally { setClosing(null); }
  }

  return (
    <div className="flex flex-col -m-3 md:-m-4 bg-background overflow-hidden" style={{ height: 'calc(100dvh - 48px)' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 h-10 border-b border-border shrink-0 bg-card/60 gap-4 overflow-x-auto">
        <div className="flex items-center gap-3 text-[11px] font-mono shrink-0">
          <div className={cn('flex items-center gap-1.5 font-bold', connected ? 'text-green-500' : 'text-red-400')}>
            <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-500 animate-pulse' : 'bg-red-400')} />
            {connected ? `LIVE · ${tick}` : 'OFFLINE'}
          </div>
          <span className="text-muted-foreground">Crypto 24/7</span>
          <span className={cn('font-bold', crypto24_7 ? 'text-green-500' : 'text-muted-foreground')}>
            {crypto24_7 ? '∞ AAN' : 'UIT'}
          </span>
        </div>

        <div className="flex items-center gap-4 text-[11px] font-mono">
          {portfolio?.equity && (
            <span className="text-muted-foreground">
              Equity <span className="text-foreground font-bold">${portfolio.equity.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
            </span>
          )}
          {cryptoPositions.length > 0 && (
            <span className={cn('font-bold tabular-nums', totalPnl >= 0 ? 'text-green-500' : 'text-red-400')}>
              P&L {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
            </span>
          )}
          {pendingSignals.length > 0 && (
            <span className="text-amber-400 font-bold animate-pulse">{pendingSignals.length} signalen</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link href="/live">
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1">
              <TrendingUp size={11} /> Live View
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Price ticker ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 overflow-x-auto">
        {CRYPTO_SYMBOLS.map(sym => (
          <PriceTile key={sym} symbol={sym} price={prices[sym]} flash={flashSymbol === sym} />
        ))}
      </div>

      {/* ── Main 3-column layout ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Left col: controls */}
        <div className="w-72 xl:w-80 shrink-0 border-r border-border overflow-y-auto p-3 space-y-0">
          <SessionControls
            session={session}
            settings={settings}
            botHealth={botHealth}
            onToggle24_7={toggle24_7}
            onStart={startSession}
            onStop={stopSession}
            busy={busy}
          />

          {/* Open positions */}
          {cryptoPositions.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground px-1 mb-2">
                Open Posities ({cryptoPositions.length})
              </p>
              <div className="space-y-1.5">
                {cryptoPositions.map((p: any, i: number) => {
                  const pnl = parseFloat(p.unrealized_pl ?? '0');
                  const pnlPct = parseFloat(p.unrealized_plpc ?? '0') * 100;
                  const sym = (p.symbol ?? '').split('/')[0];
                  return (
                    <div key={i} className="rounded-lg border border-border bg-card px-3 py-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-xs">{sym}</span>
                          <span className={cn(
                            'text-[8px] font-bold px-1 py-0.5 rounded font-mono',
                            p.side === 'long' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500',
                          )}>{(p.side ?? 'LONG').toUpperCase()}</span>
                        </div>
                        <p className="text-[9px] font-mono text-muted-foreground mt-0.5">
                          {parseFloat(p.qty ?? '0') < 1 ? parseFloat(p.qty ?? '0').toFixed(4) : parseFloat(p.qty ?? '0').toFixed(2)} @ ${fmtPrice(parseFloat(p.avg_entry_price ?? '0'))}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={cn('text-xs font-mono font-bold tabular-nums', pnl >= 0 ? 'text-green-500' : 'text-red-400')}>
                          {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                        </p>
                        <p className={cn('text-[9px] font-mono', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                        </p>
                      </div>
                      <button
                        onClick={() => handleClose(sym)}
                        disabled={closing === sym}
                        className="text-[9px] font-mono px-1.5 py-1 rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/40 transition-colors disabled:opacity-40"
                      >
                        {closing === sym ? '…' : 'Sluit'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Middle col: signals */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-border">
          <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0 bg-card/40">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider">
              Crypto Signalen
            </span>
            <div className="flex items-center gap-2">
              {pendingSignals.length > 0 && (
                <span className="text-[9px] font-mono text-amber-400 font-bold animate-pulse">{pendingSignals.length} actie vereist</span>
              )}
              <Badge variant={pendingSignals.length > 0 ? 'warning' : 'muted'}>{signals.length}</Badge>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {signals.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <Circle size={32} className="opacity-15" />
                <p className="text-xs font-mono">Geen crypto signalen</p>
                <p className="text-[10px] opacity-60">
                  {crypto24_7 ? 'AI scant elke 10 min op kansen' : 'Activeer 24/7 modus of start een sessie'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingSignals.length > 0 && (
                  <p className="text-[10px] font-mono text-amber-400 font-bold uppercase tracking-wider mb-1">Actie vereist</p>
                )}
                {pendingSignals.map(s => (
                  <SignalCard key={s.id} signal={s} onTrade={handleTrade} onReject={handleReject} acting={acting} />
                ))}
                {doneSignals.length > 0 && (
                  <>
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-3 mb-1">Eerder</p>
                    {doneSignals.map(s => (
                      <SignalCard key={s.id} signal={s} onTrade={handleTrade} onReject={handleReject} acting={acting} />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right col: AI brain */}
        <div className="w-72 xl:w-80 shrink-0 flex flex-col overflow-hidden">
          <ActivityFeed events={activityFeed} connected={connected} tick={tick} />
        </div>
      </div>
    </div>
  );
}
