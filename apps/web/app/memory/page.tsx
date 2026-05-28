'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtDate, cn } from '@/lib/utils';

type Tab = 'lessons' | 'pending' | 'active' | 'search';

export default function MemoryPage() {
  const [tab, setTab] = useState<Tab>('lessons');
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: pending, loading: pl, reload: rp } = useApi(() => api.getPendingRules(), []);
  const { data: active, loading: al, reload: ra } = useApi(() => api.getActiveRules(), []);
  const { data: lessons, loading: ll } = useApi(() => api.searchMemory(''), []);
  const { data: searchResults, loading: sl } = useApi(
    () => searchQuery ? api.searchMemory(searchQuery) : Promise.resolve(null),
    [searchQuery]
  );

  async function approve(id: string) { await api.approveRule(id); rp(); ra(); }
  async function reject(id: string) { await api.rejectRule(id); rp(); }

  const tradeLessons = (lessons || []).filter((m: any) => m.type === 'trade_lesson');
  const otherMemory = (lessons || []).filter((m: any) => m.type !== 'trade_lesson');

  const tabs = [
    { key: 'lessons' as Tab, label: `💡 Trade Lessen${tradeLessons.length ? ` (${tradeLessons.length})` : ''}` },
    { key: 'pending' as Tab, label: `⏳ Pending Rules${pending?.length ? ` (${pending.length})` : ''}` },
    { key: 'active' as Tab, label: `✅ Active Rules${active?.length ? ` (${active.length})` : ''}` },
    { key: 'search' as Tab, label: '🔍 Zoeken' },
  ];

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <h1 className="text-base font-semibold">Memory & Leren</h1>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-md transition-colors',
              tab === key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Trade Lessen */}
      {tab === 'lessons' && (
        <Card>
          <CardHeader>
            <CardTitle>Trade Lessen van AI</CardTitle>
            <p className="text-xs text-muted-foreground">
              Na elke gesloten trade schrijft Claude een les. Klik 'Sync Trades' in Portfolio om te vullen.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {ll && <LoadingSpinner />}
            {!ll && tradeLessons.length === 0 && (
              <EmptyState message="Nog geen trade lessen. Sluit trades en sync via Portfolio pagina." />
            )}
            {tradeLessons.map((m: any) => (
              <LessonCard key={m.id} memory={m} />
            ))}
            {otherMemory.length > 0 && (
              <>
                <div className="px-4 py-2 bg-muted/20 text-xs text-muted-foreground font-medium">
                  Overige Memory Entries ({otherMemory.length})
                </div>
                {otherMemory.map((m: any) => (
                  <LessonCard key={m.id} memory={m} />
                ))}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pending rules */}
      {tab === 'pending' && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Rules</CardTitle>
            <p className="text-xs text-muted-foreground">
              Goedgekeurde risk_filter/block regels worden meegenomen in de order risk check.
            </p>
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
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <Badge variant="muted">{r.rule_type}</Badge>
                      <span className="text-xs text-muted-foreground">
                        Confidence: {(r.confidence * 100).toFixed(0)}%
                      </span>
                      <span className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="success" size="sm" onClick={() => approve(r.id)}>✓</Button>
                    <Button variant="destructive" size="sm" onClick={() => reject(r.id)}>✕</Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Active rules */}
      {tab === 'active' && (
        <Card>
          <CardHeader>
            <CardTitle>Active Rules</CardTitle>
            <p className="text-xs text-muted-foreground">
              Deze regels zijn actief in auto-trader, handmatige orders en signal paper-trades wanneer ze matchen op symbool, crypto of alle assets.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {al && <LoadingSpinner />}
            {!al && (!active || active.length === 0) && (
              <EmptyState message="Geen actieve regels. Keur pending rules goed." />
            )}
            {active?.map((r: any) => (
              <div key={r.id} className="border-b border-border last:border-0 px-4 py-3">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <Badge variant="muted">{r.rule_type}</Badge>
                  <Badge variant="success">Actief</Badge>
                  <span className="text-xs text-muted-foreground">Goedgekeurd: {fmtDate(r.approved_at)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Search */}
      {tab === 'search' && (
        <Card>
          <CardHeader><CardTitle>Doorzoek Memory</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-4">
              <input
                className="flex-1 h-9 px-3 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none"
                placeholder="Zoek op ticker, les, patroon..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && setSearchQuery(query)}
              />
              <Button variant="outline" size="sm" onClick={() => setSearchQuery(query)}>Zoek</Button>
            </div>
            {sl && <LoadingSpinner />}
            {!sl && searchResults?.length === 0 && searchQuery && (
              <EmptyState message="Geen resultaten gevonden" />
            )}
            {searchResults?.map((m: any) => (
              <LessonCard key={m.id} memory={m} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LessonCard({ memory }: { memory: any }) {
  const [expanded, setExpanded] = useState(false);

  let content: any = {};
  try {
    content = typeof memory.content === 'string' ? JSON.parse(memory.content) : {};
  } catch { }

  const pnl = content.pnl;
  const isWin = pnl !== undefined && pnl > 0;
  const isLoss = pnl !== undefined && pnl < 0;

  return (
    <div
      className="border-b border-border last:border-0 cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-sm font-medium',
              isWin ? 'text-green-400' : isLoss ? 'text-red-400' : ''
            )}>
              {memory.title}
            </span>
            {pnl !== undefined && (
              <span className={cn('text-xs', isWin ? 'text-green-400' : 'text-red-400')}>
                {isWin ? '+' : ''}{typeof pnl === 'number' ? `$${pnl.toFixed(2)}` : pnl}
              </span>
            )}
          </div>
          {!expanded && content.lesson && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{content.lesson}</p>
          )}
          <div className="flex gap-2 mt-1 flex-wrap">
            <Badge variant="muted">{memory.type}</Badge>
            {memory.tags?.slice(0, 3).map((t: string) => (
              <span key={t} className="text-xs text-muted-foreground">#{t}</span>
            ))}
            <span className="text-xs text-muted-foreground">{fmtDate(memory.created_at)}</span>
          </div>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 mt-1">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {content.lesson && (
            <div className="p-2 rounded bg-muted/30 text-xs">
              <span className="text-primary/70 font-medium">💡 Les: </span>{content.lesson}
            </div>
          )}
          {content.confidence_assessment && (
            <div className="p-2 rounded bg-muted/30 text-xs">
              <span className="text-primary/70 font-medium">📊 Confidence: </span>{content.confidence_assessment}
            </div>
          )}
          {content.next_time && (
            <div className="p-2 rounded bg-muted/30 text-xs">
              <span className="text-primary/70 font-medium">🔄 Volgende keer: </span>{content.next_time}
            </div>
          )}
          {content.rule_suggestion && (
            <div className="p-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
              📋 Regelvoorstel: {content.rule_suggestion}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
