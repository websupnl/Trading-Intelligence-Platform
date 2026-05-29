'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  AlertCircle, Bot, CheckCircle, ChevronDown, ChevronUp,
  Clock, DollarSign, Gauge, RefreshCw, Zap,
} from 'lucide-react';

// ── types ─────────────────────────────────────────────────────────────────────

interface Market {
  condition_id: string;
  question: string;
  slug: string;
  end_date: string;
  hours_left: number | null;
  volume: number;
  yes_price: number;
  no_price: number;
  yes_token_id: string;
  no_token_id: string;
  liquidity: number;
  ai_analysis?: AiAnalysis | null;
}

interface AiAnalysis {
  yes_probability: number;
  confidence: number;
  edge_direction: 'yes' | 'no' | 'skip';
  edge_size: number;
  edge: number;
  trade_recommended: boolean;
  reasoning: string;
  key_catalyst: string;
  key_risk: string;
  bull_score: number;
  bear_score: number;
  analyzed_at?: string;
}

interface Position {
  id: string;
  condition_id: string;
  market_question: string;
  side: string;
  shares: number;
  avg_price: number;
  invested_usd: number;
  current_price: number | null;
  ai_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  mode: string;
  status: string;
  pnl: number | null;
  pnl_pct: number | null;
  ai_reasoning: string | null;
  opened_at: string;
  market_end_date: string | null;
}

interface PolySettings {
  auto_trade_enabled: boolean;
  min_edge: number;
  max_per_trade: number;
  max_budget: number;
  mode: string;
  configured: boolean;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}
function fmtUsd(n: number) {
  return `$${n.toFixed(2)}`;
}
function fmtHours(h: number | null) {
  if (h === null) return '?';
  if (h < 1) return `${Math.round(h * 60)}min`;
  return `${h.toFixed(1)}u`;
}

function edgeColor(edge: number) {
  if (edge >= 0.20) return 'text-green-500';
  if (edge >= 0.10) return 'text-amber-400';
  if (edge <= -0.20) return 'text-red-500';
  if (edge <= -0.10) return 'text-red-400';
  return 'text-muted-foreground';
}

// ── MarketCard ─────────────────────────────────────────────────────────────────

