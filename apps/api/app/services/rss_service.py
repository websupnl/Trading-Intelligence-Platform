import logging
import feedparser
import hashlib
import re
from datetime import datetime, timezone
from typing import Optional
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

TICKER_PATTERN = re.compile(r'\b[A-Z]{2,5}\b')
COMMON_WORDS = {"A", "I", "IT", "IN", "IS", "AT", "BE", "BY", "DO", "GO", "NO", "OF", "ON", "OR", "SO", "TO", "UP", "US", "WAS", "FOR", "AND", "THE", "ARE", "NEW", "ALL", "SEC", "NYSE", "ETF", "IPO", "CEO", "CFO", "COO", "AI", "US", "EU", "UK", "GDP", "CPI", "FED", "IMF"}


class RSSFeedService:
    def __init__(self):
        self.feeds = settings.news_feed_list + settings.crypto_feed_list
        self._seen_urls: set[str] = set()

    def _extract_tickers(self, text: str) -> list[str]:
        matches = TICKER_PATTERN.findall(text)
        return list(set(m for m in matches if m not in COMMON_WORDS))

    async def ingest_all(self) -> int:
        if not self.feeds:
            logger.info("Geen nieuwsfeeds geconfigureerd")
            return 0

        count = 0
        for feed_url in self.feeds:
            try:
                items = await self._fetch_feed(feed_url)
                count += len(items)
            except Exception as e:
                logger.warning(f"Feed fout {feed_url}: {e}")
        return count

    async def _fetch_feed(self, url: str) -> list[dict]:
        parsed = feedparser.parse(url)
        items = []
        for entry in parsed.entries[:20]:
            item_url = entry.get("link", "")
            url_hash = hashlib.md5(item_url.encode()).hexdigest() if item_url else ""
            if url_hash in self._seen_urls:
                continue
            self._seen_urls.add(url_hash)

            tickers = self._extract_tickers(entry.get("title", "") + " " + entry.get("summary", ""))
            items.append({
                "title": entry.get("title", "")[:1000],
                "url": item_url[:2000] if item_url else None,
                "source": parsed.feed.get("title", url)[:255],
                "source_type": "rss",
                "content": entry.get("summary", ""),
                "tickers": tickers,
                "published_at": datetime.now(timezone.utc),
            })
        return items
