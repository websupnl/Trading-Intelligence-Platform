'use client';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { AssetLabel } from '@/components/market/AssetLabel';

const recoBadge = (r: string) => r === 'ignore' ? 'muted' : r === 'watch' ? 'warning' : r === 'blocked' ? 'danger' : r === 'paper_trade_only' ? 'success' : 'default' as any;

export default function RumourRadarPage() {
  const { data: rumours, loading, reload } = useApi(() => api.getRumours(50), []);

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">Rumour Radar</h1>
      <Card>
        <CardHeader>
          <CardTitle>Actieve Geruchten</CardTitle>
          <Button variant="outline" size="sm" onClick={reload}>Vernieuwen</Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {!loading && (!rumours || rumours.length === 0) && (
            <EmptyState message="Geen actieve geruchten. Geruchten worden gedetecteerd uit nieuws en social media." />
          )}
          {rumours?.map((r: any) => (
            <div key={r.id} className="border-b border-border last:border-0 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-sm font-medium">{r.title}</p>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                    <span>Bronnen: {r.independent_source_count}</span>
                    <span>Confidence: {(r.confidence * 100).toFixed(0)}%</span>
                    <span>Manipulatierisico: {(r.manipulation_risk * 100).toFixed(0)}%</span>
                    <span>Hype: {(r.hype_velocity * 100).toFixed(0)}%</span>
                  </div>
                  {r.related_assets?.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {r.related_assets.map((a: string) => (
                        <Badge key={a} variant="muted"><AssetLabel symbol={a} compact /></Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={recoBadge(r.recommendation)}>{r.recommendation}</Badge>
                  {r.official_confirmation && <Badge variant="success">Officieel bevestigd</Badge>}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
