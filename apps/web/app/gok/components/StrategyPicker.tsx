'use client';
import { cn } from '@/lib/utils';
import { Newspaper, Users, BarChart2, CheckCircle2 } from 'lucide-react';

interface Strategy {
  name: string;
  display_name: string;
  description: string;
  atr_multiplier_tp: number;
  atr_multiplier_sl: number;
  max_trades_per_day: number;
  max_hold_hours: number;
  total_trades: number;
  wins: number;
  win_rate: number;
  total_pnl: number;
}

interface Props {
  strategies: Strategy[];
  selected: string;
  onSelect: (name: string) => void;
  loading?: boolean;
}

const STRATEGY_ICONS: Record<string, React.ReactNode> = {
  NEWS_MOMENTUM: <Newspaper size={20} />,
  HYPE_BREAKOUT: <Users size={20} />,
  TECHNICAL_SPIKE: <BarChart2 size={20} />,
};

const STRATEGY_COLORS: Record<string, string> = {
  NEWS_MOMENTUM: 'blue',
  HYPE_BREAKOUT: 'purple',
  TECHNICAL_SPIKE: 'orange',
};

export function StrategyPicker({ strategies, selected, onSelect, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-48 bg-card border border-border rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {strategies.map((s) => {
        const isSelected = selected === s.name;
        const color = STRATEGY_COLORS[s.name] || 'gray';
        const icon = STRATEGY_ICONS[s.name];
        const winRate = (s.win_rate * 100).toFixed(0);
        const rr = (s.atr_multiplier_tp / s.atr_multiplier_sl).toFixed(1);

        return (
          <button
            key={s.name}
            onClick={() => onSelect(s.name)}
            className={cn(
              'text-left border rounded-lg p-4 transition-all',
              isSelected
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border bg-card hover:border-primary/50 hover:bg-accent/30'
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center',
                color === 'blue' && 'bg-blue-500/20 text-blue-400',
                color === 'purple' && 'bg-purple-500/20 text-purple-400',
                color === 'orange' && 'bg-orange-500/20 text-orange-400',
              )}>
                {icon}
              </div>
              {isSelected && <CheckCircle2 size={16} className="text-primary" />}
            </div>

            <div className="font-semibold mb-1">{s.display_name}</div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2">
              {s.description}
            </p>

            {/* Params */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/50 rounded px-2 py-1">
                <span className="text-muted-foreground">R/R</span>
                <span className="ml-1 font-medium">{rr}x</span>
              </div>
              <div className="bg-muted/50 rounded px-2 py-1">
                <span className="text-muted-foreground">Max</span>
                <span className="ml-1 font-medium">{s.max_trades_per_day}/dag</span>
              </div>
              <div className="bg-muted/50 rounded px-2 py-1">
                <span className="text-muted-foreground">Hold</span>
                <span className="ml-1 font-medium">{s.max_hold_hours}u</span>
              </div>
              <div className="bg-muted/50 rounded px-2 py-1">
                <span className="text-muted-foreground">WR</span>
                <span className={cn(
                  'ml-1 font-medium',
                  s.total_trades === 0 ? 'text-muted-foreground' :
                  Number(winRate) >= 50 ? 'text-green-400' : 'text-red-400'
                )}>
                  {s.total_trades === 0 ? '—' : `${winRate}%`}
                </span>
              </div>
            </div>

            {s.total_trades > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                {s.total_trades} trades ·{' '}
                <span className={s.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {s.total_pnl >= 0 ? '+' : ''}€{s.total_pnl.toFixed(2)}
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
