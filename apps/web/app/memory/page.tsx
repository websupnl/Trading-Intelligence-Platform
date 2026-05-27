'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtDate } from '@/lib/utils';

export default function MemoryPage() {
  const [tab, setTab] = useState<'pending' | 'active'>('pending');
  const [query, setQuery] = useState('');
  const { data: pending, loading: pl, reload: rp } = useApi(() => api.getPendingRules(), []);
  const { data: active, loading: al } = useApi(() => api.getActiveRules(), []);

  async function approve(id: string) {
    await api.approveRule(id);
    rp();
  }
  async function reject(id: string) {
    await api.rejectRule(id);
    rp();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">Memory</h1>

      <div className="flex gap-2">
        <button onClick={() => setTab('pending')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === 'pending' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          Pending Rules {pending?.length ? `(${pending.length})` : ''}
        </button>
        <button onClick={() => setTab('active')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === 'active' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          Active Rules {active?.length ? `(${active.length})` : ''}
        </button>
      </div>

      {tab === 'pending' && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Rules (wachten op goedkeuring)</CardTitle>
            <Button variant="outline" size="sm" onClick={rp}>Vernieuwen</Button>
          </CardHeader>
          <CardContent className="p-0">
            {pl && <LoadingSpinner />}
            {!pl && (!pending || pending.length === 0) && (
              <EmptyState message="Geen pending rules. AI agents stellen regels voor na trade analyses." />
            )}
            {pending?.map((r: any) => (
              <div key={r.id} className="border-b border-border last:border-0 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="muted">{r.rule_type}</Badge>
                      <span className="text-xs text-muted-foreground">Confidence: {(r.confidence * 100).toFixed(0)}%</span>
                      <span className="text-xs text-muted-foreground">Voorgesteld door: {r.proposed_by}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="success" size="sm" onClick={() => approve(r.id)}>Goedkeuren</Button>
                    <Button variant="destructive" size="sm" onClick={() => reject(r.id)}>Afwijzen</Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {tab === 'active' && (
        <Card>
          <CardHeader><CardTitle>Active Rules</CardTitle></CardHeader>
          <CardContent className="p-0">
            {al && <LoadingSpinner />}
            {!al && (!active || active.length === 0) && (
              <EmptyState message="Geen actieve regels. Keur pending rules goed om ze hier te zien." />
            )}
            {active?.map((r: any) => (
              <div key={r.id} className="border-b border-border last:border-0 px-4 py-3">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                <div className="flex gap-2 mt-1">
                  <Badge variant="muted">{r.rule_type}</Badge>
                  <Badge variant="success">Actief</Badge>
                  <span className="text-xs text-muted-foreground">Goedgekeurd: {fmtDate(r.approved_at)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
