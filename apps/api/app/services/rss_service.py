import logging
import feedparser
import hashlib
import re
from datetime import datetime, timezone
from sqlalchemy import select
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.news import NewsItem

logger = logging.getLogger(__name__)

TICKER_PATTERN = re.compile(r'\b[A-Z]{2,5}\b')
COMMON_WORDS = {
    "A", "I", "IT", "IN", "IS", "AT", "BE", "BY", "DO", "GO", "NO", "OF", "ON", "OR",
    "SO", "TO", "UP", "US", "WAS", "FOR", "AND", "THE", "ARE", "NEW", "ALL", "SEC",
    "NYSE", "ETF", "IPO", "CEO", "CFO", "COO", "AI", "EU", "UK", "GDP", "CPI",
    "FED", "IMF", "RSS", "HTML", "HTTP", "HTTPS", "API", "USD", "EUR", "GBP",
}

# Built-in default feeds — always active, no config needed
DEFAULT_NEWS_FEEDS = [
    # Finance & markets
    "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
    "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best",
    "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US",
    "https://feeds.marketwatch.com/marketwatch/topstories/",
    "https://seekingalpha.com/feed.xml",
    "https://www.investing.com/rss/news.rss",
    "https://www.ft.com/rss/home",
    "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    "https://www.cnbc.com/id/20910258/device/rss/rss.html",
    "https://feeds.bloomberg.com/markets/news.rss",
    # Crypto
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://decrypt.co/feed",
    # Reddit (RSS, no auth needed)
    "https://www.reddit.com/r/wallstreetbets/.rss",
    "https://www.reddit.com/r/stocks/.rss",
    "https://www.reddit.com/r/investing/.rss",
    "https://www.reddit.com/r/StockMarket/.rss",
    "https://www.reddit.com/r/options/.rss",
    "https://www.reddit.com/r/SecurityAnalysis/.rss",
    "https://www.reddit.com/r/cryptocurrency/.rss",
    "https://www.reddit.com/r/Bitcoin/.rss",
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

    def _extract_tickers(self, text: str) -> list[str]:
        matches = TICKER_PATTERN.findall(text)
        return list(set(m for m in matches if m not in COMMON_WORDS))[:10]

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
                tickers = self._extract_tickers(title + " " + (content or ""))

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
                    tickers=tickers,
                    published_at=published_at,
                    status="new",
                )
                db.add(item)
                saved += 1

            if saved > 0:
                await db.commit()

        return saved
