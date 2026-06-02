'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { fmtPrice } from '@/lib/utils';
import { TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';

const C = {
  panel: '#12161c', panel2: '#171c24', line: '#1e2630',
  text: '#eaeef3', sub: '#7a8694', faint: '#4a5563',
  up: '#2ebd85', down: '#f6465d', gold: '#f0b90b',
};
type Tab = 'pending' | 'traded' | 'rejected' | 'debate';

export default function SignalsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();

  const { data: signals, reload } = useApi(() => api.getSignals(200), [], { pollIntervalMs: 60000 });
  const { data: status } = useApi(() => api.apiStatus(), []);

  const all: any[] = Array.isArray(signals) ? signals : [];
  const pending = all.filter(s => !s.status || s.status === 'pending');
  const traded = all.filter(s => s.status === 'paper_traded' || s.status === 'live_traded');
  const rejected = all.filter(s => s.status === 'rejected');
  const withDebate = all.filter(s => s.bull_case || s.bear_case);
  const regime: string = (status as any)?.market_regime || 'unknown';

  async function generate(type: 'swing' | 'scalp') {
    setGenerating(true);
    try {
      await api.triggerTask(type === 'swing' ? 'generate_signals' : 'generate_scalp_signals');
      toast(`${type === 'swing' ? 'Swing' : 'Scalp'} signalen worden gegenereerd…`, 'info');
      setTimeout(reload, 10000);
    } catch (e: any) { toast(e?.detail || 'Genereren mislukt', 'error'); }
    setGenerating(false);
  }
  async function paperTrade(id: string, sym: string) {
    try { await api.paperTradeSignal(id); toast(`📈 ${sym} paper trade geplaatst`, 'success'); reload(); }
    catch (e: any) {
      if (e?.status === 409) { try { await api.paperTradeSignal(id, true); toast(`📈 ${sym} bevestigd`, 'success'); reload(); } catch { toast('Bevestiging mislukt', 'error'); } }
      else toast(e?.detail || 'Trade mislukt', 'error');
    }
  }
  async function reject(id: string) { try { await api.rejectSignal(id); reload(); } catch (e: any) { toast(e?.detail || 'Afwijzen mislukt', 'error'); } }

  const list = tab === 'pending' ? pending : tab === 'traded' ? traded : tab === 'rejected' ? rejected : withDebate;
  const TABS: [Tab, string][] = [['pending', `Pending ${pending.length}`], ['traded', `Verhandeld ${traded.length}`], ['rejected', `Afgewezen ${rejected.length}`], ['debate', 'Bull vs Bear']];
  const regimeTone = regime === 'bull' ? C.up : regime === 'bear' ? C.down : C.gold;

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
          style={{ background: regimeTone + '1a', color: regimeTone }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: regimeTone }} />
          {regime === 'bull' ? 'Bull' : regime === 'bear' ? 'Bear' : 'Ranging'} regime
        </span>
        <div className="flex gap-2">
          <button onClick={() => generate('scalp')} disabled={generating}
            className="h-8 rounded-lg px-3 text-xs font-bold disabled:opacity-50"
            style={{ background: C.panel2, color: C.sub, border: `1px solid ${C.line}` }}>Scalp</button>
          <button onClick={() => generate('swing')} disabled={generating}
            className="h-8 rounded-lg px-3 text-xs font-bold disabled:opacity-50"
            style={{ background: C.gold, color: '#221a00' }}>{generating ? '…' : '⚡ Swing'}</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="flex-1 rounded-lg py-1.5 text-xs font-semibold"
            style={{ background: tab === k ? C.panel2 : 'transparent', color: tab === k ? C.text : C.sub,
                     borderBottom: tab === k ? `2px solid ${C.gold}` : '2px solid transparent' }}>{label}</button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-2.5">
        {list.length === 0 && (
          <div className="rounded-2xl p-10 text-center text-sm" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.faint }}>
            {tab === 'pending' ? 'Geen pending signalen — klik Swing of Scalp om te genereren' : 'Geen signalen'}
          </div>
        )}
        {tab !== 'debate' && list.map((s: any) => <SignalCard key={s.id} s={s} isPending={tab === 'pending'} onTrade={paperTrade} onReject={reject} />)}
        {tab === 'debate' && list.map((s: any) => <DebateCard key={s.id} s={s} isPending={!s.status || s.status === 'pending'} onTrade={paperTrade} />)}
      </div>
    </div>
  );
}

