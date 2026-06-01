'use client';
import { Trophy, Flame, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Stats {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  best_trade_pnl: number;
  worst_trade_pnl: number;
  current_streak: number;
  daily_score: number;
  open_positions: number;
}

interface Props {
  stats: Stats | null;
  loading?: boolean;
}

export function ScoreBoard({ stats, loading }: Props) {
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-card border border-border rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  const winRate = (stats.win_rate * 100).toFixed(0);
  const isProfit = stats.total_pnl >= 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {/* Dagelijkse score */}
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Trophy size={12} className="text-yellow-400" />
          Dagelijkse score
        </div>
        <div className="text-2xl font-bold text-yellow-400">{stats.daily_score}</div>
        <div className="text-xs text-muted-foreground mt-0.5">punten vandaag</div>
      </div>

      {/* Win rate */}
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <TrendingUp size={12} />
          Win rate
        </div>
        <div className={cn('text-2xl font-bold', Number(winRate) >= 50 ? 'text-green-400' : 'text-red-400')}>
          {winRate}%
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {stats.wins}W / {stats.losses}L ({stats.total_trades} trades)
        </div>
      </div>

      {/* Totaal P&L */}
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          {isProfit ? <TrendingUp size={12} className="text-green-400" /> : <TrendingDown size={12} className="text-red-400" />}
          Totaal P&L
        </div>
        <div className={cn('text-2xl font-bold', isProfit ? 'text-green-400' : 'text-red-400')}>
          {isProfit ? '+' : ''}€{stats.total_pnl.toFixed(2)}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Best: +€{stats.best_trade_pnl.toFixed(2)}
        </div>
      </div>

      {/* Streak */}
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Flame size={12} className={stats.current_streak > 0 ? 'text-orange-400' : ''} />
          Win streak
        </div>
        <div className={cn('text-2xl font-bold', stats.current_streak > 0 ? 'text-orange-400' : 'text-muted-foreground')}>
          {stats.current_streak}x
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {stats.open_positions} open {stats.open_positions === 1 ? 'positie' : 'posities'}
        </div>
      </div>
    </div>
  );
}
