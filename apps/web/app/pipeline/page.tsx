'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading';
import { AlertTriangle, Bot, Clock, Database, Play, RefreshCw, ShieldCheck, Zap } from 'lucide-react';

const categoryColor: Record<string, string> = {
  data: 'text-blue-400',
  ai: 'text-purple-400',
  trading: 'text-green-400',
};

const categoryBadge: Record<string, 'muted' | 'warning' | 'success'> = {
  data: 'muted',
  ai: 'warning',
  trading: 'success',
};

function fmtSchedule(sec: number) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${Math.round(sec / 3600)} uur`;
}

export default function PipelinePage() {
  const { data, loading, reload } = useApi(() => api.getPipelineStatus(), []);
  const { data: botHealth, reload: reloadBotHealth } = useApi(() => api.getBotHealth(), []);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<Record<string, string>>({});

  async function handleTrigger(key: string) {
    setTriggering(key);
    try {
      const r = await api.triggerTask(key);
      setTriggerResult(prev => ({ ...prev, [key]: `✅ ${r.message || 'Gestart'}` }));
    } catch (e: any) {
      setTriggerResult(prev => ({ ...prev, [key]: `❌ ${e?.detail || 'Fout'}` }));
    } finally {
      setTriggering(null);
      reloadBotHealth();
      setTimeout(() => setTriggerResult(prev => { const n = {...prev}; delete n[key]; return n; }), 5000);
    }
  }

  async function handleTriggerAll() {
    setTriggering('all');
    try {
      await api.triggerFullPipeline();
      setTriggerResult(prev => ({ ...prev, all: '✅ Volledige pipeline gestart' }));
    } catch (e: any) {
      setTriggerResult(prev => ({ ...prev, all: `❌ ${e?.detail || 'Fout'}` }));
    } finally {
      setTriggering(null);
      reloadBotHealth();
      setTimeout(() => setTriggerResult(prev => { const n = {...prev}; delete n['all']; return n; }), 5000);
    }
  }

  const tasks = data?.tasks || [];
  const marketSession = data?.market_session;
  const blockers: string[] = botHealth?.blockers ?? [];
  const autoTradeBlocked = !botHealth?.ready;
  const manualConfirmation = !!botHealth?.require_manual_confirmation;
  const byCategory = tasks.reduce((acc: Record<string, any[]>, t: any) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-base font-semibold">Pipeline Control</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Handmatig starten zet Celery-taken in de queue; order-uitvoering blijft door risk checks en manual confirmation heen gaan.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => { reload(); reloadBotHealth(); }}>
            <RefreshCw size={13} />
            Vernieuwen
          </Button>
          <Button variant="success" size="sm" onClick={handleTriggerAll} disabled={triggering === 'all'}>
            <Play size={13} />
            {triggering === 'all' ? 'Start...' : 'Data Pipeline'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Clock size={15} />
            Marktvenster
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {marketSession?.message || 'Marktstatus laden...'}
          </p>
          <div className="mt-2 flex gap-2 flex-wrap">
            <Badge variant={marketSession?.us_market_open ? 'success' : 'warning'}>
              {marketSession?.us_market_open ? 'US markt open' : 'US markt gesloten'}
            </Badge>
            {marketSession?.crypto_only && <Badge variant="default">Crypto-focus actief</Badge>}
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck size={15} />
            Trade-safety
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {manualConfirmation
              ? 'AI mag analyseren en signalen maken, maar auto-trade stopt door handmatige bevestiging.'
              : autoTradeBlocked
                ? 'Auto-trade is niet klaar; zie blockers hieronder.'
                : 'Auto-trade kan paper orders plaatsen als signalen en risk checks akkoord zijn.'}
          </p>
          <div className="mt-2 flex gap-2 flex-wrap">
            <Badge variant={manualConfirmation || autoTradeBlocked ? 'warning' : 'success'}>
              {manualConfirmation || autoTradeBlocked ? 'Auto-trade uit' : 'Auto-trade klaar'}
            </Badge>
            <Badge variant={botHealth?.trading_mode === 'live' ? 'danger' : 'muted'}>
              Mode: {botHealth?.trading_mode ?? '...'}
            </Badge>
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bot size={15} />
            AI-rol
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Analyse, nieuwsclassificatie, geruchten en signalen. Orders alleen via Auto Trader of handmatige knop, nooit direct vanuit chat.
          </p>
          <div className="mt-2 flex gap-2 flex-wrap">
            <Badge variant={botHealth?.anthropic_configured ? 'success' : 'warning'}>
              AI {botHealth?.anthropic_configured ? 'gekoppeld' : 'niet gekoppeld'}
            </Badge>
            {blockers.length > 0 && <Badge variant="warning">{blockers.length} blocker(s)</Badge>}
          </div>
        </div>
      </div>

      {blockers.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle size={14} />
            Auto-trade geblokkeerd
          </div>
          <p className="mt-1">{blockers.join(' | ')}</p>
        </div>
      )}

      {triggerResult['all'] && (
        <div className="p-3 rounded-md bg-card border border-border text-sm">{triggerResult['all']}</div>
      )}

      {!data?.worker_online && !loading && (
        <div className="p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
          ⚠️ Celery worker niet bereikbaar — taken worden nog steeds uitgevoerd via beat scheduler, maar live status is niet beschikbaar.
        </div>
      )}

      {loading && <LoadingSpinner />}

      {['data', 'ai', 'trading'].map(cat => {
        const catTasks = byCategory[cat] || [];
        if (!catTasks.length) return null;
        const catLabels: Record<string, string> = { data: '📊 Data Ingestie', ai: '🤖 AI Analyse', trading: '💹 Trading & Leren' };
        return (
          <Card key={cat}>
            <CardHeader>
              <CardTitle className={categoryColor[cat]}>
                {cat === 'data' && <Database size={15} />}
                {cat === 'ai' && <Bot size={15} />}
                {cat === 'trading' && <Zap size={15} />}
                {catLabels[cat]}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {catTasks.map((task: any) => (
                <div key={task.key} className="border-b border-border last:border-0 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{task.label}</span>
                        <Badge variant={categoryBadge[cat]}>{task.schedule_label}</Badge>
                        {marketSession?.crypto_only && ['fetch_market_data', 'auto_trade'].includes(task.key) && (
                          <Badge variant="warning">crypto-only nu</Badge>
                        )}
                        {task.is_running && (
                          <Badge variant="success" className="animate-pulse">Actief</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                      {triggerResult[task.key] && (
                        <p className="text-xs mt-1">{triggerResult[task.key]}</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => handleTrigger(task.key)}
                      disabled={triggering === task.key}
                    >
                      <Play size={13} />
                      {triggering === task.key ? '...' : 'Nu'}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader><CardTitle>Snelstart Acties</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { key: 'ingest_news', label: 'Nieuws ophalen' },
              { key: 'fetch_reddit', label: 'Reddit scrapen' },
              { key: 'analyze_content', label: 'AI analyseren' },
              { key: 'generate_signals', label: 'Signalen maken' },
              { key: 'detect_rumours', label: 'Geruchten vinden' },
              { key: 'fetch_market_data', label: marketSession?.crypto_only ? 'Crypto marktdata' : 'Marktdata' },
              { key: 'auto_trade', label: manualConfirmation ? 'Auto Trade (geblokkeerd)' : 'Auto Trade' },
              { key: 'sync_closed_trades', label: 'Trade Sync' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleTrigger(key)}
                disabled={triggering === key}
                className="text-xs px-3 py-2 rounded-md bg-muted border border-border hover:bg-accent transition-colors disabled:opacity-50 text-left"
              >
                {triggering === key ? 'Bezig...' : triggerResult[key] || label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
