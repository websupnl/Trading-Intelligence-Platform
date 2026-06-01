'use client';
import { useState } from 'react';
import { TrendingUp, TrendingDown, Target, ShieldAlert, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PositionUpdate } from './useGokWebSocket';

interface Position {
  id: string;
  asset: string;
  strategy_name: string;
  entry_price: number;
  current_price?: number;
  take_profit?: number;
  stop_loss?: number;
  budget_eur: number;
  pnl?: number;
  pnl_pct?: number;
  mode: string;
  opened_at?: string;
}

interface Props {
  position: Position;
  liveUpdate?: PositionUpdate;
  onClose: (id: string) => void;
  closing?: boolean;
}

export function ActivePosition({ position, liveUpdate, onClose, closing }: Props) {
  const pnl = liveUpdate?.pnl ?? position.pnl ?? 0;
  const pnlPct = liveUpdate?.pnl_pct ?? position.pnl_pct ?? 0;
  const currentPrice = liveUpdate?.current_price ?? position.current_price ?? position.entry_price;
  const isProfit = pnl >= 0;

  const tp = position.take_profit;
  const sl = position.stop_loss;

  // Progress berekening naar TP/SL
  const totalRange = tp && sl ? tp - sl : 0;
  const currentOffset = tp && sl ? currentPrice - sl : 0;
  const progressPct = totalRange > 0 ? Math.min(100, Math.max(0, (currentOffset / totalRange) * 100)) : 50;

  const openedAt = position.opened_at ? new Date(position.opened_at) : null;
  const ageMinutes = openedAt ? Math.floor((Date.now() - openedAt.getTime()) / 60000) : 0;

  return (
    <div className={cn(
      'border rounded-lg overflow-hidden',
      isProfit ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className={cn(
            'w-2 h-2 rounded-full animate-pulse',
            isProfit ? 'bg-green-400' : 'bg-red-400'
          )} />
          <span className="font-semibold">{position.asset}</span>
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-accent">
            {position.strategy_name.replace('_', ' ')}
          </span>
          {position.mode === 'paper' && (
            <span className="text-xs text-yellow-500 px-1.5 py-0.5 rounded bg-yellow-500/10">
              Paper
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={cn('text-right', isProfit ? 'text-green-400' : 'text-red-400')}>
            <div className="font-bold text-lg leading-none">
              {isProfit ? '+' : ''}€{pnl.toFixed(2)}
            </div>
            <div className="text-xs">
              {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
            </div>
          </div>
          <button
            onClick={() => onClose(position.id)}
            disabled={closing}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Sluit positie"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Prices */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
          <span className="flex items-center gap-1">
            <ShieldAlert size={10} className="text-red-400" />
            SL: {sl ? (sl > 100 ? sl.toFixed(2) : sl.toFixed(4)) : '—'}
          </span>
          <span className="font-medium text-foreground font-mono">
            {currentPrice > 100 ? currentPrice.toFixed(2) : currentPrice.toFixed(4)}
          </span>
          <span className="flex items-center gap-1">
            TP: {tp ? (tp > 100 ? tp.toFixed(2) : tp.toFixed(4)) : '—'}
            <Target size={10} className="text-green-400" />
          </span>
        </div>

        {/* Progress bar SL → Price → TP */}
        {tp && sl && (
          <div className="relative h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', isProfit ? 'bg-green-400' : 'bg-orange-400')}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <span>Entry: <span className="text-foreground font-mono">{position.entry_price > 100 ? position.entry_price.toFixed(2) : position.entry_price.toFixed(4)}</span></span>
          <span>Budget: <span className="text-foreground">€{position.budget_eur}</span></span>
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {ageMinutes}m open
          </span>
        </div>
      </div>
    </div>
  );
}
