'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading';

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
      setTimeout(() => setTriggerResult(prev => { const n = {...prev}; delete n['all']; return n; }), 5000);
    }
  }

  const tasks = data?.tasks || [];
  const byCategory = tasks.reduce((acc: Record<string, any[]>, t: any) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold">Pipeline Control</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={reload}>Vernieuwen</Button>
          <Button variant="success" size="sm" onClick={handleTriggerAll} disabled={triggering === 'all'}>
            {triggering === 'all' ? 'Starting...' : '▶ Volledige Pipeline'}
          </Button>
        </div>
      </div>

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
              <CardTitle className={categoryColor[cat]}>{catLabels[cat]}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {catTasks.map((task: any) => (
                <div key={task.key} className="border-b border-border last:border-0 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{task.label}</span>
                        <Badge variant={categoryBadge[cat]}>{task.schedule_label}</Badge>
                        {task.is_running && (
                          <Badge variant="success" className="animate-pulse">● Actief</Badge>
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
                      {triggering === task.key ? '...' : '▶ Nu'}
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
              { key: 'ingest_news', label: '📰 Nieuws ophalen' },
              { key: 'fetch_reddit', label: '🔴 Reddit scrapen' },
              { key: 'analyze_content', label: '🤖 Analyseren' },
              { key: 'generate_signals', label: '⚡ Signalen' },
              { key: 'detect_rumours', label: '📡 Geruchten' },
              { key: 'fetch_market_data', label: '📈 Marktdata' },
              { key: 'auto_trade', label: '🤖 Auto Trade' },
              { key: 'sync_closed_trades', label: '📊 Trade Sync' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleTrigger(key)}
                disabled={triggering === key}
                className="text-xs px-3 py-2 rounded-md bg-muted border border-border hover:bg-accent transition-colors disabled:opacity-50 text-left"
              >
                {triggering === key ? '⏳ Bezig...' : triggerResult[key] || label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