function MarketCard({
  market, pmSettings, onAnalyze, analyzing,
}: {
  market: Market;
  pmSettings: PolySettings | null;
  onAnalyze: (m: Market) => void;
  analyzing: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const ai = market.ai_analysis;

  const marketYesPct = market.yes_price;
  const aiYesPct = ai?.yes_probability ?? null;
  const edge = ai?.edge ?? null;
  const tradeDir = ai?.edge_direction;
  const recommended = ai?.trade_recommended ?? false;

  const isAnalyzing = analyzing === market.condition_id;

  return (
    <div className={cn(
      'rounded-xl border bg-card transition-all duration-200',
      recommended && tradeDir === 'yes' ? 'border-green-500/50 shadow-sm shadow-green-500/10' :
      recommended && tradeDir === 'no' ? 'border-red-400/50 shadow-sm shadow-red-400/10' :
      'border-border',
    )}>
      {/* Edge indicator bar */}
      {edge !== null && (
        <div className={cn(
          'h-0.5 rounded-t-xl',
          tradeDir === 'yes' ? 'bg-green-500' : tradeDir === 'no' ? 'bg-red-400' : 'bg-muted',
        )} />
      )}

      <div className="p-3 space-y-2.5">
        {/* Question */}
        <div className="flex items-start gap-2">
          <p className="text-[11px] font-medium leading-snug flex-1">{market.question}</p>
          {recommended && (
            <span className={cn(
              'shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full font-mono',
              tradeDir === 'yes' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-400',
            )}>
              {tradeDir?.toUpperCase()}
            </span>
          )}
        </div>

        {/* Market stats */}
        <div className="grid grid-cols-4 gap-1.5 text-[10px] font-mono">
          <div className="bg-muted/30 rounded px-2 py-1.5 text-center">
            <p className="text-muted-foreground text-[9px]">Markt YES</p>
            <p className="font-bold text-foreground">{fmtPct(marketYesPct)}</p>
          </div>
          <div className={cn('rounded px-2 py-1.5 text-center', aiYesPct !== null ? 'bg-blue-500/10' : 'bg-muted/30')}>
            <p className="text-muted-foreground text-[9px]">AI YES</p>
            <p className={cn('font-bold', aiYesPct !== null ? 'text-blue-400' : 'text-muted-foreground/40')}>
              {aiYesPct !== null ? fmtPct(aiYesPct) : '—'}
            </p>
          </div>
          <div className={cn('rounded px-2 py-1.5 text-center', edge !== null ? (edge > 0 ? 'bg-green-500/10' : 'bg-red-500/10') : 'bg-muted/30')}>
            <p className="text-muted-foreground text-[9px]">Edge</p>
            <p className={cn('font-bold', edge !== null ? edgeColor(edge) : 'text-muted-foreground/40')}>
              {edge !== null ? `${edge > 0 ? '+' : ''}${fmtPct(edge)}` : '—'}
            </p>
          </div>
          <div className="bg-muted/30 rounded px-2 py-1.5 text-center">
            <p className="text-muted-foreground text-[9px]">Vol</p>
            <p className="font-bold">${(market.volume / 1000).toFixed(0)}k</p>
          </div>
        </div>

        {/* Time + volume row */}
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock size={9} />
            {fmtHours(market.hours_left)} resterend
          </span>
          <span>·</span>
          <span>NO: {fmtPct(market.no_price)}</span>
        </div>

        {/* AI reasoning expandable */}
        {ai?.reasoning && (
          <button onClick={() => setExpanded(o => !o)} className="w-full text-left">
            <p className={cn('text-[10px] text-muted-foreground leading-snug', expanded ? '' : 'line-clamp-2')}>
              {ai.reasoning}
            </p>
            {ai.key_catalyst && expanded && (
              <div className="mt-1.5 space-y-1">
                <p className="text-[9px] font-mono text-green-500">▲ {ai.key_catalyst}</p>
                {ai.key_risk && <p className="text-[9px] font-mono text-red-400">▼ {ai.key_risk}</p>}
              </div>
            )}
            <span className="text-[9px] text-muted-foreground/60 flex items-center gap-0.5 mt-0.5">
              {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
              {expanded ? 'Minder' : 'AI redenering'}
            </span>
          </button>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onAnalyze(market)}
            disabled={isAnalyzing}
            className="h-7 px-2.5 text-[10px] font-mono rounded-lg border border-border text-muted-foreground hover:text-blue-400 hover:border-blue-400/40 transition-colors disabled:opacity-40 flex items-center gap-1"
          >
            {isAnalyzing ? <Zap size={9} className="animate-spin" /> : <Bot size={9} />}
            AI Analyse
          </button>
          {recommended && (
            <span className={cn(
              'text-[9px] font-mono px-2 py-1 rounded-lg border',
              tradeDir === 'yes'
                ? 'border-green-500/40 text-green-500 bg-green-500/5'
                : 'border-red-400/40 text-red-400 bg-red-500/5',
            )}>
              Signal: {tradeDir?.toUpperCase()} | edge {ai?.edge_size ? `+${(ai.edge_size * 100).toFixed(0)}%` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── PositionRow ────────────────────────────────────────────────────────────────

function PositionRow({ pos, onClose, closing }: { pos: Position; onClose: (id: string) => void; closing: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const pnl = pos.pnl ?? 0;
  const pnlPct = pos.pnl_pct ?? 0;
  const currentPct = pos.current_price ?? pos.avg_price;
  const hoursLeft = pos.market_end_date
    ? Math.max(0, (new Date(pos.market_end_date).getTime() - Date.now()) / 3_600_000)
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium leading-snug">{pos.market_question}</p>
          <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-muted-foreground">
            <span className={cn(
              'font-bold px-1.5 py-0.5 rounded text-[9px]',
              pos.side === 'yes' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-400',
            )}>{pos.side.toUpperCase()}</span>
            <span>{pos.mode === 'paper' ? '📄' : '💰'}</span>
            {hoursLeft !== null && (
              <span className="flex items-center gap-0.5">
                <Clock size={8} /> {fmtHours(hoursLeft)}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={cn('text-xs font-mono font-bold tabular-nums', pnl >= 0 ? 'text-green-500' : 'text-red-400')}>
            {pnl >= 0 ? '+' : ''}{fmtUsd(pnl)}
          </p>
          <p className={cn('text-[9px] font-mono', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {pnlPct >= 0 ? '+' : ''}{fmtPct(pnlPct)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 text-[9px] font-mono">
        <div className="bg-muted/30 rounded px-1.5 py-1 text-center">
          <p className="text-muted-foreground">Ingezet</p>
          <p className="font-bold">{fmtUsd(pos.invested_usd)}</p>
        </div>
        <div className="bg-muted/30 rounded px-1.5 py-1 text-center">
          <p className="text-muted-foreground">Entry</p>
          <p className="font-bold">{fmtPct(pos.avg_price)}</p>
        </div>
        <div className="bg-muted/30 rounded px-1.5 py-1 text-center">
          <p className="text-muted-foreground">Huidig</p>
          <p className="font-bold">{fmtPct(currentPct)}</p>
        </div>
        <div className="bg-muted/30 rounded px-1.5 py-1 text-center">
          <p className="text-muted-foreground">Edge</p>
          <p className={cn('font-bold', edgeColor(pos.edge ?? 0))}>
            {pos.edge !== null ? `${pos.edge > 0 ? '+' : ''}${fmtPct(pos.edge)}` : '—'}
          </p>
        </div>
      </div>

      {pos.ai_reasoning && (
        <button onClick={() => setExpanded(o => !o)} className="w-full text-left">
          <p className={cn('text-[10px] text-muted-foreground leading-snug', expanded ? '' : 'line-clamp-2')}>
            {pos.ai_reasoning}
          </p>
          <span className="text-[9px] text-muted-foreground/60 flex items-center gap-0.5 mt-0.5">
            {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
          </span>
        </button>
      )}

      <button
        onClick={() => onClose(pos.id)}
        disabled={closing === pos.id}
        className="text-[9px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/40 transition-colors disabled:opacity-40"
      >
        {closing === pos.id ? '…' : 'Annuleer'}
      </button>
    </div>
  );
}

// ── SettingsPanel ──────────────────────────────────────────────────────────────

function SettingsPanel({ settings: s, onSave, saving }: {
  settings: PolySettings;
  onSave: (patch: Partial<PolySettings>) => void;
  saving: boolean;
}) {
  const [minEdge, setMinEdge] = useState(Math.round((s.min_edge_alert ?? 0.10) * 100));

  return (
    <div className="space-y-3 p-3">
      <div className={cn(
        'rounded-xl border px-4 py-3',
        s.configured ? 'border-green-500/30 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/5',
      )}>
        <p className="text-[11px] font-medium flex items-center gap-2">
          {s.configured
            ? <><CheckCircle size={12} className="text-green-500" /> API verbonden</>
            : <><AlertCircle size={12} className="text-amber-500" /> API niet geconfigureerd</>
          }
        </p>
        <p className="text-[10px] text-muted-foreground mt-1">
          Alleen data — geen orders geplaatst
        </p>
        {!s.configured && (
          <p className="text-[10px] text-amber-600 mt-1">
            Voeg POLYMARKET_API_KEY toe aan Coolify env vars.
          </p>
        )}
      </div>

      <div className="px-1">
        <p className="text-[10px] text-muted-foreground mb-1">Edge alert drempel (%)</p>
        <input
          type="number" min={5} max={50} step={1} value={minEdge}
          onChange={e => setMinEdge(+e.target.value)}
          onBlur={() => onSave({ min_edge: minEdge / 100 })}
          className="w-full h-8 rounded-md border border-border bg-card px-2 text-xs font-mono"
        />
        <p className="text-[9px] text-muted-foreground mt-1">
          Markten met edge &gt; {minEdge}% worden groen gemarkeerd
        </p>
      </div>

      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 px-3 py-2.5">
        <p className="text-[10px] text-blue-400 font-medium">Marktintelligentie actief</p>
        <p className="text-[9px] text-muted-foreground mt-0.5">
          Polymarket probabiliteiten worden automatisch meegegeven aan de signal generator als extra context.
        </p>
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function PolymarketPage() {
  const [tab, setTab] = useState<'markets' | 'history'>('markets');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const { data: history } = useApi<Position[]>(
    () => api.getPolyHistory(30) as Promise<Position[]>,
    [],
  );
  const { data: pmSettings, reload: reloadSettings } = useApi<PolySettings>(
    () => api.getPolySettings() as Promise<PolySettings>,
    [],
  );

  const loadMarkets = useCallback(async (withAnalysis = false) => {
    setLoadingMarkets(true);
    try {
      const data = await api.getPolymarkets(true, 24, 500, withAnalysis) as any;
      setMarkets(data.markets ?? []);
    } catch (e: any) {
      toast(e?.detail || 'Markten laden mislukt', 'error');
    } finally {
      setLoadingMarkets(false);
    }
  }, [toast]);

  useEffect(() => { loadMarkets(false); }, [loadMarkets]);

  async function handleAnalyze(market: Market) {
    setAnalyzing(market.condition_id);
    try {
      const analysis = await api.analyzePolymarket(market.condition_id, market) as AiAnalysis;
      setMarkets(prev => prev.map(m =>
        m.condition_id === market.condition_id ? { ...m, ai_analysis: analysis } : m
      ));
    } catch (e: any) {
      toast(e?.detail || 'Analyse mislukt', 'error');
    } finally {
      setAnalyzing(null); }
  }

  async function handleSaveSettings(patch: Partial<PolySettings>) {
    setSaving(true);
    try {
      await api.updatePolySettings(patch);
      await reloadSettings();
    } catch (e: any) {
      toast(e?.detail || 'Opslaan mislukt', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh() {
    try {
      await api.triggerPolyScan();
      toast('Data refresh getriggerd', 'success');
    } catch { /* ignore */ }
  }

  const recommendedMarkets = markets.filter(m => m.ai_analysis?.trade_recommended);

  return (
    <div className="flex flex-col gap-4 p-4 max-w-7xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Gauge size={20} className="text-blue-400" />
          <div>
            <h1 className="text-lg font-bold">Polymarket Intelligence</h1>
            <p className="text-[11px] text-muted-foreground">Voorspellingsmarkt data · AI kansanalyse · geen trading</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="muted" className="font-mono text-blue-400">DATA ONLY</Badge>
        </div>
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div className="flex gap-4">
        {/* Left: settings */}
        <div className="w-64 shrink-0">
          <Card>
            <CardHeader className="pb-0 pt-3 px-3">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Instellingen
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pmSettings && (
                <SettingsPanel
                  settings={pmSettings as unknown as PolySettings}
                  onSave={handleSaveSettings}
                  saving={saving}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: markets/positions/history */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Tabs + actions */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex border border-border rounded-lg overflow-hidden text-[11px] font-mono">
              {(['markets', 'history'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    'px-3 py-1.5 font-medium capitalize transition-colors',
                    tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  {t === 'markets' ? `Markten (${markets.length})` : 'Historie'}
                </button>
              ))}
            </div>
            {tab === 'markets' && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1"
                  onClick={() => loadMarkets(true)}
                  disabled={loadingMarkets}
                >
                  {loadingMarkets ? <RefreshCw size={11} className="animate-spin" /> : <Bot size={11} />}
                  AI analyseer alles
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1"
                  onClick={() => loadMarkets(false)}
                  disabled={loadingMarkets}
                >
                  <RefreshCw size={11} className={loadingMarkets ? 'animate-spin' : ''} />
                  Vernieuwen
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={handleRefresh}>
                  <RefreshCw size={11} /> Refresh cache
                </Button>
              </div>
            )}
          </div>

          {/* Markets tab */}
          {tab === 'markets' && (
            <div>
              {recommendedMarkets.length > 0 && (
                <p className="text-[10px] font-mono text-amber-400 font-bold uppercase tracking-wider mb-2">
                  ⚡ {recommendedMarkets.length} markt{recommendedMarkets.length > 1 ? 'en' : ''} met edge
                </p>
              )}
              {loadingMarkets && markets.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <RefreshCw size={20} className="animate-spin mr-2" />
                  <span className="text-sm">Markten laden…</span>
                </div>
              ) : markets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Gauge size={32} className="opacity-20" />
                  <p className="text-sm">Geen actieve crypto markten gevonden</p>
                  <p className="text-[10px]">Polymarket heeft mogelijk weinig crypto markten &lt; 24u</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {/* Recommended first */}
                  {[...markets].sort((a, b) => {
                    const aRec = a.ai_analysis?.trade_recommended ? 1 : 0;
                    const bRec = b.ai_analysis?.trade_recommended ? 1 : 0;
                    if (aRec !== bRec) return bRec - aRec;
                    return (b.ai_analysis?.edge_size ?? 0) - (a.ai_analysis?.edge_size ?? 0);
                  }).map(m => (
                    <MarketCard
                      key={m.condition_id}
                      market={m}
                      pmSettings={pmSettings as unknown as PolySettings ?? null}
                      onAnalyze={handleAnalyze}
                      analyzing={analyzing}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* History tab */}
          {tab === 'history' && (
            <div className="space-y-2">
              {!history || (history as Position[]).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <p className="text-sm">Geen gesloten posities</p>
                </div>
              ) : (
                (history as Position[]).map(p => (
                  <div key={p.id} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium leading-snug truncate">{p.market_question}</p>
                        <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-muted-foreground">
                          <span className={cn(
                            'font-bold px-1.5 py-0.5 rounded text-[9px]',
                            p.side === 'yes' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-400',
                          )}>{p.side.toUpperCase()}</span>
                          <Badge variant={p.status === 'resolved_won' ? 'success' : p.status === 'resolved_lost' ? 'destructive' : 'muted'}>
                            {p.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn('text-xs font-mono font-bold', (p.pnl ?? 0) >= 0 ? 'text-green-500' : 'text-red-400')}>
                          {(p.pnl ?? 0) >= 0 ? '+' : ''}{fmtUsd(p.pnl ?? 0)}
                        </p>
                        <p className="text-[9px] font-mono text-muted-foreground">{fmtUsd(p.invested_usd)} ingezet</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
