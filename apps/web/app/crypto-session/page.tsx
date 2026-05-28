'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  Activity, ArrowDownRight, ArrowUpRight, Bot, CheckCircle,
  Circle, Clock, Coins, LayoutGrid, Play, Radio, ShieldCheck,
  Square, TrendingUp, XCircle, Zap,
} from 'lucide-react';

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

const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', DOGE: 'Dogecoin',
  AVAX: 'Avalanche', LINK: 'Chainlink', LTC: 'Litecoin', AAVE: 'Aave',
  UNI: 'Uniswap', ALGO: 'Algorand', BCH: 'Bitcoin Cash', XRP: 'Ripple',
};

const ACTION_META: Record<string, { icon: string; color: string }> = {
  crypto_session_started:        { icon: '▶', color: 'text-green-500' },
  crypto_session_stopped:        { icon: '■', color: 'text-muted-foreground' },
  crypto_session_cycle_completed:{ icon: '↺', color: 'text-blue-400' },
  auto_trade_executed:           { icon: '✓', color: 'text-green-500' },
  auto_trade_risk_rejected:      { icon: '✕', color: 'text-red-400' },
  auto_trade_broker_error:       { icon: '!', color: 'text-red-400' },
  signal_generated:              { icon: '◆', color: 'text-amber-400' },
  settings_updated:              { icon: '⚙', color: 'text-muted-foreground' },
};

// ── sub-components ────────────────────────────────────────────────────────────

function StatusDot({ active, pulse = false }: { active: boolean; pulse?: boolean }) {
  return (
    <span className={cn(
      'inline-block w-2 h-2 rounded-full shrink-0',
      active ? 'bg-green-500' : 'bg-muted-foreground/40',
      active && pulse && 'animate-pulse',
    )} />
  );
}

