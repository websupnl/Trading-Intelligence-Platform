'use client';
import { useState } from 'react';
import { TrendingUp, AlertTriangle, Target, ShieldAlert, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Opportunity } from './useGokWebSocket';

interface Props {
  opportunity: Opportunity;
  budget: number;
  onConfirm: (opp: Opportunity) => void;
  onDismiss: (opp: Opportunity) => void;
  loading?: boolean;
}

const SCORE_COLOR = (score: number) =>
  score >= 0.8 ? 'text-green-400' : score >= 0.65 ? 'text-yellow-400' : 'text-orange-400';

const SCORE_LABEL = (score: number) =>
  score >= 0.8 ? 'Sterk' : score >= 0.65 ? 'Goed' : 'Matig';

export function OpportunityCard({ opportunity: opp, budget, onConfirm, onDismiss, loading }: Props) {
  const [expanded, setExpanded] = useState(false);
  const potentialGain = ((opp.take_profit - opp.entry_price) / opp.entry_price * 100).toFixed(2);
  const potentialLoss = ((opp.entry_price - opp.stop_loss) / opp.entry_price * 100).toFixed(2);
  const riskReward = (opp.take_profit - opp.entry_price) / (opp.entry_price - opp.stop_loss);

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center">
            <span className="font-bold text-sm">{opp.asset.slice(0, 3)}</span>
          </div>
          <div>
            <div className="font-semibold">{opp.asset}</div>
            <div className="text-xs text-muted-foreground">{opp.strategy.replace('_', ' ')}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={cn('text-lg font-bold', SCORE_COLOR(opp.score))}>
            {(opp.score * 100).toFixed(0)}
            <span className="text-sm font-normal ml-1">/ 100</span>
          </div>
          <div className={cn('text-xs font-medium', SCORE_COLOR(opp.score))}>
            {SCORE_LABEL(opp.score)}
          </div>
        </div>
      </div>

      {/* Prices */}
      <div className="grid grid-cols-3 gap-0 divide-x divide-border border-b border-border">
        <div className="px-4 py-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">Entry</div>
          <div className="font-mono text-sm font-semibold">
            {opp.entry_price > 100 ? opp.entry_price.toFixed(2) : opp.entry_price.toFixed(4)}
          </div>
        </div>
        <div className="px-4 py-3 text-center">
          <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
            <Target size={10} /> TP
          </div>
          <div className="font-mono text-sm font-semibold text-green-400">
            {opp.take_profit > 100 ? opp.take_profit.toFixed(2) : opp.take_profit.toFixed(4)}
          </div>
          <div className="text-xs text-green-400">+{potentialGain}%</div>
        </div>
        <div className="px-4 py-3 text-center">
          <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
            <ShieldAlert size={10} /> SL
          </div>
          <div className="font-mono text-sm font-semibold text-red-400">
            {opp.stop_loss > 100 ? opp.stop_loss.toFixed(2) : opp.stop_loss.toFixed(4)}
          </div>
          <div className="text-xs text-red-400">-{potentialLoss}%</div>
        </div>
      </div>

      {/* Signal scores */}
      <div className="px-4 py-3 border-b border-border">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground mb-1">Nieuws</div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-400 rounded-full"
                style={{ width: `${Math.min(100, opp.news_score * 100)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="text-muted-foreground mb-1">Social</div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-400 rounded-full"
                style={{ width: `${Math.min(100, opp.social_score * 100)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="text-muted-foreground mb-1">TA</div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-400 rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, opp.ta_score) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Reason (expandable) */}
      <div className="px-4 py-3 border-b border-border">
        <p className={cn('text-xs text-muted-foreground leading-relaxed', !expanded && 'line-clamp-2')}>
          {opp.reason}
        </p>
        {opp.reason && opp.reason.length > 100 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-primary mt-1 hover:underline"
          >
            {expanded ? 'Minder' : 'Meer'}
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-xs text-muted-foreground">
          R/R: <span className="font-medium text-foreground">{riskReward.toFixed(1)}x</span>
          {' · '}Budget: <span className="font-medium text-foreground">€{budget}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onDismiss(opp)}
            className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:bg-accent"
          >
            Skip
          </button>
          <button
            onClick={() => onConfirm(opp)}
            disabled={loading}
            className="px-4 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            <Zap size={12} />
            {loading ? 'Bezig...' : `Gok €${budget}`}
          </button>
        </div>
      </div>
    </div>
  );
}
