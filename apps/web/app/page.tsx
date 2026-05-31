'use client';

import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { cn, fmtUSD, cleanSym } from '@/lib/utils';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Dice5, Shield, Activity, Zap } from 'lucide-react';

export default function DashboardPage() {
  const { toast } = useToast();

  const { data: account } = useApi(() => api.getAccount(), [], { pollIntervalMs: 30000 });
  const { data: pnl } = useApi(() => api.getPnlSummary(), [], { pollIntervalMs: 60000 });
  const { data: positions } = useApi(() => api.getPositions(), [], { pollIntervalMs: 20000 });
  const { data: signals } = useApi(() => api.getSignals(10), [], { pollIntervalMs: 60000 });
  const { data: status } = useApi(() => api.apiStatus(), [], { pollIntervalMs: 30000 });
  const { data: botHealth } = useApi(() => api.getBotHealth(), [], { pollIntervalMs: 30000 });
  const { data: aiUsage } = useApi(() => api.getAiUsage(), [], { pollIntervalMs: 120000 });
  const { data: auditLogs } = useApi(() => api.getAuditLogs(20), [], { pollIntervalMs: 30000 });
  const { data: trades } = useApi(() => api.getTrades(5), [], { pollIntervalMs: 60000 });

  const equity = parseFloat((account as any)?.equity || '0');
  const lastEquity = parseFloat((account as any)?.last_equity || (account as any)?.equity || '0');
  const dayPnl = equity - lastEquity;
  const dayPnlPct = lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0;

  const openPositions: any[] = Array.isArray(positions) ? positions : [];
  const pendingSignals = (Array.isArray(signals) ? signals as any[] : []).filter(
    (s: any) => !s.status || s.status === 'pending'
  );

  const killSwitch = !!(status as any)?.kill_switch_enabled;
  const aiPaused = !!(botHealth as any)?.ai_guard?.paused;
  const blockers: string[] = (botHealth as any)?.blockers ?? [];
  const botActive = !killSwitch && !aiPaused && blockers.length === 0;

  const totalPnl = (pnl as any)?.total_pnl ?? 0;
  const winRate = (pnl as any)?.win_rate ?? null;
  const aiSpend: number = (aiUsage as any)?.today_usd ?? 0;
  const roi = aiSpend > 0 ? totalPnl / aiSpend : null;
  const unrealizedTotal = openPositions.reduce((s, p) => s + parseFloat(p.unrealized_pl || 0), 0);

  const recentTrades: any[] = Array.isArray(trades) ? trades : [];
  const recentLogs: any[] = Array.isArray(auditLogs) ? (auditLogs as any[]).slice(0, 15) : [];

  async function toggleKillSwitch() {
    try {
      if (killSwitch) {
        await api.disableKillSwitch();
        toast('Kill switch uitgeschakeld — bot kan handelen', 'success');
      } else {
        await api.enableKillSwitch();
        toast('Kill switch AAN — alle handel gestopt', 'warning');
      }
    } catch (e: any) {
      toast(e?.detail || 'Fout', 'error');
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Portfolio hero */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Portfolio</p>
            <p className="text-4xl font-bold font-num">{fmtUSD(equity)}</p>
            <div className="flex items-center gap-2 mt-1.5">
              {dayPnl >= 0
                ? <TrendingUp size={13} className="text-green-400" />
                : <TrendingDown size={13} className="text-red-400" />}
              <span className={cn('text-sm font-bold font-num', dayPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                {dayPnl >= 0 ? '+' : ''}{fmtUSD(dayPnl)} ({dayPnlPct >= 0 ? '+' : ''}{dayPnlPct.toFixed(2)}%)
              </span>
              <span className="text-xs text-muted-foreground">vandaag</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border',
              botActive ? 'bg-green-500/10 text-green-400 border-green-500/20' :
              killSwitch ? 'bg-red-500/10 text-red-400 border-red-500/20' :
              'bg-amber-500/10 text-amber-400 border-amber-500/20'
            )}>
              <span className={cn('w-1.5 h-1.5 rounded-full',
                botActive ? 'bg-green-400 animate-pulse' : killSwitch ? 'bg-red-400' : 'bg-amber-400')} />
              {botActive ? 'Bot actief' : killSwitch ? 'Kill switch' : 'Gepauzeerd'}
            </span>
            <p className="text-xs text-muted-foreground mt-2">
              All-time: <span className={cn('font-bold font-num', totalPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                {totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}
              </span>
            </p>
            {winRate !== null && (
              <p className="text-xs text-muted-foreground">
                Win rate: <span className="font-bold">{(winRate * 100).toFixed(0)}%</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/posities">
          <StatCard label="Open posities" value={openPositions.length.toString()}
            sub={unrealizedTotal !== 0 ? `${unrealizedTotal >= 0 ? '+' : ''}${fmtUSD(unrealizedTotal)}` : 'Geen open'}
            subColor={unrealizedTotal >= 0 ? 'green' : 'red'} />
        </Link>
        <Link href="/signals">
          <StatCard label="Signalen" value={pendingSignals.length.toString()}
            sub={pendingSignals.length > 0 ? 'Wachten' : 'Niets pending'}
            subColor={pendingSignals.length > 0 ? 'amber' : 'muted'} />
        </Link>
        <StatCard label="AI ROI"
          value={roi !== null ? `${roi.toFixed(1)}×` : '—'}
          sub={`$${aiSpend.toFixed(2)} AI kosten`}
          subColor={roi !== null && roi > 1 ? 'green' : 'muted'} />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/gok"
          className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-center gap-3 hover:bg-amber-500/15 transition-colors">
          <Dice5 size={22} className="text-amber-400 shrink-0" />
          <div>
            <p className="font-bold text-sm">Gok Modus</p>
            <p className="text-xs text-muted-foreground">AI-gedreven speculatieve bet</p>
          </div>
        </Link>
        <button onClick={toggleKillSwitch}
          className={cn(
            'rounded-2xl p-4 flex items-center gap-3 transition-colors text-left w-full',
            killSwitch
              ? 'bg-green-500/10 border border-green-500/20 hover:bg-green-500/15'
              : 'bg-red-500/10 border border-red-500/20 hover:bg-red-500/15'
          )}>
          <Shield size={22} className={cn('shrink-0', killSwitch ? 'text-green-400' : 'text-red-400')} />
          <div>
            <p className="font-bold text-sm">{killSwitch ? 'Handel hervatten' : 'Kill switch'}</p>
            <p className="text-xs text-muted-foreground">{killSwitch ? 'Kill switch staat aan' : 'Alles direct stoppen'}</p>
          </div>
        </button>
      </div>

      {/* Pending signals alert */}
      {pendingSignals.length > 0 && (
        <Link href="/signals"
          className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-2xl p-4 hover:bg-primary/10 transition-colors">
          <Zap size={18} className="text-primary shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold">{pendingSignals.length} signaal{pendingSignals.length !== 1 ? 'en' : ''} wachten</p>
            <p className="text-xs text-muted-foreground">
              {pendingSignals.slice(0, 3).map((s: any) => s.asset || s.symbol).join(' · ')}
              {pendingSignals.length > 3 ? ` +${pendingSignals.length - 3}` : ''}
            </p>
          </div>
          <span className="text-xs text-primary font-bold">Bekijk →</span>
        </Link>
      )}

      {/* Open positions preview */}
      {openPositions.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-semibold">Open posities</p>
            <Link href="/posities" className="text-xs text-primary hover:underline">Alle →</Link>
          </div>
          {openPositions.slice(0, 5).map((pos: any) => {
            const pl = parseFloat(pos.unrealized_pl || '0');
            const plPct = parseFloat(pos.unrealized_plpc || '0') * 100;
            return (
              <div key={pos.symbol} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0">
                <p className="font-bold text-sm w-16">{cleanSym(pos.symbol)}</p>
                <p className="text-xs text-muted-foreground font-num flex-1">{fmtUSD(parseFloat(pos.market_value || '0'))}</p>
                <p className={cn('text-sm font-bold font-num', pl >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {pl >= 0 ? '+' : ''}{fmtUSD(pl)}
                </p>
                <p className={cn('text-xs font-num w-12 text-right', pl >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent trades */}
      {recentTrades.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-semibold">Recente trades</p>
            <Link href="/posities" className="text-xs text-primary hover:underline">Alle →</Link>
          </div>
          {recentTrades.map((t: any) => {
            const pnlVal = t.pnl ?? 0;
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0">
                <div className={cn('w-1 h-6 rounded-full shrink-0', pnlVal >= 0 ? 'bg-green-400' : 'bg-red-400')} />
                <p className="font-bold text-sm w-14">{t.symbol}</p>
                <p className="text-xs text-muted-foreground flex-1 truncate">{t.exit_reason?.slice(0, 45) || t.side}</p>
                <p className={cn('text-sm font-bold font-num shrink-0', pnlVal >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {pnlVal >= 0 ? '+' : ''}{fmtUSD(pnlVal)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Bot activiteit */}
      {recentLogs.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Activity size={14} className="text-muted-foreground" />
            <p className="text-sm font-semibold">Bot activiteit</p>
          </div>
          <div className="divide-y divide-border max-h-64 overflow-y-auto">
            {recentLogs.map((log: any) => (
              <div key={log.id} className="px-4 py-2 flex items-start gap-3">
                <span className="text-[10px] text-muted-foreground font-num shrink-0 mt-0.5 tabular-nums w-10">
                  {new Date(log.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <p className="flex-1 text-xs leading-snug truncate">{log.message || log.action}</p>
                <span className={cn('text-[9px] font-bold shrink-0 uppercase',
                  log.status === 'success' ? 'text-green-400' :
                  log.status === 'error' ? 'text-red-400' : 'text-muted-foreground')}>
                  {log.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, subColor = 'muted' }: {
  label: string; value: string; sub: string; subColor?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-3.5 text-center hover:border-primary/30 transition-colors h-full">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold font-num">{value}</p>
      <p className={cn('text-[11px] mt-1 font-medium truncate',
        subColor === 'green' ? 'text-green-400' :
        subColor === 'red' ? 'text-red-400' :
        subColor === 'amber' ? 'text-amber-400' :
        'text-muted-foreground')}>
        {sub}
      </p>
    </div>
  );
}
