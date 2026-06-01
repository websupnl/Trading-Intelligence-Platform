'use client';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Clock, Hand } from 'lucide-react';

interface HistoryPosition {
  id: string;
  asset: string;
  strategy_name: string;
  entry_price: number;
  current_price?: number;
  budget_eur: number;
  pnl?: number;
  pnl_pct?: number;
  mode: string;
  closed_reason?: string;
  opened_at?: string;
  closed_at?: string;
}

interface Props {
  history: HistoryPosition[];
  loading?: boolean;
}

const REASON_ICON: Record<string, React.ReactNode> = {
  tp_hit: <CheckCircle2 size={12} className="text-green-400" />,
  sl_hit: <XCircle size={12} className="text-red-400" />,
  timeout: <Clock size={12} className="text-yellow-400" />,
  manual: <Hand size={12} className="text-blue-400" />,
};

const REASON_LABEL: Record<string, string> = {
  tp_hit: 'TP geraakt',
  sl_hit: 'SL geraakt',
  timeout: 'Timeout',
  manual: 'Handmatig',
};

export function HistoryTable({ history, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 bg-card border border-border rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-sm">Nog geen gesloten gok trades.</p>
        <p className="text-xs mt-1">Start je eerste gok vanuit de Arena.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="text-left py-2 px-3">Asset</th>
            <th className="text-left py-2 px-3">Strategie</th>
            <th className="text-right py-2 px-3">Budget</th>
            <th className="text-right py-2 px-3">P&L</th>
            <th className="text-right py-2 px-3">%</th>
            <th className="text-left py-2 px-3">Reden</th>
            <th className="text-right py-2 px-3">Gesloten</th>
          </tr>
        </thead>
        <tbody>
          {history.map((p) => {
            const isProfit = (p.pnl ?? 0) >= 0;
            const closedAt = p.closed_at ? new Date(p.closed_at) : null;
            return (
              <tr key={p.id} className="border-b border-border/50 hover:bg-accent/20 transition-colors">
                <td className="py-2.5 px-3">
                  <span className="font-medium">{p.asset}</span>
                  {p.mode === 'paper' && (
                    <span className="ml-1.5 text-xs text-yellow-500/70">paper</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-xs text-muted-foreground">
                  {p.strategy_name.replace('_', ' ')}
                </td>
                <td className="py-2.5 px-3 text-right text-muted-foreground">
                  €{p.budget_eur}
                </td>
                <td className={cn('py-2.5 px-3 text-right font-medium', isProfit ? 'text-green-400' : 'text-red-400')}>
                  {isProfit ? '+' : ''}€{(p.pnl ?? 0).toFixed(2)}
                </td>
                <td className={cn('py-2.5 px-3 text-right text-xs', isProfit ? 'text-green-400' : 'text-red-400')}>
                  {isProfit ? '+' : ''}{(p.pnl_pct ?? 0).toFixed(2)}%
                </td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-1.5">
                    {REASON_ICON[p.closed_reason ?? ''] ?? null}
                    <span className="text-xs text-muted-foreground">
                      {REASON_LABEL[p.closed_reason ?? ''] ?? p.closed_reason ?? '—'}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-right text-xs text-muted-foreground">
                  {closedAt ? closedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
