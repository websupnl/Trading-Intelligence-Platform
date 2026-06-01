'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { RefreshCw, Newspaper, MessageSquare, Radio } from 'lucide-react';

type Filter = 'alle' | 'nieuws' | 'social' | 'geruchten';

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'nu';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}u`;
  return `${Math.floor(h / 24)}d`;
}

export default function FeedPage() {
  const [filter, setFilter] = useState<Filter>('alle');
  const [fetching, setFetching] = useState(false);
  const { toast } = useToast();

  const { data: news, reload: reloadNews } = useApi(() => api.getNews(60), [], { pollIntervalMs: 120000 });
  const { data: posts, reload: reloadPosts } = useApi(() => api.getPosts(60), [], { pollIntervalMs: 120000 });
  const { data: rumours, reload: reloadRumours } = useApi(() => api.getRumours(60), [], { pollIntervalMs: 120000 });

  const newsItems: any[] = (Array.isArray(news) ? news : []).map((n: any) => ({ ...n, _type: 'news' }));
  const postItems: any[] = (Array.isArray(posts) ? posts : []).map((p: any) => ({ ...p, _type: 'social' }));
  const rumourItems: any[] = (Array.isArray(rumours) ? rumours : []).map((r: any) => ({ ...r, _type: 'rumour' }));

  const unified = [...newsItems, ...postItems, ...rumourItems].sort((a, b) => {
    const ta = new Date(a.published_at || a.posted_at || a.created_at || 0).getTime();
    const tb = new Date(b.published_at || b.posted_at || b.created_at || 0).getTime();
    return tb - ta;
  });

  const filtered = unified.filter(item => {
    if (filter === 'nieuws') return item._type === 'news';
    if (filter === 'social') return item._type === 'social';
    if (filter === 'geruchten') return item._type === 'rumour';
    return true;
  });

  async function handleFetch() {
    setFetching(true);
    try {
      await Promise.allSettled([api.ingestNews(), api.fetchReddit(), api.fetchX()]);
      toast('Feed wordt opgehaald…', 'info');
      setTimeout(() => { reloadNews(); reloadPosts(); reloadRumours(); }, 6000);
    } catch {
      toast('Ophalen mislukt', 'error');
    }
    setFetching(false);
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'alle', label: `Alle (${unified.length})` },
    { key: 'nieuws', label: `Nieuws (${newsItems.length})` },
    { key: 'social', label: `Social (${postItems.length})` },
    { key: 'geruchten', label: `Geruchten (${rumourItems.length})` },
  ];

  const GOK_ASSETS = new Set(['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'ALGO', 'BAT', 'CRV', 'AAVE']);

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Filter bar + refresh */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex gap-1 bg-card border border-border rounded-xl p-1 overflow-x-auto">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn('shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                filter === f.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={handleFetch} disabled={fetching}
          className="h-9 w-9 shrink-0 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Feed items */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="bg-card border border-border rounded-2xl p-10 text-center text-sm text-muted-foreground">
            Geen items — klik vernieuwen om de feed op te halen
          </div>
        )}
        {filtered.map((item: any, i: number) => {
          if (item._type === 'news') return <NewsCard key={`n-${item.id || i}`} item={item} />;
          if (item._type === 'social') return <SocialCard key={`s-${item.id || i}`} item={item} />;
          if (item._type === 'rumour') return (
            <RumourCard key={`r-${item.id || i}`} item={item} gokAssets={GOK_ASSETS} />
          );
          return null;
        })}
      </div>
    </div>
  );
}

function NewsCard({ item }: { item: any }) {
  const sentiment: string = item.sentiment || 'neutral';
  const [expanded, setExpanded] = useState(false);
  const body: string = item.summary || item.content || '';
  return (
    <div className="bg-card border border-border rounded-2xl p-3.5">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
          <Newspaper size={13} className="text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-[10px] text-muted-foreground">{item.source || 'Nieuws'}</span>
            <span className="text-[10px] text-muted-foreground">· {timeAgo(item.published_at)}</span>
            {item.impact_score > 0.6 && (
              <span className="text-[10px] font-bold text-amber-400">Hoog impact</span>
            )}
          </div>
          <p className="text-sm font-medium leading-snug">{item.title}</p>
          {body && (
            <p
              className={cn('text-xs text-muted-foreground mt-1 leading-relaxed cursor-pointer', !expanded && 'line-clamp-2')}
              onClick={() => setExpanded(e => !e)}
            >
              {body}
            </p>
          )}
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer"
               className="text-[10px] text-blue-400 hover:underline mt-0.5 block">
              Lees artikel →
            </a>
          )}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {(item.tickers || []).slice(0, 4).map((t: string) => (
              <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-bold">{t}</span>
            ))}
            <span className={cn('text-[10px] font-semibold',
              sentiment === 'positive' ? 'text-green-400' :
              sentiment === 'negative' ? 'text-red-400' : 'text-muted-foreground')}>
              {sentiment === 'positive' ? '↑ Positief' : sentiment === 'negative' ? '↓ Negatief' : 'Neutraal'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SocialCard({ item }: { item: any }) {
  const platform: string = item.platform || 'social';
  return (
    <div className="bg-card border border-border rounded-2xl p-3.5">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0 mt-0.5">
          <MessageSquare size={13} className="text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-bold text-muted-foreground capitalize">{platform}</span>
            {item.author && <span className="text-[10px] text-muted-foreground">· @{item.author}</span>}
            <span className="text-[10px] text-muted-foreground">· {timeAgo(item.posted_at)}</span>
          </div>
          <p className="text-sm leading-snug text-foreground/90 line-clamp-3">{item.content || item.text}</p>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {(item.tickers || []).slice(0, 3).map((t: string) => (
              <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-bold">{t}</span>
            ))}
            {item.hype_score > 0 && (
              <span className="text-[10px] text-amber-400 font-semibold">Hype {item.hype_score.toFixed(1)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RumourCard({ item, gokAssets }: { item: any; gokAssets: Set<string> }) {
  const conf = Math.round((item.confidence || 0) * 100);
  const rec: string = item.recommendation || '';
  const hasGokAsset = (item.related_assets || []).some((a: string) => gokAssets.has(a));

  return (
    <div className={cn('bg-card border rounded-2xl p-3.5',
      rec === 'avoid' ? 'border-red-500/20' :
      rec === 'paper_trade_only' || rec === 'watch' ? 'border-amber-500/20' :
      'border-border')}>
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0 mt-0.5">
          <Radio size={13} className="text-orange-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-[10px] font-bold text-orange-400">Gerucht</span>
            <span className="text-[10px] text-muted-foreground">· {conf}% conf · {timeAgo(item.created_at)}</span>
          </div>
          <p className="text-sm font-medium leading-snug">{item.title || item.description?.slice(0, 100)}</p>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {(item.related_assets || []).slice(0, 4).map((a: string) => (
              <span key={a} className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-bold">{a}</span>
            ))}
            <span className={cn('text-[10px] font-semibold',
              rec === 'paper_trade_only' ? 'text-amber-400' :
              rec === 'avoid' ? 'text-red-400' :
              rec === 'watch' ? 'text-blue-400' : 'text-muted-foreground')}>
              {rec.replace(/_/g, ' ')}
            </span>
            {hasGokAsset && (
              <Link href="/gok" className="text-[10px] font-bold text-amber-400 hover:underline">→ Gok</Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
