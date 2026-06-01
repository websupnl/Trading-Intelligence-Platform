'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { cn } from '@/lib/utils';
import { Eye, Play, RefreshCw, TrendingUp, TrendingDown, Activity, ShieldAlert, Flame, Shield } from 'lucide-react';

function regimeStyle(regime?: string) {
  if (regime === 'risk_on')  return { label: 'Risk-on',  color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30',  icon: TrendingUp };
  if (regime === 'risk_off') return { label: 'Risk-off', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30',      icon: TrendingDown };
  if (regime === 'crisis')   return { label: 'Crisis',   color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30',      icon: ShieldAlert };
  return                              { label: 'Chop',    color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/30',  icon: Activity };
}

function moodStyle(mood?: string) {
  if (mood === 'agressief') return { label: 'Agressief', color: 'text-orange-400', icon: Flame };
  if (mood === 'defensief') return { label: 'Defensief', color: 'text-blue-400',   icon: Shield };
  return                             { label: 'Neutraal',  color: 'text-zinc-400',   icon: Activity };
}

function timeLabel(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function OraclePage() {
  const { toast } = useToast();
  const { data: briefData, loading, reload } = useApi(() => api.getOracleBrief(), [], { pollIntervalMs: 60000 });
  const { data: historyData, reload: reloadHistory } = useApi(() => api.getOracleHistory(10), []);
  const [running, setRunning] = useState(false);

  const brief: any = (briefData as any)?.brief || null;
  const history: any[] = Array.isArray((historyData as any)?.history) ? (historyData as any).history : [];

  const regime = regimeStyle(brief?.regime);
  const mood   = moodStyle(brief?.mood);
  const RegimeIcon = regime.icon;
  const MoodIcon   = mood.icon;

  async function runBrief() {
    setRunning(true);
    try {
      await api.runOracleBrief();
      await reload(true);
      await reloadHistory(true);
      toast('Oracle Morning Brief gegenereerd', 'success');
    } catch (e: any) {
      toast(e?.detail || 'Oracle brief mislukt', 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-purple-400" />
          <h1 className="text-lg font-semibold">Oracle</h1>
          {brief?.generated_at && (
            <span className="text-xs text-muted-foreground">
              Laatste brief: {timeLabel(brief.generated_at)}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { reload(true); reloadHistory(true); }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Ververs
          </button>
          <button
            onClick={runBrief}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-purple-600 hover:bg-purple-500 text-white font-medium disabled:opacity-50"
          >
            <Play className={cn('w-3.5 h-3.5', running && 'animate-pulse')} />
            {running ? 'Genereren...' : 'Start Morning Brief'}
          </button>
        </div>
      </div>

      {/* Status row */}
      {brief ? (
        <div className="grid grid-cols-3 gap-3">
          <div className={cn('rounded-lg border p-3', regime.bg)}>
            <div className="flex items-center gap-1.5 mb-1">
              <RegimeIcon className={cn('w-4 h-4', regime.color)} />
              <span className="text-xs text-muted-foreground">Regime</span>
            </div>
            <p className={cn('font-semibold', regime.color)}>{regime.label}</p>
          </div>
          <div className={cn('rounded-lg border p-3', 'bg-zinc-800/50 border-zinc-700')}>
            <div className="flex items-center gap-1.5 mb-1">
              <MoodIcon className={cn('w-4 h-4', mood.color)} />
              <span className="text-xs text-muted-foreground">Stemming</span>
            </div>
            <p className={cn('font-semibold', mood.color)}>{mood.label}</p>
          </div>
          <div className="rounded-lg border bg-zinc-800/50 border-zinc-700 p-3">
            <p className="text-xs text-muted-foreground mb-1">Risico budget</p>
            <p className="font-semibold text-white">{brief.risk_budget_pct ?? '-'}%</p>
            <div className="mt-1.5 h-1.5 rounded-full bg-zinc-700">
              <div
                className="h-1.5 rounded-full bg-purple-500"
                style={{ width: `${Math.min(brief.risk_budget_pct ?? 0, 100)}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-700 p-8 text-center">
          <Eye className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">Nog geen morning brief gegenereerd.</p>
          <p className="text-muted-foreground text-xs mt-1">Automatisch elke dag om 06:01 UTC, of klik Start Morning Brief.</p>
        </div>
      )}

      {/* Brief tekst */}
      {brief?.brief_text && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
          <h2 className="text-sm font-medium text-purple-400 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" /> Oracle Denkt Hardop
          </h2>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{brief.brief_text}</p>
        </div>
      )}

      {/* Kansen */}
      {brief?.kansen?.length > 0 && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-2">
          <h2 className="text-sm font-medium text-zinc-300">Kansen Vandaag</h2>
          {brief.kansen.map((k: any, i: number) => (
            <div key={i} className="flex items-start gap-3 py-2 border-t border-zinc-800 first:border-0 first:pt-0">
              <span className="font-mono font-bold text-white text-sm min-w-[48px]">{k.asset}</span>
              <div className="flex-1">
                <p className="text-sm text-zinc-300">{k.setup}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Conviction: {Math.round((k.conviction ?? 0) * 100)}% · Actie: {k.actie}
                </p>
              </div>
              <div className="w-16 h-1.5 rounded-full bg-zinc-700 mt-1.5 shrink-0">
                <div className="h-1.5 rounded-full bg-purple-500" style={{ width: `${Math.round((k.conviction ?? 0) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Key risks */}
      {brief?.key_risks?.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-1.5">
          <h2 className="text-sm font-medium text-amber-400">Risico's</h2>
          {brief.key_risks.map((r: string, i: number) => (
            <p key={i} className="text-sm text-zinc-400">· {r}</p>
          ))}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-400">Geschiedenis</h2>
          <div className="rounded-lg border border-zinc-700 divide-y divide-zinc-800">
            {history.map((h: any) => {
              const r = regimeStyle(h.regime);
              const m = moodStyle(h.mood);
              const isMorning = h.type === 'oracle_morning_brief';
              return (
                <div key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={cn('text-xs font-medium w-16 shrink-0', isMorning ? 'text-purple-400' : 'text-blue-400')}>
                    {isMorning ? 'Brief' : 'EOD'}
                  </span>
                  <span className="text-xs text-muted-foreground w-28 shrink-0">{timeLabel(h.created_at)}</span>
                  <span className={cn('text-xs', r.color)}>{r.label}</span>
                  <span className="text-zinc-700 text-xs">·</span>
                  <span className={cn('text-xs', m.color)}>{m.label}</span>
                  {h.risk_budget_pct != null && (
                    <>
                      <span className="text-zinc-700 text-xs">·</span>
                      <span className="text-xs text-zinc-400">{h.risk_budget_pct}% budget</span>
                    </>
                  )}
                  {h.dag_rating != null && (
                    <>
                      <span className="text-zinc-700 text-xs">·</span>
                      <span className="text-xs text-zinc-400">Rating {h.dag_rating}/10</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
