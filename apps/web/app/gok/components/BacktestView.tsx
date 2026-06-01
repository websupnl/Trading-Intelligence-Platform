'use client';
import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { PlayCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface BacktestResult {
  strategy: string;
  lookback_days: number;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  max_drawdown: number;
  avg_pnl_per_trade: number;
  equity_curve: { date: string; equity: number }[];
  trades: {
    asset: string;
    date: string;
    outcome: string;
    pnl_pct: number;
    pnl_eur: number;
  }[];
}

interface Props {
  strategies: { name: string; display_name: string }[];
}

export function BacktestView({ strategies }: Props) {
  const [selectedStrategy, setSelectedStrategy] = useState(strategies[0]?.name ?? '');
  const [lookbackDays, setLookbackDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState('');

  const runBacktest = async () => {
    if (!selectedStrategy) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.runGokBacktest(selectedStrategy, lookbackDays);
      setResult(data);
    } catch (e: unknown) {
      setError('Backtest fout. Probeer opnieuw.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Strategie</label>
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            className="bg-card border border-border rounded px-3 py-2 text-sm"
          >
            {strategies.map((s) => (
              <option key={s.name} value={s.name}>{s.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Periode</label>
          <select
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value))}
            className="bg-card border border-border rounded px-3 py-2 text-sm"
          >
            <option value={7}>7 dagen</option>
            <option value={30}>30 dagen</option>
            <option value={90}>90 dagen</option>
          </select>
        </div>
        <button
          onClick={runBacktest}
          disabled={loading || !selectedStrategy}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50 hover:bg-primary/90"
        >
          <PlayCircle size={16} />
          {loading ? 'Bezig...' : 'Run Backtest'}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!result && !loading && (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-lg">
          <p className="text-sm">Selecteer een strategie en klik op Run Backtest.</p>
          <p className="text-xs mt-1">De backtester replays historische data om de strategie te valideren.</p>
        </div>
      )}

      {result && (
        <div className="space-y-5">
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Win rate', value: `${(result.win_rate * 100).toFixed(0)}%`, good: result.win_rate >= 0.5 },
              { label: 'Totaal P&L', value: `€${result.total_pnl.toFixed(2)}`, good: result.total_pnl >= 0 },
              { label: 'Max drawdown', value: `${result.max_drawdown.toFixed(1)}%`, good: result.max_drawdown < 20 },
              { label: 'Gem. per trade', value: `€${result.avg_pnl_per_trade.toFixed(2)}`, good: result.avg_pnl_per_trade >= 0 },
            ].map((stat) => (
              <div key={stat.label} className="bg-card border border-border rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">{stat.label}</div>
                <div className={cn('text-xl font-bold', stat.good ? 'text-green-400' : 'text-red-400')}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          <div className="text-xs text-muted-foreground">
            {result.total_trades} trades gesimuleerd — {result.wins}W / {result.losses}L
            over {result.lookback_days} dagen voor {result.strategy.replace('_', ' ')}
          </div>

          {/* Equity curve */}
          {result.equity_curve.length > 1 && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">Equity curve (fictief €100 startkapitaal)</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={result.equity_curve}>
                  <XAxis dataKey="date" hide />
                  <YAxis domain={['auto', 'auto']} tickFormatter={(v) => `€${v.toFixed(0)}`} width={50} tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v: number) => [`€${v.toFixed(2)}`, 'Equity']}
                    labelFormatter={() => ''}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 11 }}
                  />
                  <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                  <Line
                    type="monotone"
                    dataKey="equity"
                    stroke={result.total_pnl >= 0 ? 'rgb(74 222 128)' : 'rgb(248 113 113)'}
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Recent trades */}
          {result.trades.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">Gesimuleerde trades (laatste {result.trades.length})</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {result.trades.map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-3 py-2 rounded bg-card border border-border">
                    <span className="font-medium">{t.asset}</span>
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-xs',
                      t.outcome === 'win' ? 'bg-green-500/15 text-green-400' :
                      t.outcome === 'loss' ? 'bg-red-500/15 text-red-400' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {t.outcome}
                    </span>
                    <span className={cn(t.pnl_eur >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {t.pnl_eur >= 0 ? '+' : ''}€{t.pnl_eur.toFixed(2)} ({t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
