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

export default function NewsPage() {
  const { data: news, loading, reload } = useApi(() => api.getNews(100), []);
  const { data: config } = useApi(() => api.configStatus(), []);
  const [ingesting, setIngesting] = useState(false);

  async function handleIngest() {
    setIngesting(true);
    try { await api.ingestNews(); reload(); } finally { setIngesting(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">Nieuws</h1>

      <div className="flex items-center gap-2 p-3 rounded-md bg-card border border-border text-sm">
        <span className="text-muted-foreground">Feeds status:</span>
        <Badge variant={config?.news_feeds?.configured ? 'success' : 'muted'}>
          {config?.news_feeds?.message ?? 'Laden...'}
        </Badge>
        <Badge variant={config?.crypto_feeds?.configured ? 'success' : 'muted'}>
          {config?.crypto_feeds?.message ?? 'Laden...'}
        </Badge>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={handleIngest} disabled={ingesting}>
            {ingesting ? 'Inlezen...' : 'Nieuws inlezen'}
          </Button>
          <Button variant="outline" size="sm" onClick={reload}>Vernieuwen</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Nieuwsitems ({news?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {!loading && (!news || news.length === 0) && (
            <EmptyState message="Geen nieuws. Klik op 'Nieuws inlezen' om feeds op te halen." />
          )}
          {news?.map((n: any) => (
            <div key={n.id} className="border-b border-border last:border-0 px-4 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noopener noreferrer"
                       className="text-sm hover:text-primary transition-colors line-clamp-1">{n.title}</a>
                  ) : (
                    <p className="text-sm line-clamp-1">{n.title}</p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{n.source}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(n.published_at)}</span>
                    {n.tickers?.slice(0, 4).map((t: string) => (
                      <Badge key={t} variant="muted">{t}</Badge>
                    ))}
                  </div>
                </div>
                {n.sentiment && (
                  <Badge variant={n.sentiment === 'positive' ? 'success' : n.sentiment === 'negative' ? 'danger' : 'muted'}>
                    {n.sentiment}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
