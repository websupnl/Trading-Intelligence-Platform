'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { useToast } from '@/contexts/toast';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtDate, fmtUSD, confidenceColor, cn } from '@/lib/utils';
import { AssetLabel } from '@/components/market/AssetLabel';

const STATUS_VARIANT: Record<string, any> = {
  pending: 'warning',
  paper_traded: 'success',
  live_traded: 'success',
  rejected: 'muted',
  risk_rejected: 'danger',
  broker_error: 'danger',
  expired: 'muted',
};

export default function SignalsPage() {
  const { data: signals, loading, reload } = useApi(() => api.getSignals(100), []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'traded' | 'rejected'>('all');
  const { toast } = useToast();

  async function handlePaperTrade(id: string) {
    setActing(id);
    try {
      let result = await api.paperTradeSignal(id);
      if (result.status === 'requires_manual_approval') {
        if (!confirm('Risk check vereist bevestiging. Deze paper trade uitvoeren?')) return;
        result = await api.paperTradeSignal(id, true);
      }
      toast('✅ Trade ingediend', 'success');
      reload();
    } catch (e: any) {
      toast(`❌ ${e?.detail?.reasons?.join(', ') || e?.detail || 'Risk check mislukt'}`, 'error');
    } finally {
      setActing(null);
    }
  }

  async function handleReject(id: string) {
    setActing(id);
    try {
      await api.rejectSignal(id);
      toast('Signal afgewezen', 'info');
    } catch { /* ignore */ }
    reload();
    setActing(null);
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      await api.triggerTask('generate_signals');
      toast('⚡ Signal generatie gestart — duurt ~30s', 'info');
      setTimeout(reload, 15000);
      setTimeout(reload, 35000);
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'Generatie mislukt'}`, 'error');
    } finally {
      setGenerating(false);
    }
  }

  const filtered = (signals || []).filter((s: any) => {
    if (filter === 'pending') return s.status === 'pending';
    if (filter === 'traded') return s.status === 'paper_traded' || s.status === 'live_traded';
    if (filter === 'rejected') return s.status === 'rejected' || s.status === 'risk_rejected';
    return true;
  });

  const pendingCount = (signals || []).filter((s: any) => s.status === 'pending').length;

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-base font-semibold">
          Signals {pendingCount > 0 && (
            <span className="ml-2 text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
              {pendingCount} pending
            </span>
          )}
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={reload}>Vernieuwen</Button>
          <Button variant="success" size="sm" onClick={handleGenerate} disabled={generating}>
            {generating ? '⏳ Bezig...' : '⚡ Genereer'}
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {[
          { key: 'all', label: `Alles (${signals?.length || 0})` },
          { key: 'pending', label: `⏳ Pending (${(signals || []).filter((s: any) => s.status === 'pending').length})` },
          { key: 'traded', label: `✅ Getraded` },
          { key: 'rejected', label: `❌ Afgewezen` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key as any)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-md transition-colors',
              filter === key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {!loading && filtered.length === 0 && (
            <EmptyState message="Geen signals. Signals worden gegenereerd na nieuws- en data-analyse." />
          )}

          {filtered.map((s: any) => {
            const ai = s.ai_analysis || {};
            const isExpanded = expanded === s.id;
            const hasBullBear = ai.bull_score !== undefined;

            return (
              <div key={s.id} className="border-b border-border last:border-0">
                {/* Main row */}
                <div
                  className="px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : s.id)}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                      <AssetLabel symbol={s.asset} />
                      <Badge variant={s.direction === 'buy' ? 'success' : 'danger'}>
                        {s.direction?.toUpperCase()}
                      </Badge>
                      <span className={cn('text-sm', confidenceColor(s.confidence))}>
                        {(s.confidence * 100).toFixed(0)}%
                      </span>
                      {hasBullBear && (
                        <span className="text-xs text-muted-foreground">
                          🐂{(ai.bull_score * 100).toFixed(0)} 🐻{(ai.bear_score * 100).toFixed(0)}
                        </span>
                      )}
                      <Badge variant={STATUS_VARIANT[s.status] || 'muted'}>{s.status}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.status === 'pending' && (
                        <>
                          <Button
                            variant="success"
                            size="sm"
                            onClick={e => { e.stopPropagation(); handlePaperTrade(s.id); }}
                            disabled={acting === s.id}
                          >
                            {acting === s.id ? '...' : '📄 Trade'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={e => { e.stopPropagation(); handleReject(s.id); }}
                            disabled={acting === s.id}
                          >
                            ✕
                          </Button>
                        </>
                      )}
                      <span className="text-xs text-muted-foreground">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>
                  {!isExpanded && s.reason && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">{s.reason}</p>
                  )}
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 bg-muted/5">
                    {/* Price levels */}
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      {s.suggested_entry && <span>Entry: <span className="text-foreground font-medium">{fmtUSD(s.suggested_entry)}</span></span>}
                      {s.suggested_stop && <span>Stop: <span className="text-red-400 font-medium">{fmtUSD(s.suggested_stop)}</span></span>}
                      {s.suggested_take_profit && <span>TP: <span className="text-green-400 font-medium">{fmtUSD(s.suggested_take_profit)}</span></span>}
                      {s.risk_reward && <span>R/R: <span className="text-foreground font-medium">{s.risk_reward?.toFixed(2)}</span></span>}
                      <span>{fmtDate(s.created_at)}</span>
                    </div>

                    {/* AI reasoning */}
                    {s.reason && (
                      <div className="p-2 rounded bg-muted/30 text-xs">
                        <span className="text-primary/70 font-medium">AI Redenering: </span>{s.reason}
                      </div>
                    )}

                    {/* Bull/Bear mini */}
                    {hasBullBear && (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded border border-green-500/20 bg-green-500/5 p-2">
                          <span className="text-green-400 font-medium">🐂 Bull {(ai.bull_score * 100).toFixed(0)}%</span>
                          <p className="text-muted-foreground mt-1">{ai.bull_catalyst}</p>
                        </div>
                        <div className="rounded border border-red-500/20 bg-red-500/5 p-2">
                          <span className="text-red-400 font-medium">🐻 Bear {(ai.bear_score * 100).toFixed(0)}%</span>
                          <p className="text-muted-foreground mt-1">{ai.bear_risk}</p>
                        </div>
                      </div>
                    )}

                    {/* TA indicators */}
                    {(ai.ta_score !== undefined || ai.ta_rsi !== undefined) && (
                      <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                        {ai.ta_score !== undefined && <span>TA: {(ai.ta_score * 100).toFixed(0)}</span>}
                        {ai.ta_rsi !== undefined && <span>RSI: {ai.ta_rsi?.toFixed(0)}</span>}
                        {ai.ta_macd && <span>MACD: {ai.ta_macd}</span>}
                        {ai.ta_trend && <span>Trend: {ai.ta_trend}</span>}
                        {ai.news_count !== undefined && <span>Nieuws: {ai.news_count}</span>}
                        {ai.social_count !== undefined && <span>Social: {ai.social_count}</span>}
                      </div>
                    )}

                    {ai.key_risks && (
                      <p className="text-xs text-muted-foreground">⚠️ {ai.key_risks}</p>
                    )}
                    {ai.invalidation && (
                      <p className="text-xs text-muted-foreground">🚫 Invalidatie: {ai.invalidation}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
