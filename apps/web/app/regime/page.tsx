'use client';

import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { cn } from '@/lib/utils';
import { Activity, RefreshCw, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';

function fmtPct(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtNum(value: unknown, digits = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}

function regimeTone(regime?: string) {
  if (regime === 'risk_on') return { label: 'Risk-on', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', icon: TrendingUp };
  if (regime === 'risk_off') return { label: 'Risk-off', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', icon: TrendingDown };
  if (regime === 'crisis') return { label: 'Crisis', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', icon: ShieldAlert };
  return { label: 'Chop', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', icon: Activity };
}

function timeLabel(value?: string): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RegimePage() {
  const { toast } = useToast();
  const { data: current, loading, reload } = useApi(() => api.getRegime(), [], { pollIntervalMs: 60000 });
  const { data: history, reload: reloadHistory } = useApi(() => api.getRegimeHistory(20), [], { pollIntervalMs: 120000 });

  const state: any = current || {};
  const metrics = state.metrics || {};
  const tone = regimeTone(state.regime);
  const Icon = tone.icon;
  const rows: any[] = Array.isArray(history) ? history : [];

  async function refresh() {
    try {
      await api.refreshRegime();
      await reload(true);
      await reloadHistory(true);
      toast('Regime bijgewerkt', 'success');
    } catch (e: any) {
      toast(e?.detail || 'Regime refresh mislukt', 'error');
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0', tone.bg)}>
            <Icon size={20} className={tone.color} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Oracle Regime</h1>
            <p className="text-xs text-muted-foreground truncate">{state.notes || 'Marktregime wordt geladen'}</p>
          </div>
        </div>
        <button onClick={refresh} disabled={loading}
          className="h-10 w-10 rounded-xl bg-card border border-border flex items-center justify-center hover:bg-accent disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className={cn('border rounded-2xl p-5', tone.bg)}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Huidig regime</p>
            <p className={cn('text-4xl font-bold', tone.color)}>{tone.label}</p>
            <p className="text-xs text-muted-foreground mt-2">Laatste update: {timeLabel(state.computed_at)}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Confidence</p>
            <p className="text-3xl font-bold font-num">{fmtNum((state.confidence || 0) * 100, 0)}%</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="VIX" value={fmtNum(state.vix, 1)} sub={state.vix && state.vix < 18 ? 'rustig' : state.vix > 25 ? 'stress' : 'neutraal'} />
        <Metric label="SPY vs EMA50" value={fmtPct(state.spy_vs_ema50)} sub={metrics.spy?.source || 'data'} good={Number(state.spy_vs_ema50) > 0} />
        <Metric label="BTC dominance" value={fmtPct(state.btc_dominance)} sub="CoinGecko" />
        <Metric label="Dollar" value={state.dollar_trend || '-'} sub={metrics.dollar?.symbol || 'DXY'} good={state.dollar_trend === 'down'} bad={state.dollar_trend === 'up'} />
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">Regime metrics</p>
        </div>
        <div className="divide-y divide-border">
          <MetricRow label="SPY vs EMA200" value={fmtPct(state.spy_vs_ema200)} detail={metrics.spy?.source || '-'} />
          <MetricRow label="HYG/LQD ratio" value={fmtNum(metrics.credit?.hyg_lqd_ratio, 4)} detail={`vs EMA50 ${fmtPct(metrics.credit?.vs_ema50)}`} />
          <MetricRow label="DXY trend 20d" value={fmtPct(metrics.dollar?.trend_pct_20d)} detail={state.dollar_trend || '-'} />
          <MetricRow label="BTC vs EMA50" value={fmtPct(metrics.btc?.vs_ema50)} detail={metrics.btc?.source || '-'} />
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">Historie</p>
        </div>
        <div className="divide-y divide-border">
          {rows.map((row) => {
            const rowTone = regimeTone(row.regime);
            return (
              <div key={row.id || row.computed_at} className="px-4 py-3 flex items-start gap-3">
                <span className={cn('mt-1 w-2 h-2 rounded-full shrink-0', row.regime === 'risk_on' ? 'bg-green-400' : row.regime === 'risk_off' || row.regime === 'crisis' ? 'bg-red-400' : 'bg-amber-400')} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className={cn('text-sm font-bold', rowTone.color)}>{rowTone.label}</p>
                    <p className="text-xs text-muted-foreground font-num shrink-0">{timeLabel(row.computed_at)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{row.notes}</p>
                </div>
                <p className="text-xs font-bold font-num shrink-0">{fmtNum((row.confidence || 0) * 100, 0)}%</p>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">Geen regime historie</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, good, bad }: { label: string; value: string; sub: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className={cn('text-xl font-bold font-num truncate', good ? 'text-green-400' : bad ? 'text-red-400' : '')}>{value}</p>
      <p className="text-xs text-muted-foreground truncate mt-1">{sub}</p>
    </div>
  );
}

function MetricRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{detail}</p>
      </div>
      <p className="font-bold font-num shrink-0">{value}</p>
    </div>
  );
}
