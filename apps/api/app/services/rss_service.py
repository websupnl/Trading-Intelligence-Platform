"""
RSS + API news ingestion service.

Sources (in order of priority):
1. Alpaca News API  — ticker-specific, real-time, already paid
2. CryptoPanic API  — crypto aggregator with panic/bullish scores (free, 1000 req/day)
3. Google News RSS  — per watchlist ticker, free, no auth
4. Curated RSS feeds — crypto + finance, all verified working (no paywalls)
5. Reddit RSS       — top posts, no auth needed
"""

import logging
import feedparser
import hashlib
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
import httpx

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.news import NewsItem

logger = logging.getLogger(__name__)

# ── Watchlist (must match asset_universe.py) ──────────────────────────────────

STOCK_TICKERS = ["NVDA", "TSLA", "META", "MSFT", "AMD", "COIN", "PLTR", "ASML",
                 "AAPL", "AMZN", "GOOGL", "SPY", "QQQ", "MSTR", "CRWD", "HOOD"]

CRYPTO_TICKERS = ["BTC", "ETH", "SOL", "DOGE", "AVAX", "LINK", "LTC", "AAVE",
                  "UNI", "ALGO", "BCH", "CRV"]

# For Google News searches
CRYPTO_NAMES = {
    "BTC": "Bitcoin", "ETH": "Ethereum", "SOL": "Solana", "DOGE": "Dogecoin",
    "AVAX": "Avalanche", "LINK": "Chainlink", "LTC": "Litecoin", "AAVE": "Aave",
    "UNI": "Uniswap", "ALGO": "Algorand",
}

# ── Curated RSS feeds (all verified working, no paywalls) ────────────────────

CRYPTO_RSS_FEEDS = [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://decrypt.co/feed",
    "https://theblock.co/rss.xml",
    "https://bitcoinmagazine.com/.rss/full/",
    "https://cryptonews.com/news/feed/",
    "https://cryptoslate.com/feed/",
    "https://ambcrypto.com/feed/",
    "https://cryptobriefing.com/feed/",
    "https://beincrypto.com/feed/",
    "https://u.today/rss",
    "https://newsbtc.com/feed/",
]

FINANCE_RSS_FEEDS = [
    # CNBC (free, no paywall)
    "https://www.cnbc.com/id/20910258/device/rss/rss.html",       # markets
    "https://www.cnbc.com/id/15839069/device/rss/rss.html",       # tech
    "https://www.cnbc.com/id/10000664/device/rss/rss.html",       # world markets
    # MarketWatch (free)
    "https://feeds.marketwatch.com/marketwatch/topstories/",
    "https://feeds.marketwatch.com/marketwatch/realtimeheadlines/",
    # Reuters (free)
    "https://feeds.reuters.com/reuters/businessNews",
    "https://feeds.reuters.com/reuters/technologyNews",
    # NYT Business (free)
    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    # Investorplace (free, retail-focused)
    "https://investorplace.com/feed/",
    # Motley Fool (free headlines)
    "https://www.fool.com/feeds/index.aspx",
    # ETF focus
    "https://etfdb.com/news/feed/",
    # Macro / contrarian
    "https://feeds.feedburner.com/zerohedge/feed",
]

REDDIT_RSS_FEEDS = [
    # Top posts of the day — better signal than all posts
    "https://www.reddit.com/r/CryptoCurrency/top/.rss?t=day&limit=25",
    "https://www.reddit.com/r/Bitcoin/top/.rss?t=day&limit=25",
    "https://www.reddit.com/r/ethereum/top/.rss?t=day&limit=25",
    "https://www.reddit.com/r/solana/top/.rss?t=day&limit=25",
    "https://www.reddit.com/r/wallstreetbets/top/.rss?t=day&limit=25",
    "https://www.reddit.com/r/investing/top/.rss?t=day&limit=25",
    "https://www.reddit.com/r/stocks/top/.rss?t=day&limit=25",
    "https://www.reddit.com/r/options/top/.rss?t=day&limit=25",
    "https://www.reddit.com/r/algotrading/top/.rss?t=day&limit=15",
    # Meme/speculative — gok opportunities
    "https://www.reddit.com/r/dogecoin/top/.rss?t=day&limit=15",
    "https://www.reddit.com/r/SatoshiStreetBets/top/.rss?t=day&limit=15",
]

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TradingOS/1.0)",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}


def _google_news_feeds() -> list[str]:
    """Generate Google News RSS URLs per watchlist ticker — free, no auth."""
    feeds = []
    for ticker in STOCK_TICKERS:
        feeds.append(
            f"https://news.google.com/rss/search?q={ticker}+stock+news&hl=en&gl=US&ceid=US:en"
        )
    for ticker, name in CRYPTO_NAMES.items():
        feeds.append(
            f"https://news.google.com/rss/search?q={name}+crypto+{ticker}&hl=en&gl=US&ceid=US:en"
        )
    # Gok-specific: meme coin + listing signals
    feeds.append("https://news.google.com/rss/search?q=crypto+exchange+listing+announcement&hl=en&gl=US&ceid=US:en")
    feeds.append("https://news.google.com/rss/search?q=memecoin+pump+trending&hl=en&gl=US&ceid=US:en")
    feeds.append("https://news.google.com/rss/search?q=SEC+crypto+ETF+approval&hl=en&gl=US&ceid=US:en")
    return feeds


