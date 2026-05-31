'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { cn, fmtPrice } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

type Tab = 'pending' | 'traded' | 'rejected' | 'debate';

export default function SignalsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();

  const { data: signals, reload } = useApi(() => api.getSignals(200), [], { pollIntervalMs: 60000 });
  const { data: status } = useApi(() => api.apiStatus(), []);

  const allSignals: any[] = Array.isArray(signals) ? signals : [];
  const pending = allSignals.filter(s => !s.status || s.status === 'pending');
  const traded = allSignals.filter(s => s.status === 'paper_traded' || s.status === 'live_traded');
  const rejected = allSignals.filter(s => s.status === 'rejected');
  const withDebate = allSignals.filter(s => s.bull_case || s.bear_case);

  const regime: string = (status as any)?.market_regime || 'unknown';

  async function generate(type: 'swing' | 'scalp') {
    setGenerating(true);
    try {
      await api.triggerTask(type === 'swing' ? 'generate_signals' : 'generate_scalp_signals');
      toast(`${type === 'swing' ? 'Swing' : 'Scalp'} signalen worden gegenereerd…`, 'info');
      setTimeout(reload, 10000);
    } catch (e: any) {
      toast(e?.detail || 'Genereren mislukt', 'error');
    }
    setGenerating(false);
  }

  async function paperTrade(id: string, sym: string) {
    try {
      await api.paperTradeSignal(id);
      toast(`📈 ${sym} paper trade geplaatst`, 'success');
      reload();
    } catch (e: any) {
      if (e?.status === 409) {
        try { await api.paperTradeSignal(id, true); toast(`📈 ${sym} bevestigd`, 'success'); reload(); }
        catch { toast('Bevestiging mislukt', 'error'); }
      } else {
        toast(e?.detail || 'Trade mislukt', 'error');
      }
    }
  }

  async function reject(id: string) {
    try { await api.rejectSignal(id); reload(); }
    catch (e: any) { toast(e?.detail || 'Afwijzen mislukt', 'error'); }
  }

  const displayList = tab === 'pending' ? pending : tab === 'traded' ? traded : tab === 'rejected' ? rejected : withDebate;

  const TABS = [
    { key: 'pending' as Tab, label: `Pending (${pending.length})` },
    { key: 'traded' as Tab, label: `Verhandeld (${traded.length})` },
    { key: 'rejected' as Tab, label: `Afgewezen (${rejected.length})` },
    { key: 'debate' as Tab, label: 'Bull vs Bear' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Header: regime + generate buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('px-2.5 py-1 rounded-full text-xs font-bold border',
            regime === 'bull' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
            regime === 'bear' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
            'bg-amber-500/10 text-amber-400 border-amber-500/20')}>
            {regime === 'bull' ? '🐂 Bull' : regime === 'bear' ? '🐻 Bear' : '〰️ Ranging'}
          </span>
          <span className="text-xs text-muted-foreground">marktregime</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => generate('scalp')} disabled={generating}
            className="h-8 px-3 rounded-lg border border-border text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            Scalp
          </button>
          <button onClick={() => generate('swing')} disabled={generating}
            className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50">
            {generating ? '…' : '⚡ Swing'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-xl p-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors',
              tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Signal list */}
      <div className="space-y-3">
        {displayList.length === 0 && (
          <div className="bg-card border border-border rounded-2xl p-10 text-center text-sm text-muted-foreground">
            {tab === 'pending' ? 'Geen pending signalen — klik Swing of Scalp om te genereren' : 'Geen signalen'}
          </div>
        )}
        {tab !== 'debate' && displayList.map((s: any) => (
          <SignalCard key={s.id} signal={s} isPending={tab === 'pending'} onTrade={paperTrade} onReject={reject} />
        ))}
        {tab === 'debate' && displayList.map((s: any) => (
          <DebateCard key={s.id} signal={s} isPending={!s.status || s.status === 'pending'} onTrade={paperTrade} />
        ))}
      </div>
    </div>
  );
}