function SignalCard({ s, isPending, onTrade, onReject }: { s: any; isPending: boolean; onTrade: (id: string, sym: string) => void; onReject: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const isBuy = ['buy', 'long'].includes((s.side || s.direction || '').toLowerCase());
  const conf = Math.round((s.confidence || 0) * 100);
  const rr = s.risk_reward || 0;
  const sym = s.asset || s.symbol;
  const dir = isBuy ? C.up : C.down;
  const confTone = conf >= 70 ? C.up : conf >= 55 ? C.gold : C.down;

  return (
    <div className="overflow-hidden rounded-xl" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <button className="w-full p-3.5 text-left" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: dir + '1a' }}>
            {isBuy ? <TrendingUp size={16} style={{ color: dir }} /> : <TrendingDown size={16} style={{ color: dir }} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-bold" style={{ color: C.text }}>{sym}</span>
              <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: dir + '1a', color: dir }}>{isBuy ? 'LONG' : 'SHORT'}</span>
              {s.signal_type && <span className="text-[10px]" style={{ color: C.faint }}>{s.signal_type}</span>}
            </div>
            <div className="flex items-center gap-2.5 font-num text-[11px]">
              <span style={{ color: C.sub }}>Entry {fmtPrice(s.entry_price || s.suggested_entry)}</span>
              <span style={{ color: C.up }}>TP {fmtPrice(s.take_profit)}</span>
              <span style={{ color: C.down }}>SL {fmtPrice(s.stop_loss)}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-num text-sm font-bold" style={{ color: confTone }}>{conf}%</div>
            <div className="font-num text-[10px]" style={{ color: C.gold }}>R/R {rr.toFixed(1)}</div>
          </div>
          <ChevronDown size={14} style={{ color: C.faint, transform: open ? 'rotate(180deg)' : 'none' }} />
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full" style={{ background: C.line }}>
          <div className="h-full rounded-full" style={{ width: `${conf}%`, background: confTone }} />
        </div>
      </button>

      {open && (
        <div className="space-y-1.5 px-3.5 pb-3 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
          {s.reason && <p className="text-xs leading-relaxed" style={{ color: C.sub }}>{s.reason}</p>}
          {s.bull_case?.catalysts?.length > 0 && <p className="text-xs" style={{ color: C.up }}>▲ {(s.bull_case.catalysts as string[]).slice(0, 2).join(' · ')}</p>}
          {s.bear_case?.risks?.length > 0 && <p className="text-xs" style={{ color: C.down }}>▼ {(s.bear_case.risks as string[]).slice(0, 2).join(' · ')}</p>}
        </div>
      )}

      {isPending && (
        <div className="grid grid-cols-2 gap-2 px-3.5 pb-3.5 pt-1">
          <button onClick={() => onReject(s.id)} className="h-9 rounded-lg text-sm font-medium"
            style={{ background: C.panel2, color: C.sub, border: `1px solid ${C.line}` }}>Afwijzen</button>
          <button onClick={() => onTrade(s.id, sym)} className="h-9 rounded-lg text-sm font-bold"
            style={{ background: dir, color: '#06231a' }}>Paper trade</button>
        </div>
      )}
    </div>
  );
}

function DebateCard({ s, isPending, onTrade }: { s: any; isPending: boolean; onTrade: (id: string, sym: string) => void }) {
  const bull = s.bull_case || {}; const bear = s.bear_case || {};
  const verdict: string = s.verdict || s.final_verdict || '';
  const bullWins = verdict.toLowerCase().includes('bull') || verdict.toLowerCase().includes('buy');
  const sym = s.asset || s.symbol;
  return (
    <div className="overflow-hidden rounded-xl" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between p-3.5" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div><div className="font-bold" style={{ color: C.text }}>{sym}</div><div className="text-xs" style={{ color: C.faint }}>{s.signal_type}</div></div>
        {verdict && <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: (bullWins ? C.up : C.down) + '1a', color: bullWins ? C.up : C.down }}>{bullWins ? '▲ Bull wint' : '▼ Bear wint'}</span>}
      </div>
      <div className="grid grid-cols-2">
        <div className="space-y-1.5 p-3" style={{ borderRight: `1px solid ${C.line}` }}>
          <div className="mb-1.5 text-xs font-bold" style={{ color: C.up }}>▲ Bull</div>
          {((bull.catalysts || []) as string[]).slice(0, 3).map((c, i) => <p key={i} className="text-[11px]" style={{ color: C.sub }}>• {c}</p>)}
          {bull.price_target && <p className="mt-1 font-num text-xs" style={{ color: C.up }}>Target {fmtPrice(bull.price_target)}</p>}
        </div>
        <div className="space-y-1.5 p-3">
          <div className="mb-1.5 text-xs font-bold" style={{ color: C.down }}>▼ Bear</div>
          {((bear.risks || []) as string[]).slice(0, 3).map((r, i) => <p key={i} className="text-[11px]" style={{ color: C.sub }}>• {r}</p>)}
          {bear.downside_target && <p className="mt-1 font-num text-xs" style={{ color: C.down }}>Downside {fmtPrice(bear.downside_target)}</p>}
        </div>
      </div>
      {isPending && (
        <div className="px-3.5 pb-3.5 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
          <button onClick={() => onTrade(s.id, sym)} className="h-9 w-full rounded-lg text-sm font-bold" style={{ background: C.gold, color: '#221a00' }}>Paper trade</button>
        </div>
      )}
    </div>
  );
}
