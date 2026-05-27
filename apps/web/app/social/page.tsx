'use client';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtDate } from '@/lib/utils';
import { AssetLabel } from '@/components/market/AssetLabel';

export default function SocialPage() {
  const { data: posts, loading, reload } = useApi(() => api.getPosts(100), []);
  const { data: config } = useApi(() => api.configStatus(), []);

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">Social Media</h1>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Reddit Status</CardTitle></CardHeader>
          <CardContent>
            <Badge variant={config?.reddit?.configured ? 'success' : 'muted'}>{config?.reddit?.message ?? '...'}</Badge>
            {config?.reddit?.configured && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => api.fetchReddit()}>Reddit ophalen</Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>X/Twitter Status</CardTitle></CardHeader>
          <CardContent>
            <Badge variant={config?.x_twitter?.configured ? 'success' : 'muted'}>{config?.x_twitter?.message ?? '...'}</Badge>
            {config?.x_twitter?.configured && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => api.fetchX()}>X ophalen</Button>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Posts ({posts?.length ?? 0})</CardTitle>
          <Button variant="outline" size="sm" onClick={reload}>Vernieuwen</Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {!loading && (!posts || posts.length === 0) && (
            <EmptyState message="Geen posts. Reddit of X/Twitter keys invullen in .env om social monitoring te activeren." />
          )}
          {posts?.map((p: any) => (
            <div key={p.id} className="border-b border-border last:border-0 px-4 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge variant="muted">{p.platform}</Badge>
                    {p.subreddit && <span className="text-xs text-muted-foreground">r/{p.subreddit}</span>}
                    <span className="text-xs text-muted-foreground">{p.author}</span>
                  </div>
                  <p className="text-sm line-clamp-2">{p.content}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {p.tickers?.map((t: string) => <Badge key={t} variant="muted"><AssetLabel symbol={t} compact /></Badge>)}
                    {p.score && <span className="text-xs text-muted-foreground">Score: {p.score}</span>}
                  </div>
                </div>
                {p.sentiment && (
                  <Badge variant={p.sentiment === 'positive' ? 'success' : p.sentiment === 'negative' ? 'danger' : 'muted'}>
                    {p.sentiment}
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
