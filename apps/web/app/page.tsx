'use client';

import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { cn, fmtUSD } from '@/lib/utils';
import Link from 'next/link';
import { Zap, Activity, Radio, BarChart2, Cpu, ArrowRight, Dice5, TrendingUp, TrendingDown } from 'lucide-react';

function fmt(p: number): string {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}

// Alpaca returns 'ETHUSD', 'BTC/USD' — normalize to 'ETH', 'BTC'
function cleanSym(s: string): string {
  return (s || '').split('/')[0].replace(/USD[CT]?$/, '');
}

function StatCard({ label, value, sub, color, href }: {
  label: string; value: string; sub?: string; color?: string; href?: string;
}) {
  const inner = (
    <div className={cn(
      'bg-card border border-border rounded-xl p-4 transition-all',
      href && 'hover:border-primary/40 hover:shadow-md cursor-pointer',
    )}>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className={cn('text-2xl font-bold font-num tabular-nums', color ?? 'text-foreground')}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function QuickLink({ href, icon, label, desc, badge }: {
  href: string; icon: React.ReactNode; label: string; desc: string; badge?: string;
}) {
  return (
    <Link href={href} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all group">
      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-accent transition-colors">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{label}</p>
          {badge && <span className="text-[9px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{badge}</span>}
        </div>
        <p className="text-xs text-muted-foreground truncate">{desc}</p>
      </div>
      <ArrowRight size={14} className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
    </Link>
  );
}

export default function Dashboard() {
  const { data: status } = useApi(() => api.apiStatus(), []);
  const { data: bot } = useApi(() => api.getBotHealth(), []);
  const { data: account } = useApi(() => api.getAccount(), [], { pollIntervalMs: 15000 });
  const { data: positions } = useApi(() => api.getPositions(), [], { pollIntervalMs: 15000 });
  const { data: signals } = useApi(() => api.getSignals(20), [], { pollIntervalMs: 30000 });

  const equity = account?.equity ? parseFloat(account.equity) : null;
  const buyingPower = account?.buying_power ? parseFloat(account.buying_power) : null;
  const lastEquity = account?.last_equity ? parseFloat(account.last_equity) : null;
  const dayPnl = equity !== null && lastEquity !== null ? equity - lastEquity : null;

  const openPositions = Array.isArray(positions) ? positions : [];
  const pendingSignals = (Array.isArray(signals) ? signals : []).filter((s: any) => s.status === 'pending');
  const totalPnl = openPositions.reduce((sum: number, p: any) => sum + parseFloat(p.unrealized_pl ?? '0'), 0);

  const aiPaused = bot?.ai_guard?.paused;
  const crypto247 = (bot as any)?.crypto_session?.crypto_24_7_enabled;
  const tradingMode = status?.trading_mode ?? 'paper';

  return (
    <div className="space-y-5 max-w-5xl mx-auto">

      {/* Status bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className={cn('flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border', aiPaused ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-green-500/30 bg-green-500/10 text-green-400')}>
          <span className={cn('w-1.5 h-1.5 rounded-full', aiPaused ? 'bg-red-400' : 'bg-green-400 animate-pulse')} />
          AI {aiPaused ? 'gepauzeerd' : 'actief'}
        </div>
        <div className={cn('flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border', tradingMode === 'paper' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-green-500/30 bg-green-500/10 text-green-400')}>
          {tradingMode === 'paper' ? '📄 Paper' : '💰 Live'}
        </div>
        {crypto247 && (
          <div className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400">
            🌙 24/7
          </div>
        )}
        {pendingSignals.length > 0 && (
          <Link href="/live" className="ml-auto flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors border border-amber-500/20">
            <Zap size={11} className="animate-pulse" />
            {pendingSignals.length} signaal{pendingSignals.length > 1 ? 'en' : ''} — handel nu
          </Link>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Portfolio" value={equity !== null ? fmtUSD(equity) : '—'} sub={buyingPower !== null ? `${fmtUSD(buyingPower)} vrij` : undefined} href="/live" />
        <StatCard label="Vandaag" value={dayPnl !== null ? `${dayPnl >= 0 ? '+' : ''}${fmtUSD(dayPnl)}` : '—'} color={dayPnl !== null ? (dayPnl >= 0 ? 'text-green-400' : 'text-red-400') : undefined} />
        <StatCard label="Posities" value={String(openPositions.length)} sub={openPositions.length > 0 ? `${totalPnl >= 0 ? '+' : ''}${fmtUSD(totalPnl)}` : 'Geen open'} color={openPositions.length > 0 ? (totalPnl >= 0 ? 'text-green-400' : 'text-red-400') : 'text-muted-foreground'} href="/live" />
        <StatCard label="Signalen" value={String(pendingSignals.length)} sub={pendingSignals.length > 0 ? 'Wachten op actie' : 'Geen actief'} color={pendingSignals.length > 0 ? 'text-amber-400' : 'text-muted-foreground'} href="/signals" />
      </div>

      {/* Open positions */}
      {openPositions.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold">Open Posities</p>
            <Link href="/live" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              Alles bekijken <ArrowRight size={11} />
            </Link>
          </div>
          {openPositions.slice(0, 5).map((pos: any, i: number) => {
            const pnl = parseFloat(pos.unrealized_pl ?? '0');
            const pct = parseFloat(pos.unrealized_plpc ?? '0') * 100;
            const sym = cleanSym(pos.symbol);
            const entry = parseFloat(pos.avg_entry_price ?? '0');
            return (
              <div key={i} className={cn('flex items-center gap-3 px-4 py-2.5 border-b border-border/40 last:border-0', pnl >= 0 ? 'hover:bg-green-500/5' : 'hover:bg-red-500/5')}>
                <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0 text-[10px] font-bold">
                  {sym.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{sym}</p>
                  <p className="text-[10px] text-muted-foreground font-num">Entry ${fmt(entry)}</p>
                </div>
                <div className="text-right">
                  <p className={cn('text-sm font-bold font-num', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
                  </p>
                  <p className={cn('text-[10px] font-num', pct >= 0 ? 'text-green-400/70' : 'text-red-400/70')}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending signals */}
      {pendingSignals.length > 0 && (
        <div className="bg-card border border-amber-500/20 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Zap size={14} className="text-amber-400" /> Actieve Signalen
            </p>
            <Link href="/live" className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors">
              Handel nu <ArrowRight size={11} />
            </Link>
          </div>
          {pendingSignals.slice(0, 3).map((sig: any) => (
            <div key={sig.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 last:border-0">
              <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full shrink-0', sig.direction === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
                {sig.direction === 'buy' ? '▲' : '▼'} {sig.asset}
              </span>
              <span className="text-xs text-muted-foreground">{(sig.confidence * 100).toFixed(0)}% conf</span>
              <span className="text-xs text-muted-foreground ml-auto font-num">
                {sig.suggested_entry ? `$${fmt(sig.suggested_entry)}` : ''}
                {sig.risk_reward ? ` · R/R ${sig.risk_reward.toFixed(1)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Quick links */}
      <div>
        <p className="text-xs font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Snel navigeren</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <QuickLink href="/live" icon={<Activity size={16} className="text-green-400" />} label="Live Sessie" desc="Realtime markt, grafieken en posities" badge="LIVE" />
          <QuickLink href="/gok" icon={<Dice5 size={16} className="text-amber-400" />} label="Gok Modus" desc="High-risk meme coin plays — jij bepaalt de inzet" />
          <QuickLink href="/signals" icon={<Zap size={16} className="text-amber-400" />} label="Alle Signalen" desc="Overzicht van alle AI-gegenereerde signalen" />
          <QuickLink href="/crypto-session" icon={<Radio size={16} className="text-blue-400" />} label="Crypto Sessie" desc="24/7 modus beheren en sessie starten" />
          <QuickLink href="/ai-war-room" icon={<BarChart2 size={16} className="text-purple-400" />} label="AI War Room" desc="Bull vs Bear debat, geheugen en lessen" />
          <QuickLink href="/pipeline" icon={<Cpu size={16} className="text-muted-foreground" />} label="Pipeline Status" desc="Nieuwsingest, signalen, trades — alles live" />
        </div>
      </div>

    </div>
  );
}
