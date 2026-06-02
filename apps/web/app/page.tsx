'use client';

import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { fmtUSD, cleanSym } from '@/lib/utils';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Dice5, Shield, Activity, Zap, ChevronRight, Power } from 'lucide-react';

// Shared exchange palette (matches /live)
const C = {
  panel: '#12161c', panel2: '#171c24', line: '#1e2630',
  text: '#eaeef3', sub: '#7a8694', faint: '#4a5563',
  up: '#2ebd85', down: '#f6465d', gold: '#f0b90b',
};

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
  const pendingSignals = (Array.isArray(signals) ? signals as any[] : []).filter((s: any) => !s.status || s.status === 'pending');

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
  const recentLogs: any[] = Array.isArray(auditLogs) ? (auditLogs as any[]).slice(0, 12) : [];

  async function toggleKillSwitch() {
    try {
      if (killSwitch) { await api.disableKillSwitch(); toast('Kill switch uit — bot kan handelen', 'success'); }
      else { await api.enableKillSwitch(); toast('Kill switch AAN — handel gestopt', 'warning'); }
    } catch (e: any) { toast(e?.detail || 'Fout', 'error'); }
  }

  const statusColor = botActive ? C.up : killSwitch ? C.down : C.gold;
  const statusLabel = botActive ? 'Bot actief' : killSwitch ? 'Kill switch' : 'Gepauzeerd';
  const up = dayPnl >= 0;

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {/* Portfolio hero */}
      <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[11px] uppercase tracking-wider" style={{ color: C.sub }}>Portfolio</span>
            <div className="mt-1 font-num text-[34px] font-bold leading-none" style={{ color: C.text }}>{fmtUSD(equity)}</div>
            <div className="mt-2 flex items-center gap-1.5">
              {up ? <TrendingUp size={14} style={{ color: C.up }} /> : <TrendingDown size={14} style={{ color: C.down }} />}
              <span className="font-num text-sm font-semibold" style={{ color: up ? C.up : C.down }}>
                {up ? '+' : ''}{fmtUSD(dayPnl)} ({up ? '+' : ''}{dayPnlPct.toFixed(2)}%)
              </span>
              <span className="text-xs" style={{ color: C.faint }}>vandaag</span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={{ background: statusColor + '1a', color: statusColor }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Open P&L" value={fmtUSD(unrealizedTotal)} tone={unrealizedTotal > 0 ? C.up : unrealizedTotal < 0 ? C.down : C.text} href="/posities" />
        <Metric label="All-time" value={fmtUSD(totalPnl)} tone={totalPnl > 0 ? C.up : totalPnl < 0 ? C.down : C.text} />
        <Metric label="Win rate" value={winRate != null ? `${(winRate * 100).toFixed(0)}%` : '—'} tone={C.text} />
        <Metric label="Posities" value={String(openPositions.length)} tone={C.text} href="/posities" />
        <Metric label="Signalen" value={String(pendingSignals.length)} tone={pendingSignals.length ? C.gold : C.sub} href="/signals" />
        <Metric label="AI ROI" value={roi != null ? `${roi.toFixed(1)}×` : '—'} sub={`$${aiSpend.toFixed(2)}`} tone={roi != null && roi > 1 ? C.up : C.sub} />
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        <Link href="/gok" className="flex items-center gap-3 rounded-xl p-3.5 transition-colors"
          style={{ background: C.gold + '14', border: `1px solid ${C.gold}33` }}>
          <Dice5 size={20} style={{ color: C.gold }} />
          <div><div className="text-sm font-semibold" style={{ color: C.text }}>Gok Modus</div>
            <div className="text-[11px]" style={{ color: C.sub }}>Speculatieve bet</div></div>
        </Link>
        <button onClick={toggleKillSwitch} className="flex items-center gap-3 rounded-xl p-3.5 text-left transition-colors"
          style={{ background: (killSwitch ? C.up : C.down) + '14', border: `1px solid ${(killSwitch ? C.up : C.down)}33` }}>
          {killSwitch ? <Power size={20} style={{ color: C.up }} /> : <Shield size={20} style={{ color: C.down }} />}
          <div><div className="text-sm font-semibold" style={{ color: C.text }}>{killSwitch ? 'Hervatten' : 'Kill switch'}</div>
            <div className="text-[11px]" style={{ color: C.sub }}>{killSwitch ? 'Handel weer aan' : 'Alles stoppen'}</div></div>
        </button>
      </div>

      {/* Pending signals banner */}
      {pendingSignals.length > 0 && (
        <Link href="/signals" className="flex items-center gap-3 rounded-xl p-3.5"
          style={{ background: C.gold + '10', border: `1px solid ${C.gold}33` }}>
          <Zap size={18} style={{ color: C.gold }} />
          <div className="flex-1">
            <div className="text-sm font-semibold" style={{ color: C.text }}>{pendingSignals.length} signaal{pendingSignals.length !== 1 ? 'en' : ''} wachten</div>
            <div className="text-[11px]" style={{ color: C.sub }}>{pendingSignals.slice(0, 4).map((s: any) => s.asset || s.symbol).join(' · ')}{pendingSignals.length > 4 ? ` +${pendingSignals.length - 4}` : ''}</div>
          </div>
          <ChevronRight size={16} style={{ color: C.sub }} />
        </Link>
      )}

      {/* Open positions */}
      {openPositions.length > 0 && (
        <Panel title="Open posities" href="/posities">
          {openPositions.slice(0, 6).map((p: any) => {
            const pl = parseFloat(p.unrealized_pl || '0'); const pct = parseFloat(p.unrealized_plpc || '0') * 100; const u = pl >= 0;
            return (
              <Row key={p.symbol}>
                <span className="w-16 text-[13px] font-semibold" style={{ color: C.text }}>{cleanSym(p.symbol)}</span>
                <span className="flex-1 font-num text-[11px]" style={{ color: C.sub }}>{fmtUSD(parseFloat(p.market_value || '0'))}</span>
                <span className="font-num text-[13px] font-semibold" style={{ color: u ? C.up : C.down }}>{u ? '+' : ''}{fmtUSD(pl)}</span>
                <span className="w-14 text-right font-num text-[11px]" style={{ color: u ? C.up : C.down }}>{u ? '+' : ''}{pct.toFixed(2)}%</span>
              </Row>
            );
          })}
        </Panel>
      )}

      {/* Recent trades */}
      {recentTrades.length > 0 && (
        <Panel title="Recente trades" href="/posities">
          {recentTrades.map((t: any) => {
            const v = t.pnl ?? 0; const u = v >= 0;
            return (
              <Row key={t.id}>
                <span className="h-5 w-1 shrink-0 rounded-full" style={{ background: u ? C.up : C.down }} />
                <span className="w-14 text-[13px] font-semibold" style={{ color: C.text }}>{t.symbol}</span>
                <span className="flex-1 truncate text-[11px]" style={{ color: C.sub }}>{t.exit_reason?.slice(0, 40) || t.side}</span>
                <span className="font-num text-[13px] font-semibold" style={{ color: u ? C.up : C.down }}>{u ? '+' : ''}{fmtUSD(v)}</span>
              </Row>
            );
          })}
        </Panel>
      )}

      {/* Activity */}
      {recentLogs.length > 0 && (
        <Panel title="Bot activiteit" icon={<Activity size={13} style={{ color: C.sub }} />}>
          <div className="max-h-64 overflow-y-auto">
            {recentLogs.map((log: any) => (
              <Row key={log.id}>
                <span className="w-10 shrink-0 font-num text-[10px]" style={{ color: C.faint }}>
                  {new Date(log.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="flex-1 truncate text-[12px]" style={{ color: C.text }}>{log.message || log.action}</span>
                <span className="shrink-0 text-[9px] font-bold uppercase"
                  style={{ color: log.status === 'success' ? C.up : log.status === 'error' ? C.down : C.faint }}>{log.status}</span>
              </Row>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone, href }: { label: string; value: string; sub?: string; tone: string; href?: string }) {
  const inner = (
    <div className="rounded-xl p-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: C.sub }}>{label}</div>
      <div className="mt-1 font-num text-base font-bold leading-none" style={{ color: tone }}>{value}</div>
      {sub && <div className="mt-0.5 font-num text-[10px]" style={{ color: C.faint }}>{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Panel({ title, href, icon, children }: { title: string; href?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-center gap-2"><span className="text-sm font-semibold" style={{ color: C.text }}>{title}</span>{icon}</div>
        {href && <Link href={href} className="text-[11px]" style={{ color: C.gold }}>Alle →</Link>}
      </div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${C.line}` }}>{children}</div>;
}