function SignalCard({ signal: s, isPending, onTrade, onReject }: {
  signal: any; isPending: boolean;
  onTrade: (id: string, sym: string) => void;
  onReject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isBuy = ['buy', 'long'].includes((s.side || s.direction || '').toLowerCase());
  const conf = Math.round((s.confidence || 0) * 100);
  const rr = s.risk_reward || 0;
  const sym = s.asset || s.symbol;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button className="w-full p-4 text-left" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-3">
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
            isBuy ? 'bg-green-500/10' : 'bg-red-500/10')}>
            {isBuy
              ? <TrendingUp size={16} className="text-green-400" />
              : <TrendingDown size={16} className="text-red-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="font-bold">{sym}</p>
              <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded',
                isBuy ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
                {isBuy ? 'LONG' : 'SHORT'}
              </span>
              {s.signal_type && <span className="text-[10px] text-muted-foreground">{s.signal_type}</span>}
            </div>
            <div className="flex items-center gap-2.5 text-[11px]">
              <span className="text-muted-foreground">Entry {fmtPrice(s.entry_price || s.suggested_entry)}</span>
              <span className="text-green-400">TP {fmtPrice(s.take_profit)}</span>
              <span className="text-red-400">SL {fmtPrice(s.stop_loss)}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold font-num">{conf}%</p>
            <p className="text-[10px] text-muted-foreground">R/R {rr.toFixed(1)}</p>
          </div>
        </div>
        <div className="mt-3 h-1 bg-muted rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full',
            conf >= 70 ? 'bg-green-400' : conf >= 55 ? 'bg-amber-400' : 'bg-red-400')}
            style={{ width: `${conf}%` }} />
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-border pt-3 space-y-2">
          {s.reason && <p className="text-xs text-muted-foreground leading-relaxed">{s.reason}</p>}
          {s.bull_case?.catalysts?.length > 0 && (
            <p className="text-xs text-green-400">🐂 {(s.bull_case.catalysts as string[]).slice(0, 2).join(' · ')}</p>
          )}
          {s.bear_case?.risks?.length > 0 && (
            <p className="text-xs text-red-400">🐻 {(s.bear_case.risks as string[]).slice(0, 2).join(' · ')}</p>
          )}
        </div>
      )}

      {isPending && (
        <div className="grid grid-cols-2 gap-2 px-4 pb-4 pt-1">
          <button onClick={() => onReject(s.id)}
            className="h-9 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            Afwijzen
          </button>
          <button onClick={() => onTrade(s.id, sym)}
            className="h-9 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors">
            Paper trade
          </button>
        </div>
      )}
    </div>
  );
}

function DebateCard({ signal: s, isPending, onTrade }: {
  signal: any; isPending: boolean;
  onTrade: (id: string, sym: string) => void;
}) {
  const bull = s.bull_case || {};
  const bear = s.bear_case || {};
  const verdict: string = s.verdict || s.final_verdict || '';
  const bullWins = verdict.toLowerCase().includes('bull') || verdict.toLowerCase().includes('buy');
  const sym = s.asset || s.symbol;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <p className="font-bold">{sym}</p>
          <p className="text-xs text-muted-foreground">{s.signal_type}</p>
        </div>
        {verdict && (
          <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full',
            bullWins ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
            {bullWins ? '🐂 Bull wint' : '🐻 Bear wint'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 divide-x divide-border">
        <div className="p-3 space-y-1.5">
          <p className="text-xs font-bold text-green-400 mb-1.5">🐂 Bull case</p>
          {((bull.catalysts || []) as string[]).slice(0, 3).map((c, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">• {c}</p>
          ))}
          {bull.price_target && <p className="text-xs text-green-400 font-num mt-1">Target: {fmtPrice(bull.price_target)}</p>}
        </div>
        <div className="p-3 space-y-1.5">
          <p className="text-xs font-bold text-red-400 mb-1.5">🐻 Bear case</p>
          {((bear.risks || []) as string[]).slice(0, 3).map((r, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">• {r}</p>
          ))}
          {bear.downside_target && <p className="text-xs text-red-400 font-num mt-1">Downside: {fmtPrice(bear.downside_target)}</p>}
        </div>
      </div>
      {isPending && (
        <div className="px-4 pb-4 pt-3 border-t border-border">
          <button onClick={() => onTrade(s.id, sym)}
            className="w-full h-9 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors">
            Paper trade
          </button>
        </div>
      )}
    </div>
  );
}