class RSSFeedService:
    def __init__(self):
        self.settings = get_settings()
        extra = self.settings.news_feed_list + self.settings.crypto_feed_list
        all_feeds = (
            CRYPTO_RSS_FEEDS
            + FINANCE_RSS_FEEDS
            + REDDIT_RSS_FEEDS
            + _google_news_feeds()
            + extra
        )
        self.feeds = list(dict.fromkeys(all_feeds))

    def _detect_source_type(self, url: str) -> str:
        if "reddit.com" in url:
            return "reddit"
        if "google.com/rss/search" in url:
            return "google_news"
        if any(x in url for x in ["coindesk", "cointelegraph", "decrypt", "bitcoin",
                                    "cryptonews", "cryptoslate", "cryptopanic",
                                    "ambcrypto", "beincrypto", "newsbtc", "u.today"]):
            return "crypto_news"
        return "rss"

    async def ingest_all(self) -> int:
        """Main entry point — runs all sources in sequence."""
        total = 0

        # Priority 1: Alpaca News API (ticker-specific, real-time)
        try:
            count = await self._fetch_alpaca_news()
            total += count
            if count:
                logger.info(f"Alpaca News API: {count} nieuwe items")
        except Exception as e:
            logger.warning(f"Alpaca News API fout: {e}")

        # Priority 2a: CryptoPanic (crypto panic scores — optional, paid)
        try:
            count = await self._fetch_cryptopanic()
            total += count
            if count:
                logger.info(f"CryptoPanic: {count} nieuwe items")
        except Exception as e:
            logger.warning(f"CryptoPanic fout: {e}")

        # Priority 2b: CoinGecko Trending (free, no key — gok signals)
        try:
            count = await self._fetch_coingecko_trending()
            total += count
            if count:
                logger.info(f"CoinGecko trending: {count} nieuwe items")
        except Exception as e:
            logger.debug(f"CoinGecko trending fout: {e}")

        # Priority 3: RSS feeds (curated + Google News)
        for feed_url in self.feeds:
            try:
                count = await self._fetch_rss(feed_url)
                total += count
            except Exception as e:
                logger.debug(f"RSS feed fout {feed_url[:60]}: {e}")

        logger.info(f"Nieuws ingestie totaal: {total} nieuwe items")
        return total

    # ── Alpaca News API ───────────────────────────────────────────────────────

    async def _fetch_alpaca_news(self) -> int:
        if not (self.settings.alpaca_api_key and self.settings.alpaca_secret_key):
            return 0

        # All watchlist symbols in Alpaca format
        alpaca_symbols = [f"{t}/USD" if t in CRYPTO_TICKERS else t for t in STOCK_TICKERS + CRYPTO_TICKERS]

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{self.settings.alpaca_data_url}/v1beta1/news",
                headers={
                    "APCA-API-KEY-ID": self.settings.alpaca_api_key,
                    "APCA-API-SECRET-KEY": self.settings.alpaca_secret_key,
                },
                params={
                    "symbols": ",".join(alpaca_symbols[:30]),
                    "limit": 50,
                    "sort": "desc",
                    "start": (datetime.now(timezone.utc) - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                },
            )
            if resp.status_code != 200:
                logger.warning(f"Alpaca News API {resp.status_code}: {resp.text[:200]}")
                return 0

            news_list = resp.json().get("news", [])

        saved = 0
        async with AsyncSessionLocal() as db:
            for item in news_list:
                url = item.get("url", "").strip()
                if not url:
                    continue
                existing = await db.execute(
                    select(NewsItem).where(NewsItem.url == url[:2000]).limit(1)
                )
                if existing.scalar_one_or_none():
                    continue

                title = (item.get("headline") or "").strip()[:1000]
                if not title:
                    continue

                published_at = datetime.now(timezone.utc)
                try:
                    published_at = datetime.fromisoformat(
                        item.get("created_at", "").replace("Z", "+00:00")
                    )
                except Exception:
                    pass

                # Alpaca already provides symbols — use them directly
                raw_symbols = item.get("symbols", [])
                tickers = [s.replace("/USD", "").replace("USDT", "") for s in raw_symbols][:5]

                db.add(NewsItem(
                    title=title,
                    content=(item.get("summary") or item.get("content") or "")[:5000],
                    url=url[:2000],
                    source=item.get("source") or "Alpaca News",
                    source_type="alpaca_news",
                    tickers=tickers,
                    published_at=published_at,
                    status="new",
                ))
                saved += 1

            if saved:
                await db.commit()

        return saved

    # ── CryptoPanic API ───────────────────────────────────────────────────────

    async def _fetch_cryptopanic(self) -> int:
        if not self.settings.cryptopanic_api_key:
            return 0

        currencies = ",".join(CRYPTO_TICKERS[:12])

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://cryptopanic.com/api/v1/posts/",
                params={
                    "auth_token": self.settings.cryptopanic_api_key,
                    "public": "true",
                    "filter": "important",
                    "currencies": currencies,
                    "kind": "news",
                },
            )
            if resp.status_code != 200:
                logger.warning(f"CryptoPanic API {resp.status_code}")
                return 0

            posts = resp.json().get("results", [])

        saved = 0
        async with AsyncSessionLocal() as db:
            for post in posts[:30]:
                url = (post.get("url") or "").strip()
                if not url:
                    continue
                existing = await db.execute(
                    select(NewsItem).where(NewsItem.url == url[:2000]).limit(1)
                )
                if existing.scalar_one_or_none():
                    continue

                title = (post.get("title") or "").strip()[:1000]
                if not title:
                    continue

                published_at = datetime.now(timezone.utc)
                try:
                    published_at = datetime.fromisoformat(
                        post.get("published_at", "").replace("Z", "+00:00")
                    )
                except Exception:
                    pass

                currencies_list = post.get("currencies", [])
                tickers = [c.get("code", "") for c in currencies_list if c.get("code")][:5]

                # CryptoPanic votes give early signal
                votes = post.get("votes", {})
                panic_score = votes.get("negative", 0)
                bullish_score = votes.get("positive", 0)
                extra_meta = {
                    "panic_score": panic_score,
                    "bullish_score": bullish_score,
                    "source_domain": post.get("domain"),
                }

                db.add(NewsItem(
                    title=title,
                    content=str(extra_meta),
                    url=url[:2000],
                    source=f"CryptoPanic/{post.get('domain') or 'unknown'}",
                    source_type="cryptopanic",
                    tickers=tickers,
                    published_at=published_at,
                    status="new",
                ))
                saved += 1

            if saved:
                await db.commit()

        return saved

    # ── CoinGecko Trending (free, no key) ─────────────────────────────────────

    async def _fetch_coingecko_trending(self) -> int:
        """Top trending coins on CoinGecko — excellent gok-opportunity signal. Free, no auth."""
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://api.coingecko.com/api/v3/search/trending",
                    headers={"Accept": "application/json"},
                )
                if resp.status_code != 200:
                    logger.debug(f"CoinGecko trending {resp.status_code}")
                    return 0
                data = resp.json()
        except Exception as e:
            logger.debug(f"CoinGecko trending fout: {e}")
            return 0

        coins = data.get("coins", [])
        saved = 0

        async with AsyncSessionLocal() as db:
            for rank, entry in enumerate(coins[:15], start=1):
                item = entry.get("item", {})
                symbol = (item.get("symbol") or "").upper()
                name = item.get("name") or symbol
                if not symbol:
                    continue

                url = f"https://www.coingecko.com/en/coins/{item.get('id', symbol.lower())}#trending"
                existing = await db.execute(
                    select(NewsItem).where(NewsItem.url == url).limit(1)
                )
                if existing.scalar_one_or_none():
                    continue

                market_cap_rank = item.get("market_cap_rank") or 999
                title = f"🔥 {name} ({symbol}) trending op CoinGecko — #{rank} trending, marktcap rank #{market_cap_rank}"

                db.add(NewsItem(
                    title=title,
                    content=f"Trending rank: {rank} | Market cap rank: {market_cap_rank} | Score: {item.get('score', 0)}",
                    url=url,
                    source="CoinGecko Trending",
                    source_type="coingecko",
                    tickers=[symbol] if symbol in CRYPTO_TICKERS else [],
                    published_at=datetime.now(timezone.utc),
                    status="new",
                ))
                saved += 1

            if saved:
                await db.commit()

        return saved

    # ── RSS feeds ─────────────────────────────────────────────────────────────

    async def _fetch_rss(self, url: str) -> int:
        import asyncio
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
            for entry in parsed.entries[:20]:
                item_url = entry.get("link", "").strip()
                if not item_url:
                    continue

                existing = await db.execute(
                    select(NewsItem).where(NewsItem.url == item_url[:2000]).limit(1)
                )
                if existing.scalar_one_or_none():
                    continue

                title = entry.get("title", "").strip()[:1000]
                if not title:
                    continue

                content = ""
                if entry.get("content"):
                    content = entry.content[0].get("value", "")
                elif entry.get("summary"):
                    content = entry.summary

                published_at = datetime.now(timezone.utc)
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    try:
                        published_at = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
                    except Exception:
                        pass

                # Skip items older than 12 hours — stale for trading
                if (datetime.now(timezone.utc) - published_at) > timedelta(hours=12):
                    continue

                feed_source = parsed.feed.get("title", url)[:255]

                db.add(NewsItem(
                    title=title,
                    content=content[:5000] if content else None,
                    url=item_url[:2000],
                    source=feed_source,
                    source_type=source_type,
                    tickers=[],
                    published_at=published_at,
                    status="new",
                ))
                saved += 1

            if saved:
                await db.commit()

        return saved