function ModeToggleCard({ enabled, onToggle, busy }: { enabled: boolean; onToggle: () => void; busy: boolean }) {
  return (
    <Card className={cn(
      'transition-all duration-300',
      enabled
        ? 'border-green-500/60 bg-green-500/[0.03] shadow-sm shadow-green-500/10'
        : 'border-border',
    )}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shrink-0',
              enabled ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground',
            )}>
              ∞
            </div>
            <div>
              <p className="font-semibold text-sm leading-tight">24/7 Crypto Trading</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {enabled
                  ? 'Actief — bot handelt continu in crypto'
                  : 'Uitgeschakeld — bot wacht op markturen of sessie'}
              </p>
            </div>
          </div>
          <button
            onClick={onToggle}
            disabled={busy}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none disabled:opacity-50',
              enabled ? 'bg-green-500 border-green-500' : 'bg-muted border-border',
            )}
            aria-label="Toggle 24/7"
          >
            <span className={cn(
              'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform mt-0.5',
              enabled ? 'translate-x-5' : 'translate-x-0.5',
            )} />
          </button>
        </div>
        {enabled && (
          <div className="mt-3 flex items-center gap-2 text-xs text-green-600 font-medium">
            <Radio size={11} className="animate-pulse" />
            <span>Signalen worden automatisch uitgevoerd · Confidence ≥ 55% · Kill switch actief</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PositionRow({ pos, onClose, closing }: {
  pos: any; onClose: (s: string) => void; closing: string | null;
}) {
  const pnl = parseFloat(pos.unrealized_pl ?? '0');
  const pnlPct = parseFloat(pos.unrealized_plpc ?? '0') * 100;
  const entry = parseFloat(pos.avg_entry_price ?? '0');
  const current = parseFloat(pos.current_price ?? '0');
  const qty = parseFloat(pos.qty ?? '0');
  const sym = (pos.symbol || '').split('/')[0];
  const isPos = pnl >= 0;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-sm">{sym}</span>
          <span className="text-[10px] text-muted-foreground">{CRYPTO_NAMES[sym] ?? ''}</span>
          <span className={cn(
            'text-[9px] font-bold px-1.5 py-0.5 rounded font-mono',
            pos.side === 'long' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500',
          )}>
            {(pos.side ?? 'LONG').toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] font-mono text-muted-foreground">
          <span>{qty < 1 ? qty.toFixed(4) : qty.toFixed(2)} stk</span>
          <span>Entry ${fmtPrice(entry)}</span>
          <span>Nu ${fmtPrice(current)}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className={cn('font-mono font-bold text-sm tabular-nums', isPos ? 'text-green-500' : 'text-red-400')}>
          {isPos ? '+' : ''}{pnl.toFixed(2)}
        </p>
        <p className={cn('text-[10px] font-mono tabular-nums', isPos ? 'text-green-400' : 'text-red-400')}>
          {isPos ? '+' : ''}{pnlPct.toFixed(1)}%
        </p>
      </div>
      <button
        onClick={() => onClose(sym)}
        disabled={closing === sym}
        className="h-7 px-2.5 text-[10px] font-mono rounded border border-border text-muted-foreground hover:border-red-400/60 hover:text-red-400 transition-colors disabled:opacity-40 shrink-0"
      >
        {closing === sym ? '…' : 'Sluit'}
      </button>
    </div>
  );
}

function SignalCard({ signal, onTrade, onReject, acting }: {
  signal: any; onTrade: (id: string) => void; onReject: (id: string) => void; acting: string | null;
}) {
  const isBuy = signal.direction === 'buy';
  const conf = Math.round((signal.confidence ?? 0) * 100);
  const canAct = !signal.status || signal.status === 'pending';
  const isPaper = signal.status === 'paper_traded';
  const isLive = signal.status === 'live_traded';
  const isRejected = signal.status?.includes('reject') || signal.status?.includes('skip');
  const sym = (signal.asset || '').split('/')[0];

  return (
    <div className={cn(
      'rounded-xl border bg-card transition-all',
      canAct
        ? isBuy ? 'border-green-500/50 shadow-sm shadow-green-500/10' : 'border-red-400/50 shadow-sm shadow-red-400/10'
        : 'border-border opacity-75',
    )}>
      {/* Top strip */}
      <div className={cn('h-0.5 rounded-t-xl', isBuy ? 'bg-green-500' : 'bg-red-400')} />

      <div className="p-3 space-y-2.5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm">{sym}</span>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">{CRYPTO_NAMES[sym] ?? ''}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {canAct && (
              <span className={cn(
                'text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1',
                isBuy ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500',
              )}>
                {isBuy ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                {isBuy ? 'BUY' : 'SELL'}
              </span>
            )}
            {isPaper && <Badge variant="success">Paper</Badge>}
            {isLive && <Badge variant="success">Live</Badge>}
            {isRejected && <Badge variant="muted">Skip</Badge>}
          </div>
        </div>

        {/* Confidence bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-muted-foreground">Confidence</span>
            <span className={cn('font-bold', conf >= 65 ? 'text-green-500' : conf >= 55 ? 'text-amber-500' : 'text-muted-foreground')}>
              {conf}%
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', isBuy ? 'bg-green-500' : 'bg-red-400')}
              style={{ width: `${conf}%` }}
            />
          </div>
        </div>

        {/* Levels */}
        {(signal.suggested_entry || signal.suggested_stop || signal.suggested_take_profit) && (
          <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
            <div className="bg-muted/50 rounded-lg px-2 py-1.5 text-center">
              <p className="text-muted-foreground text-[9px]">Entry</p>
              <p className="font-bold mt-0.5">{signal.suggested_entry ? `$${fmtPrice(signal.suggested_entry)}` : '—'}</p>
            </div>
            <div className="bg-red-500/5 rounded-lg px-2 py-1.5 text-center border border-red-500/10">
              <p className="text-red-400 text-[9px]">Stop</p>
              <p className="font-bold text-red-400 mt-0.5">{signal.suggested_stop ? `$${fmtPrice(signal.suggested_stop)}` : '—'}</p>
            </div>
            <div className="bg-green-500/5 rounded-lg px-2 py-1.5 text-center border border-green-500/10">
              <p className="text-green-500 text-[9px]">Target</p>
              <p className="font-bold text-green-500 mt-0.5">{signal.suggested_take_profit ? `$${fmtPrice(signal.suggested_take_profit)}` : '—'}</p>
            </div>
          </div>
        )}

        {/* Reason */}
        {signal.reason && (
          <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">{signal.reason}</p>
        )}

        {/* Actions */}
        {canAct && (
          <div className="flex gap-1.5 pt-0.5">
            <button
              onClick={() => onTrade(signal.id)}
              disabled={acting === signal.id}
              className={cn(
                'flex-1 h-8 text-[11px] font-mono font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50',
                isBuy
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : 'bg-red-500 text-white hover:bg-red-600',
              )}
            >
              {acting === signal.id
                ? <Zap size={12} className="animate-spin" />
                : isBuy ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {isBuy ? 'Paper Buy' : 'Paper Sell'}
            </button>
            <button
              onClick={() => onReject(signal.id)}
              disabled={acting === signal.id}
              className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center disabled:opacity-50"
            >
              <XCircle size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function CryptoPage() {
  const { data: session, reload } = useApi(() => api.getCryptoSession(), [], { pollIntervalMs: 5000 });
  const { data: settings, reload: reloadSettings } = useApi(() => api.getSettings(), [], { pollIntervalMs: 8000 });
  const { data: botHealth } = useApi(() => api.getBotHealth(), [], { pollIntervalMs: 8000 });
  const { data: auditRaw, reload: reloadAudit } = useApi(() => api.getAuditLogs(60), [], { pollIntervalMs: 4000 });
  const { data: signalsRaw } = useApi(() => api.getSignals(30), [], { pollIntervalMs: 8000 });
  const { data: positionsRaw, reload: reloadPositions } = useApi(() => api.getPositions(), [], { pollIntervalMs: 6000 });

  const [duration, setDuration] = useState(120);
  const [notional, setNotional] = useState(250);
  const [maxTrades, setMaxTrades] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const { toast } = useToast();

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const active = !!session?.active;
  const crypto24_7 = !!(settings?.crypto_24_7_enabled ?? session?.crypto_24_7_enabled);
  const autonomous = !!session?.autonomous_allowed_now;
  const remaining = useMemo(() => minutesLeft(session?.expires_at), [session?.expires_at, now]);
  const blockers: string[] = botHealth?.blockers ?? [];

  const CRYPTO_KEYS = ['BTC', 'ETH', 'SOL', 'AVAX', 'DOGE', 'LINK', 'LTC', 'AAVE', 'UNI', 'ALGO', 'BCH', 'XRP', 'SUSHI', 'CRV', 'MKR', 'YFI'];
  const cryptoSignals = useMemo(() =>
    (signalsRaw as any[] ?? []).filter((s: any) =>
      CRYPTO_KEYS.some(k => (s.asset ?? '').toUpperCase().includes(k))
    ), [signalsRaw]);

  const cryptoPositions = useMemo(() =>
    (positionsRaw as any[] ?? []).filter((p: any) =>
      CRYPTO_KEYS.some(k => (p.symbol ?? '').toUpperCase().includes(k))
    ), [positionsRaw]);

  const activityEvents = useMemo(() =>
    (auditRaw as any[] ?? [])
      .filter((e: any) => ['crypto_session_started', 'crypto_session_stopped',
        'crypto_session_cycle_completed', 'auto_trade_executed', 'auto_trade_risk_rejected',
        'auto_trade_broker_error', 'signal_generated', 'settings_updated'].includes(e.action))
      .slice(0, 20),
    [auditRaw]);

  const totalPnl = cryptoPositions.reduce((sum: number, p: any) => sum + parseFloat(p.unrealized_pl ?? '0'), 0);

  async function toggle24_7() {
    setBusy('24_7');
    try {
      await api.updateRuntimeSettings({ crypto_24_7_enabled: !crypto24_7 });
      await Promise.all([reload(), reloadSettings(), reloadAudit()]);
      toast(crypto24_7 ? '24/7 trading uitgeschakeld' : '24/7 trading ingeschakeld!', crypto24_7 ? 'info' : 'success');
    } catch (e: any) {
      toast(e?.detail || 'Toggle mislukt', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function startSession() {
    setBusy('start');
    try {
      await api.startCryptoSession({ duration_minutes: duration, max_notional_per_trade: notional, max_trades: maxTrades, note: 'Away-mode crypto session' });
      await Promise.all([reload(), reloadAudit()]);
      toast('Crypto sessie gestart', 'success');
    } catch (e: any) {
      toast(e?.detail || 'Start mislukt', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function stopSession() {
    setBusy('stop');
    try {
      await api.stopCryptoSession();
      await Promise.all([reload(), reloadAudit()]);
      toast('Sessie gestopt', 'info');
    } catch (e: any) {
      toast(e?.detail || 'Stop mislukt', 'error');
    } finally {
      setBusy(null);
    }
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
    } catch (e: any) {
      toast(e?.detail?.reasons?.join(', ') || e?.detail || 'Mislukt', 'error');
    } finally {
      setActing(null);
    }
  }

  async function handleReject(id: string) {
    setActing(id);
    try {
      await api.rejectSignal(id);
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
    } catch (e: any) {
      toast(e?.detail || 'Sluiten mislukt', 'error');
    } finally {
      setClosing(null);
    }
  }

  return (
    <div className="space-y-4 pb-20 md:pb-6 max-w-7xl mx-auto">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Crypto Trading</h1>
          <p className="text-xs text-muted-foreground mt-0.5">24/7 autonoom handelen in crypto — onafhankelijk van US markturen</p>
        </div>
        <div className="flex gap-2">
          <Link href="/live">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Activity size={13} /> Live View
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Status row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: '24/7 Modus',
            value: crypto24_7 ? 'Actief' : 'Uit',
            icon: <span className="text-base font-bold">∞</span>,
            color: crypto24_7 ? 'text-green-500' : 'text-muted-foreground',
            bg: crypto24_7 ? 'bg-green-500/10' : 'bg-muted/50',
          },
          {
            label: 'Sessie',
            value: active ? `${remaining} min` : 'Inactief',
            icon: <Clock size={14} />,
            color: active ? 'text-blue-400' : 'text-muted-foreground',
            bg: active ? 'bg-blue-400/10' : 'bg-muted/50',
          },
          {
            label: 'Open Posities',
            value: cryptoPositions.length.toString(),
            icon: <LayoutGrid size={14} />,
            color: cryptoPositions.length > 0 ? 'text-amber-500' : 'text-muted-foreground',
            bg: cryptoPositions.length > 0 ? 'bg-amber-500/10' : 'bg-muted/50',
          },
          {
            label: 'Unrealized P&L',
            value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`,
            icon: <TrendingUp size={14} />,
            color: totalPnl > 0 ? 'text-green-500' : totalPnl < 0 ? 'text-red-400' : 'text-muted-foreground',
            bg: totalPnl > 0 ? 'bg-green-500/10' : totalPnl < 0 ? 'bg-red-400/10' : 'bg-muted/50',
          },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', item.bg, item.color)}>
                {item.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                <p className={cn('text-sm font-bold tabular-nums font-mono mt-0.5', item.color)}>{item.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Main 3-col grid ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Col 1: Controls */}
        <div className="space-y-3">

          {/* 24/7 toggle */}
          <ModeToggleCard enabled={crypto24_7} onToggle={toggle24_7} busy={busy === '24_7'} />

          {/* Timed session */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Play size={14} />
                <CardTitle className="text-sm">Tijdgebonden Sessie</CardTitle>
              </div>
              <Badge variant={active ? 'success' : 'muted'}>{active ? 'Actief' : 'Standby'}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <label className="text-[11px]">
                  <span className="text-muted-foreground block mb-1">Duur</span>
                  <select
                    value={duration}
                    onChange={e => setDuration(Number(e.target.value))}
                    className="w-full h-8 rounded-md border border-border bg-card px-2 text-xs"
                  >
                    <option value={60}>1u</option>
                    <option value={120}>2u</option>
                    <option value={240}>4u</option>
                    <option value={480}>8u</option>
                  </select>
                </label>
                <label className="text-[11px]">
                  <span className="text-muted-foreground block mb-1">$/Trade</span>
                  <input
                    type="number" min={25} max={2500} value={notional}
                    onChange={e => setNotional(Number(e.target.value))}
                    className="w-full h-8 rounded-md border border-border bg-card px-2 text-xs"
                  />
                </label>
                <label className="text-[11px]">
                  <span className="text-muted-foreground block mb-1">Trades</span>
                  <input
                    type="number" min={1} max={25} value={maxTrades}
                    onChange={e => setMaxTrades(Number(e.target.value))}
                    className="w-full h-8 rounded-md border border-border bg-card px-2 text-xs"
                  />
                </label>
              </div>

              {active && (
                <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 px-3 py-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Resterende tijd</span>
                    <span className="font-mono font-bold text-blue-400 tabular-nums">{remaining} min</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">Max trades</span>
                    <span className="font-mono font-bold tabular-nums">{session?.max_trades ?? 0}</span>
                  </div>
                </div>
              )}

              {blockers.length > 0 && (
                <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-[11px]">
                  <p className="font-medium text-amber-500 mb-1">Blockers</p>
                  {blockers.map((b, i) => <p key={i} className="text-muted-foreground">{b}</p>)}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={startSession} disabled={busy === 'start'} size="sm" className="flex-1 gap-1.5">
                  {busy === 'start' ? <Zap size={12} className="animate-spin" /> : <Play size={12} />}
                  Start
                </Button>
                <Button onClick={stopSession} variant="outline" size="sm" disabled={!active || busy === 'stop'} className="gap-1.5">
                  <Square size={12} /> Stop
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Bot status */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} />
                <CardTitle className="text-sm">Bot Status</CardTitle>
              </div>
              <Badge variant={botHealth?.ready ? 'success' : 'warning'}>
                {botHealth?.ready ? 'Gereed' : 'Blokkades'}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 text-[11px]">
                {[
                  { label: 'Kill switch', ok: !botHealth?.kill_switch_enabled, bad: 'Aan' },
                  { label: 'Trading mode', ok: true, value: botHealth?.trading_mode ?? '—' },
                  { label: 'Alpaca', ok: botHealth?.alpaca_configured },
                  { label: 'Anthropic', ok: botHealth?.anthropic_configured },
                  { label: 'AI Guard', ok: !botHealth?.ai_guard?.paused, bad: 'Gepauzeerd' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{item.label}</span>
                    <div className="flex items-center gap-1.5">
                      {item.value
                        ? <span className="font-mono font-medium">{item.value}</span>
                        : item.ok
                          ? <CheckCircle size={12} className="text-green-500" />
                          : <XCircle size={12} className="text-red-400" />}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Col 2: Signals */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Bot size={14} />
              Crypto Signalen
              <Badge variant={cryptoSignals.length > 0 ? 'warning' : 'muted'}>{cryptoSignals.length}</Badge>
            </h2>
          </div>

          {cryptoSignals.length === 0 ? (
            <Card>
              <CardContent className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
                <Circle size={28} className="opacity-20" />
                <p className="text-xs">Geen actieve crypto signalen</p>
                <p className="text-[10px] text-muted-foreground/60">Signalen verschijnen hier zodra de AI ze genereert</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {cryptoSignals.map((s: any) => (
                <SignalCard
                  key={s.id}
                  signal={s}
                  onTrade={handleTrade}
                  onReject={handleReject}
                  acting={acting}
                />
              ))}
            </div>
          )}
        </div>

        {/* Col 3: Positions + Activity */}
        <div className="space-y-3">

          {/* Positions */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <Coins size={14} />
                <CardTitle className="text-sm">Open Posities</CardTitle>
              </div>
              <Badge variant={cryptoPositions.length > 0 ? 'success' : 'muted'}>{cryptoPositions.length} posities</Badge>
            </CardHeader>
            <CardContent className="px-0 pt-1">
              {cryptoPositions.length === 0 ? (
                <p className="text-xs text-muted-foreground px-4 py-3">Geen open crypto posities</p>
              ) : (
                cryptoPositions.map((p: any, i: number) => (
                  <PositionRow key={i} pos={p} onClose={handleClose} closing={closing} />
                ))
              )}
            </CardContent>
          </Card>

          {/* Activity feed */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Activity size={14} />
                <CardTitle className="text-sm">Activiteit</CardTitle>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-green-500">
                <StatusDot active pulse />
                Live
              </div>
            </CardHeader>
            <CardContent className="px-0 pt-0">
              {activityEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground px-4 py-3">Nog geen activiteit</p>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {activityEvents.map((ev: any) => {
                    const meta = ACTION_META[ev.action] ?? { icon: '·', color: 'text-muted-foreground' };
                    return (
                      <div key={ev.id} className="flex items-start gap-3 px-4 py-2 border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                        <span className={cn('font-mono text-sm shrink-0 w-4 text-center mt-px', meta.color)}>{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className={cn('text-[11px] font-medium', meta.color)}>
                            {ev.action.replaceAll('_', ' ')}
                          </p>
                          {ev.message && <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{ev.message}</p>}
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums">{fmtTime(ev.created_at)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
