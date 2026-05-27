'use client';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtDate, fmtUSD, confidenceColor, cn } from '@/lib/utils';

export default function SignalsPage() {
  const { data: signals, loading, reload } = useApi(() => api.getSignals(50), []);

  async function handlePaperTrade(id: string) {
    await api.paperTradeSignal(id).catch(e => alert(e?.detail?.reasons?.join(', ') || 'Risk check mislukt'));
    reload();
  }

  async function handleReject(id: string) {
    await api.rejectSignal(id);
    reload();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">Signals</h1>
      <Card>
        <CardHeader>
          <CardTitle>Actieve Signals</CardTitle>
          <Button variant="outline" size="sm" onClick={reload}>Vernieuwen</Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {!loading && (!signals || signals.length === 0) && <EmptyState message="Geen signals. Signals worden gegenereerd na nieuws- en data-analyse." />}
          {signals?.map((s: any) => (
            <div key={s.id} className="border-b border-border last:border-0 px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{s.asset}</span>
                  <Badge variant={s.direction === 'buy' ? 'success' : 'danger'}>{s.direction?.toUpperCase()}</Badge>
                  <span className={cn('text-sm', confidenceColor(s.confidence))}>
                    {(s.confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
                <div className="flex gap-2">
                  {s.status === 'pending' && (
                    <>
                      <Button variant="success" size="sm" onClick={() => handlePaperTrade(s.id)}>Paper Trade</Button>
                      <Button variant="outline" size="sm" onClick={() => handleReject(s.id)}>Afwijzen</Button>
                    </>
                  )}
                  <Badge variant={s.status === 'pending' ? 'warning' : s.status === 'paper_traded' ? 'success' : 'muted'}>{s.status}</Badge>
                </div>
              </div>
              {s.reason && <p className="text-xs text-muted-foreground">{s.reason}</p>}
              <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                {s.suggested_entry && <span>Entry: {fmtUSD(s.suggested_entry)}</span>}
                {s.suggested_stop && <span>Stop: {fmtUSD(s.suggested_stop)}</span>}
                {s.suggested_take_profit && <span>TP: {fmtUSD(s.suggested_take_profit)}</span>}
                {s.risk_reward && <span>R/R: {s.risk_reward?.toFixed(2)}</span>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
