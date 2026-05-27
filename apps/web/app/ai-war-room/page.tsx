'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtDate, confidenceColor, cn } from '@/lib/utils';
import { AssetLabel } from '@/components/market/AssetLabel';

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, score * 100))}%` }} />
      </div>
      <span className="text-xs tabular-nums w-8 text-right">{(score * 100).toFixed(0)}%</span>
    </div>
  );
}

function SignalDebate({ signal }: { signal: any }) {
  const [expanded, setExpanded] = useState(false);
  const ai = signal.ai_analysis || {};

  const bullScore = ai.bull_score ?? 0;
  const bearScore = ai.bear_score ?? 0;
  const bullWon = ai.bull_won ?? false;

  return (
    <div className="border-b border-border last:border-0">
      {/* Header row */}
      <button
        className="w-full text-left px-4 py-3 hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <AssetLabel symbol={signal.asset} />
            <Badge variant={signal.direction === 'buy' ? 'success' : 'danger'}>
              {signal.direction?.toUpperCase()}
            </Badge>
            <span className={cn('text-sm', confidenceColor(signal.confidence))}>
              {(signal.confidence * 100).toFixed(0)}% confidence
            </span>
            {bullScore > 0 && (
              <span className="text-xs text-green-400">🐂 {(bullScore * 100).toFixed(0)}%</span>
            )}
            {bearScore > 0 && (
              <span className="text-xs text-red-400">🐻 {(bearScore * 100).toFixed(0)}%</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={
              signal.status === 'pending' ? 'warning' :
              signal.status === 'paper_traded' ? 'success' : 'muted'
            }>{signal.status}</Badge>
            <span className="text-xs text-muted-foreground">{expanded ? '▲' : '▼'}</span>
          </div>
        </div>
        {!expanded && signal.reason && (
          <p className="text-xs text-muted-foreground mt-1 truncate">{signal.reason}</p>
        )}
      </button>

      {/* Expanded debate */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Bull vs Bear */}
          {(bullScore > 0 || bearScore > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Bull */}
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-green-400">🐂 Bull Agent</span>
                  <ScoreBar score={bullScore} color="bg-green-500" />
                </div>
                {ai.bull_catalyst && (
                  <p className="text-xs text-muted-foreground mb-2"><span className="text-green-400/80">Katalysator:</span> {ai.bull_catalyst}</p>
                )}
                {ai.bull_arguments?.length > 0 && (
                  <ul className="space-y-1">
                    {ai.bull_arguments.map((arg: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                        <span className="text-green-400 shrink-0">+</span>
                        <span>{arg}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {ai.bull_price_target && (
                  <p className="text-xs text-green-400 mt-2">Target: ${ai.bull_price_target}</p>
                )}
              </div>

              {/* Bear */}
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-red-400">🐻 Bear Agent</span>
                  <ScoreBar score={bearScore} color="bg-red-500" />
                </div>
                {ai.bear_risk && (
                  <p className="text-xs text-muted-foreground mb-2"><span className="text-red-400/80">Risico:</span> {ai.bear_risk}</p>
                )}
                {ai.bear_arguments?.length > 0 && (
                  <ul className="space-y-1">
                    {ai.bear_arguments.map((arg: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                        <span className="text-red-400 shrink-0">−</span>
                        <span>{arg}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {ai.bear_downside && (
                  <p className="text-xs text-red-400 mt-2">Downside: ${ai.bear_downside}</p>
                )}
              </div>
            </div>
          )}

          {/* Verdict */}
          <div className={cn(
            'rounded-lg border p-3',
            signal.direction === 'buy' ? 'border-green-500/30 bg-green-500/5' :
            signal.direction === 'sell' ? 'border-red-500/30 bg-red-500/5' :
            'border-border bg-muted/20'
          )}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold">⚖️ Finale Beslissing</span>
              {bullWon !== undefined && (
                <Badge variant={bullWon ? 'success' : 'danger'}>
                  {bullWon ? 'Bull won' : 'Bear won'}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{signal.reason}</p>
          </div>

          {/* TA + levels */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {ai.ta_score !== null && ai.ta_score !== undefined && (
              <div className="bg-muted/30 rounded p-2">
                <p className="text-muted-foreground">TA Score</p>
                <p className="font-medium">{(ai.ta_score * 100).toFixed(0)}%</p>
              </div>
            )}
            {ai.ta_rsi !== null && ai.ta_rsi !== undefined && (
              <div className="bg-muted/30 rounded p-2">
                <p className="text-muted-foreground">RSI</p>
                <p className={cn('font-medium', ai.ta_rsi < 30 ? 'text-green-400' : ai.ta_rsi > 70 ? 'text-red-400' : '')}>
                  {ai.ta_rsi?.toFixed(0)}
                </p>
              </div>
            )}
            {ai.ta_macd && (
              <div className="bg-muted/30 rounded p-2">
                <p className="text-muted-foreground">MACD</p>
                <p className="font-medium">{ai.ta_macd}</p>
              </div>
            )}
            {ai.ta_trend && (
              <div className="bg-muted/30 rounded p-2">
                <p className="text-muted-foreground">Trend</p>
                <p className={cn('font-medium',
                  ai.ta_trend === 'uptrend' ? 'text-green-400' :
                  ai.ta_trend === 'downtrend' ? 'text-red-400' : ''
                )}>{ai.ta_trend}</p>
              </div>
            )}
          </div>

          {/* Price levels */}
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {signal.suggested_entry && <span>Entry: <span className="text-foreground">${signal.suggested_entry?.toFixed(2)}</span></span>}
            {signal.suggested_stop && <span>Stop: <span className="text-red-400">${signal.suggested_stop?.toFixed(2)}</span></span>}
            {signal.suggested_take_profit && <span>TP: <span className="text-green-400">${signal.suggested_take_profit?.toFixed(2)}</span></span>}
            {signal.risk_reward && <span>R/R: <span className="text-foreground">{signal.risk_reward?.toFixed(2)}</span></span>}
            {ai.key_risks && <span className="w-full">Risico's: {ai.key_risks}</span>}
            {ai.invalidation && <span className="w-full">Invalidatie: {ai.invalidation}</span>}
          </div>

          <p className="text-xs text-muted-foreground">{fmtDate(signal.created_at)}</p>
        </div>
      )}
    </div>
  );
}

export default function AIWarRoomPage() {
  const { data: signals, loading, reload } = useApi(() => api.getSignals(30), []);
  const [triggering, setTriggering] = useState(false);

  async function handleGenerate() {
    setTriggering(true);
    try {
      await api.triggerTask('generate_signals');
      setTimeout(reload, 3000);
    } catch (e: any) {
      alert(e?.detail || 'Fout bij starten signaal generatie');
    } finally {
      setTriggering(false);
    }
  }

  const signalsWithDebate = (signals || []).filter((s: any) => s.ai_analysis?.bull_score !== undefined);
  const signalsWithoutDebate = (signals || []).filter((s: any) => s.ai_analysis?.bull_score === undefined);

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-base font-semibold">AI War Room</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={reload}>Vernieuwen</Button>
          <Button variant="success" size="sm" onClick={handleGenerate} disabled={triggering}>
            {triggering ? '⏳ Genereren...' : '⚡ Genereer Signalen'}
          </Button>
        </div>
      </div>

      {/* Stats */}
      {signals && signals.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Totaal Signals', value: signals.length, color: '' },
            { label: 'Met Bull/Bear Debate', value: signalsWithDebate.length, color: 'text-purple-400' },
            {
              label: 'Gemiddeld Confidence',
              value: `${(signals.reduce((a: number, s: any) => a + (s.confidence || 0), 0) / signals.length * 100).toFixed(0)}%`,
              color: ''
            },
            {
              label: 'Pending',
              value: signals.filter((s: any) => s.status === 'pending').length,
              color: 'text-yellow-400'
            },
          ].map(stat => (
            <div key={stat.label} className="bg-card rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className={cn('text-xl font-bold', stat.color)}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Signals with Bull/Bear debate */}
      {signalsWithDebate.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Bull vs Bear Debates</CardTitle>
            <Badge variant="muted">{signalsWithDebate.length} signals</Badge>
          </CardHeader>
          <CardContent className="p-0">
            {loading && <LoadingSpinner />}
            {signalsWithDebate.map((s: any) => (
              <SignalDebate key={s.id} signal={s} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Legacy signals without debate */}
      {signalsWithoutDebate.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground">Oudere Signals (zonder debate)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {signalsWithoutDebate.slice(0, 5).map((s: any) => (
              <div key={s.id} className="border-b border-border last:border-0 px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <AssetLabel symbol={s.asset} />
                  <Badge variant={s.direction === 'buy' ? 'success' : 'danger'}>{s.direction?.toUpperCase()}</Badge>
                  <span className={cn('text-sm', confidenceColor(s.confidence))}>
                    {(s.confidence * 100).toFixed(0)}%
                  </span>
                  <Badge variant="muted">{s.status}</Badge>
                </div>
                {s.reason && <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!loading && (!signals || signals.length === 0) && (
        <EmptyState message="Geen signals. Klik 'Genereer Signalen' of wacht tot de pipeline loopt." />
      )}
    </div>
  );
}
