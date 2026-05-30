'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { AssetLabel } from '@/components/market/AssetLabel';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';

const GOK_COINS = new Set(['DOGE', 'ALGO', 'BAT', 'CRV', 'SUSHI', 'YFI', 'UNI', 'LINK', 'AVAX', 'SOL']);

const FILTER_TABS = [
  { label: 'Alles', value: 'all' },
  { label: 'Watch', value: 'watch' },
  { label: 'Paper Trade', value: 'paper_trade_only' },
  { label: 'Vermijd', value: 'avoid' },
];

const recoBadge = (r: string): any =>
  r === 'ignore' ? 'muted' :
  r === 'watch' ? 'warning' :
  r === 'blocked' ? 'danger' :
  r === 'paper_trade_only' ? 'success' : 'default';

function expiryCountdown(expiresAt: string | null): string {
  if (!expiresAt) return '';
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Verlopen';
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return hours > 0 ? `Verloopt over ${hours}u ${mins}m` : `Verloopt over ${mins}m`;
}

export default function RumourRadarPage() {
  const { data: rumours, loading, reload } = useApi(() => api.getRumours(50), []);
  const [activeFilter, setActiveFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const router = useRouter();

  const filtered = useMemo(() => {
    if (!Array.isArray(rumours)) return [];
    const all = rumours as any[];
    if (activeFilter === 'all') return all;
    if (activeFilter === 'avoid') return all.filter(r => r.recommendation === 'avoid' || r.recommendation === 'blocked' || r.recommendation === 'ignore');
    return all.filter(r => r.recommendation === activeFilter);
  }, [rumours, activeFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold">Rumour Radar</h1>
        <Button variant="outline" size="sm" onClick={reload}>Vernieuwen</Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveFilter(tab.value)}
            className={cn(
              'text-xs font-semibold px-3 py-1.5 rounded-full border transition-all',
              activeFilter === tab.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
            )}
          >
            {tab.label}
            {tab.value !== 'all' && Array.isArray(rumours) && (
              <span className="ml-1 opacity-60">
                {(rumours as any[]).filter(r =>
                  tab.value === 'avoid'
                    ? r.recommendation === 'avoid' || r.recommendation === 'blocked' || r.recommendation === 'ignore'
                    : r.recommendation === tab.value
                ).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {!loading && filtered.length === 0 && (
            <EmptyState message="Geen geruchten gevonden. Geruchten worden gedetecteerd uit nieuws en social media." />
          )}
          {filtered.map((r: any) => {
            const isExpanded = expandedId === r.id;
            const gokTarget = r.related_assets?.find((a: string) => GOK_COINS.has(a));
            const canGok = (r.recommendation === 'paper_trade_only' || r.recommendation === 'watch') && !!gokTarget;

            return (
              <div key={r.id} className="border-b border-border last:border-0">
                {/* Main row — clickable to expand */}
                <div
                  className="px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors select-none"
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">{r.title}</p>
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span>Bronnen: {r.independent_source_count}</span>
                        <span>Conf: {(r.confidence * 100).toFixed(0)}%</span>
                        <span>Risico: {(r.manipulation_risk * 100).toFixed(0)}%</span>
                        {r.expires_at && (
                          <span className="text-amber-400/80">{expiryCountdown(r.expires_at)}</span>
                        )}
                      </div>
                      {r.related_assets?.length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {r.related_assets.map((a: string) => (
                            <Badge key={a} variant="muted">
                              <AssetLabel symbol={a} compact />
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant={recoBadge(r.recommendation)}>{r.recommendation}</Badge>
                      {r.official_confirmation && <Badge variant="success">Bevestigd</Badge>}
                      {isExpanded
                        ? <ChevronUp size={13} className="text-muted-foreground mt-0.5" />
                        : <ChevronDown size={13} className="text-muted-foreground mt-0.5" />
                      }
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 pb-3 pt-0 space-y-2.5 bg-muted/10 border-t border-border/50">
                    {r.description && (
                      <p className="text-xs text-muted-foreground leading-relaxed pt-2">{r.description}</p>
                    )}
                    <div className="flex gap-2 flex-wrap items-center">
                      {r.rumour_type && (
                        <span className="text-[11px] bg-muted px-2 py-0.5 rounded font-semibold capitalize">
                          {r.rumour_type.replace(/_/g, ' ')}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        Hype: {(r.hype_velocity * 100).toFixed(0)}%
                      </span>
                      {r.created_at && (
                        <span className="text-[11px] text-muted-foreground">
                          Gevonden: {new Date(r.created_at).toLocaleString('nl-NL', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                      )}
                    </div>
                    {canGok && (
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push(`/gok?symbol=${gokTarget}`); }}
                        className="text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black px-3 py-1.5 rounded-lg transition-colors"
                      >
                        🎲 Gok hierop ({gokTarget})
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
