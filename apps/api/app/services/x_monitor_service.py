"""
X (Twitter) monitor service — searches high-engagement tweets about watchlist assets.

Requires X_BEARER_TOKEN in Coolify (free developer account works for search).
Rate limit: 10 requests / 15 minutes on free tier — we batch smartly.

What we search:
1. High-engagement tweets about watchlist tickers ($BTC, $NVDA, etc.)
2. Breaking market news accounts (configured via X_MONITOR_ACCOUNTS)
3. Crypto listing / gok signals
"""

import logging
from datetime import datetime, timezone, timedelta

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.social import SocialPost

logger = logging.getLogger(__name__)

# Tickers to monitor — high-signal assets only (rate limit is precious)
PRIORITY_CRYPTO = ["BTC", "ETH", "SOL", "DOGE", "AVAX"]
PRIORITY_STOCKS = ["NVDA", "TSLA", "META", "MSFT", "AMD"]

# Search queries (each = 1 API call)
SEARCH_QUERIES = [
    # Crypto high-engagement
    '($BTC OR $ETH OR $SOL OR $DOGE) min_faves:200 lang:en -is:retweet',
    # Stock high-engagement
    '($NVDA OR $TSLA OR $META OR $AMD) min_faves:150 lang:en -is:retweet',
    # Gok: listing + viral signals
    '(exchange listing OR coinbase listing OR binance listing) min_faves:100 lang:en -is:retweet',
    # Breaking market news
    '(market crash OR circuit breaker OR stock halt OR SEC crypto) min_faves:300 lang:en -is:retweet',
]

_X_API_BASE = "https://api.twitter.com/2"

_TWEET_FIELDS = "created_at,author_id,public_metrics,entities,lang"
_EXPANSIONS = "author_id"
_USER_FIELDS = "username,name,verified"


def _extract_tickers(text: str, entities: dict) -> list[str]:
    """Extract $TICKER mentions from tweet text and entities."""
    tickers = set()

    # From entities.cashtags (most reliable)
    for ct in (entities or {}).get("cashtags", []):
        tag = ct.get("tag", "").upper()
        if 2 <= len(tag) <= 6:
            tickers.add(tag)

    # Fallback: scan text for $TICKER patterns
    import re
    for match in re.finditer(r'\$([A-Z]{2,6})\b', text.upper()):
        tickers.add(match.group(1))

    return list(tickers)[:5]


class XMonitorService:
    def __init__(self):
        self.settings = get_settings()

    @property
    def configured(self) -> bool:
        return bool(self.settings.x_bearer_token)

    async def fetch_all(self) -> int:
        if not self.configured:
            return 0

        total = 0
        # Respect rate limit: max 3 searches per call (save quota for hourly runs)
        for query in SEARCH_QUERIES[:3]:
            try:
                count = await self._search(query)
                total += count
            except Exception as e:
                logger.debug(f"X search fout '{query[:40]}': {e}")

        if total:
            logger.info(f"X monitor: {total} nieuwe tweets opgeslagen")
        return total

    async def _search(self, query: str) -> int:
        since = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")

        headers = {"Authorization": f"Bearer {self.settings.x_bearer_token}"}
        params = {
            "query": query,
            "max_results": 10,
            "tweet.fields": _TWEET_FIELDS,
            "expansions": _EXPANSIONS,
            "user.fields": _USER_FIELDS,
            "start_time": since,
            "sort_order": "relevancy",
        }

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{_X_API_BASE}/tweets/search/recent", headers=headers, params=params)

        if resp.status_code == 429:
            logger.warning("X API rate limit bereikt — wacht tot volgende cyclus")
            return 0
        if resp.status_code == 401:
            logger.warning("X API: ongeldige bearer token — check X_BEARER_TOKEN in Coolify")
            return 0
        if resp.status_code != 200:
            logger.debug(f"X API {resp.status_code}: {resp.text[:200]}")
            return 0

        data = resp.json()
        tweets = data.get("data", [])
        users = {u["id"]: u for u in data.get("includes", {}).get("users", [])}

        if not tweets:
            return 0

        saved = 0
        async with AsyncSessionLocal() as db:
            for tweet in tweets:
                tweet_id = tweet.get("id")
                url = f"https://x.com/i/web/status/{tweet_id}"

                existing = await db.execute(
                    select(SocialPost).where(SocialPost.url == url).limit(1)
                )
                if existing.scalar_one_or_none():
                    continue

                text = tweet.get("text", "").strip()
                if not text or len(text) < 30:
                    continue

                metrics = tweet.get("public_metrics", {})
                likes = metrics.get("like_count", 0)
                retweets = metrics.get("retweet_count", 0)
                replies = metrics.get("reply_count", 0)

                author_id = tweet.get("author_id")
                author_info = users.get(author_id, {})
                username = author_info.get("username", "")

                tickers = _extract_tickers(text, tweet.get("entities", {}))

                published_at = datetime.now(timezone.utc)
                try:
                    published_at = datetime.fromisoformat(
                        tweet.get("created_at", "").replace("Z", "+00:00")
                    )
                except Exception:
                    pass

                # Hype score based on engagement
                hype_score = min(1.0, (likes + retweets * 2) / 2000)

                db.add(SocialPost(
                    platform="x",
                    author=username,
                    content=text[:2000],
                    url=url,
                    tickers=tickers,
                    score=likes,
                    num_comments=replies,
                    hype_score=hype_score,
                    posted_at=published_at,
                    ai_analyzed=False,
                ))
                saved += 1

            if saved:
                await db.commit()

        return saved
