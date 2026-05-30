import logging
import feedparser
import hashlib
from datetime import datetime, timezone
from sqlalchemy import select
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.news import NewsItem

logger = logging.getLogger(__name__)


# Built-in default feeds — always active, no config needed
DEFAULT_NEWS_FEEDS = [
    # Crypto — high signal-to-noise
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://decrypt.co/feed",
    "https://theblock.co/rss.xml",
    "https://bitcoinmagazine.com/.rss/full/",
    "https://cryptonews.com/news/feed/",
    "https://cryptoslate.com/feed/",
    # Finance & markets
    "https://feeds.bloomberg.com/markets/news.rss",
    "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
    "https://feeds.marketwatch.com/marketwatch/topstories/",
    "https://www.cnbc.com/id/20910258/device/rss/rss.html",
    "https://seekingalpha.com/feed.xml",
    # Reddit crypto (RSS, no auth needed)
    "https://www.reddit.com/r/cryptocurrency/.rss",
    "https://www.reddit.com/r/Bitcoin/.rss",
    "https://www.reddit.com/r/ethereum/.rss",
    "https://www.reddit.com/r/solana/.rss",
    "https://www.reddit.com/r/CryptoCurrencies/.rss",
    # Reddit finance
    "https://www.reddit.com/r/wallstreetbets/.rss",
    "https://www.reddit.com/r/investing/.rss",
]

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TradingOS/1.0; +https://github.com/trading-os)"
}


class RSSFeedService:
    def __init__(self):
        settings = get_settings()
        extra = settings.news_feed_list + settings.crypto_feed_list
        # Merge defaults with user-configured feeds, deduplicate
        self.feeds = list(dict.fromkeys(DEFAULT_NEWS_FEEDS + extra))

    def _detect_source_type(self, url: str) -> str:
        if "reddit.com" in url:
            return "reddit"
        if any(x in url for x in ["coindesk", "cointelegraph", "decrypt", "bitcoin"]):
            return "crypto_news"
        return "rss"

    async def ingest_all(self) -> int:
        total = 0
        for feed_url in self.feeds:
            try:
                count = await self._fetch_and_save(feed_url)
                total += count
                logger.info(f"Feed {feed_url}: {count} nieuwe items")
            except Exception as e:
                logger.warning(f"Feed fout {feed_url}: {e}")
        return total

    async def _fetch_and_save(self, url: str) -> int:
        import asyncio
        # feedparser is sync — run in executor
        loop = asyncio.get_event_loop()
        parsed = await loop.run_in_executor(
            None,
            lambda: feedparser.parse(url, request_headers=DEFAULT_HEADERS)
        )

        if not parsed.entries:
            return 0

        source_type = self._detect_source_type(url)
        saved = 0

        async with AsyncSessionLocal() as db:
            for entry in parsed.entries[:25]:
                item_url = entry.get("link", "").strip()
                if not item_url:
                    continue

                # Check duplicate by URL
                existing = await db.execute(
                    select(NewsItem).where(NewsItem.url == item_url[:2000]).limit(1)
                )
                if existing.scalar_one_or_none():
                    continue

                title = entry.get("title", "").strip()[:1000]
                if not title:
                    continue

                content = entry.get("summary", "") or entry.get("content", [{}])[0].get("value", "") if entry.get("content") else entry.get("summary", "")
                # Parse published date
                published_at = datetime.now(timezone.utc)
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    try:
                        published_at = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
                    except Exception:
                        pass

                feed_source = parsed.feed.get("title", url)[:255]

                item = NewsItem(
                    title=title,
                    content=content[:5000] if content else None,
                    url=item_url[:2000],
                    source=feed_source,
                    source_type=source_type,
                    tickers=[],
                    published_at=published_at,
                    status="new",
                )
                db.add(item)
                saved += 1

            if saved > 0:
                await db.commit()

        return saved
