'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { cn, fmtUSD } from '@/lib/utils';
import { Brain, Search } from 'lucide-react';

type Tab = 'lessen' | 'regels' | 'zoeken';

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'nu';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}u`;
  return `${Math.floor(h / 24)}d`;
}

export default function AiBrainPage() {
  const [tab, setTab] = useState<Tab>('lessen');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const { toast } = useToast();

  const { data: feedback } = useApi(() => api.getAiFeedback(), [], { pollIntervalMs: 120000 });
  const { data: pendingRules, reload: reloadPending } = useApi(() => api.getPendingRules(), []);
  const { data: activeRules } = useApi(() => api.getActiveRules(), []);

  const feedbackItems: any[] = Array.isArray(feedback) ? feedback : [];
  const pending: any[] = Array.isArray(pendingRules) ? pendingRules : [];
  const active: any[] = Array.isArray(activeRules) ? activeRules : [];

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await api.searchMemory(query);
      setSearchResults(Array.isArray(r) ? r : (r ? [r] : []));
    } catch {
      toast('Zoekfout', 'error');
    }
    setSearching(false);
  }

  async function handleApprove(id: string) {
    try { await api.approveRule(id); toast('Regel goedgekeurd', 'success'); reloadPending(); }
    catch (e: any) { toast(e?.detail || 'Fout', 'error'); }
  }

  async function handleRejectRule(id: string) {
    try { await api.rejectRule(id); reloadPending(); }
    catch (e: any) { toast(e?.detail || 'Fout', 'error'); }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'lessen', label: `Lessen (${feedbackItems.length})` },
    { key: 'regels', label: `Regels (${pending.length} pending · ${active.length} actief)` },
    { key: 'zoeken', label: 'Zoeken' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-purple-500/10 flex items-center justify-center shrink-0">
          <Brain size={20} className="text-purple-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">AI Brein</h1>
          <p className="text-xs text-muted-foreground">
            {active.length} actieve regels · {feedbackItems.length} trade lessen geleerd
          </p>
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

      {/* ── Lessen ─────────────────────────────────────────────────── */}
      {tab === 'lessen' && (
        <div className="space-y-2">
          {feedbackItems.length === 0 && (
            <div className="bg-card border border-border rounded-2xl p-10 text-center text-sm text-muted-foreground">
              AI leert van elke gesloten trade. Lessen verschijnen hier zodra trades worden gesloten.
            </div>
          )}
          {feedbackItems.map((item: any, i: number) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-bold text-sm">{item.symbol || item.trade_symbol || 'Trade'}</span>
                {item.pnl !== undefined && (
                  <span className={cn('text-xs font-bold font-num', item.pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {item.pnl >= 0 ? '+' : ''}{fmtUSD(item.pnl)}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo(item.created_at)}</span>
              </div>
              {(item.lesson || item.reflection || item.feedback) && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {item.lesson || item.reflection || item.feedback}
                </p>
              )}
              {item.suggested_rule && (
                <div className="mt-2 bg-purple-500/5 border border-purple-500/20 rounded-xl p-2.5">
                  <p className="text-[11px] text-purple-400 font-semibold">Suggestie: {item.suggested_rule}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Regels ─────────────────────────────────────────────────── */}
      {tab === 'regels' && (
        <div className="space-y-4">
          {pending.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">
                Wachten op goedkeuring ({pending.length})
              </p>
              <div className="space-y-2">
                {pending.map((rule: any) => (
                  <div key={rule.id} className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4">
                    <p className="text-sm font-medium mb-1">{rule.rule_text || rule.description}</p>
                    {rule.source_trade && (
                      <p className="text-xs text-muted-foreground">Gebaseerd op trade: {rule.source_trade}</p>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => handleRejectRule(rule.id)}
                        className="flex-1 h-8 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">
                        Afwijzen
                      </button>
                      <button onClick={() => handleApprove(rule.id)}
                        className="flex-1 h-8 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors">
                        Goedkeuren
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2">
              Actieve regels ({active.length})
            </p>
            {active.length === 0 && (
              <p className="text-sm text-muted-foreground">Nog geen actieve regels</p>
            )}
            <div className="space-y-2">
              {active.map((rule: any) => (
                <div key={rule.id} className="bg-green-500/5 border border-green-500/20 rounded-xl p-3">
                  <p className="text-xs text-foreground">{rule.rule_text || rule.description}</p>
                </div>
              ))}
            </div>
          </div>

          {pending.length === 0 && active.length === 0 && (
            <div className="bg-card border border-border rounded-2xl p-10 text-center text-sm text-muted-foreground">
              Nog geen regels — AI stelt regels voor na elke trade
            </div>
          )}
        </div>
      )}

      {/* ── Zoeken ─────────────────────────────────────────────────── */}
      {tab === 'zoeken' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Zoek in AI geheugen (bijv. 'BTC setup', 'breakout les')…"
              className="flex-1 bg-card border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary"
            />
            <button onClick={handleSearch} disabled={searching}
              className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors">
              <Search size={16} className={searching ? 'animate-spin' : ''} />
            </button>
          </div>

          {searchResults.length === 0 && query && !searching && (
            <p className="text-sm text-muted-foreground text-center pt-4">Geen resultaten voor "{query}"</p>
          )}

          {searchResults.map((r: any, i: number) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                {r.type || r.category || 'Geheugen'}
              </p>
              <p className="text-sm leading-relaxed">{r.content || r.text || r.lesson || JSON.stringify(r)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
