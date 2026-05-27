import logging
import hashlib
import re
from datetime import datetime, timezone
import httpx
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.social import SocialPost

logger = logging.getLogger(__name__)

TICKER_PATTERN = re.compile(r'\b[A-Z]{2,5}\b')
COMMON_WORDS = {
    "A", "I", "IT", "IN", "IS", "AT", "BE", "BY", "DO", "GO", "NO", "OF", "ON", "OR",
    "SO", "TO", "UP", "US", "WAS", "FOR", "AND", "THE", "ARE", "NEW", "ALL", "AI",
    "EU", "UK", "DD", "OC", "WSB", "YOLO", "IMO", "FWIW", "TIL", "ELI5",
}

SUBREDDITS = [
    "wallstreetbets", "stocks", "investing", "StockMarket",
    "options", "SecurityAnalysis", "cryptocurrency", "Bitcoin", "ethfinance",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TradingOS/1.0; research-bot)",
    "Accept": "application/json",
}


class RedditScraperService:
    def _extract_tickers(self, text: str) -> list[str]:
        matches = TICKER_PATTERN.findall(text)
        return list(set(m for m in matches if m not in COMMON_WORDS))[:10]

    async def fetch_all(self) -> int:
        total = 0
        async with httpx.AsyncClient(headers=HEADERS, timeout=15, follow_redirects=True) as client:
            for sub in SUBREDDITS:
                try:
                    count = await self._fetch_subreddit(client, sub)
                    total += count
                    logger.info(f"Reddit r/{sub}: {count} nieuwe posts")
                except Exception as e:
                    logger.warning(f"Reddit r/{sub} fout: {e}")
        return total

    async def _fetch_subreddit(self, client: httpx.AsyncClient, subreddit: str) -> int:
        url = f"https://www.reddit.com/r/{subreddit}/hot.json?limit=25"
        resp = await client.get(url)
        if resp.status_code != 200:
            logger.warning(f"Reddit {subreddit}: HTTP {resp.status_code}")
            return 0

        data = resp.json()
        posts = data.get("data", {}).get("children", [])
        saved = 0

        async with AsyncSessionLocal() as db:
            for child in posts:
                post = child.get("data", {})
                post_id = post.get("id", "")
                if not post_id:
                    continue

                external_id = f"reddit_{post_id}"

                # Check duplicate
                existing = await db.execute(
                    select(SocialPost).where(SocialPost.external_id == external_id).limit(1)
                )
                if existing.scalar_one_or_none():
                    continue

                title = post.get("title", "").strip()
                selftext = post.get("selftext", "").strip()
                content = f"{title}\n\n{selftext}".strip() if selftext else title
                if not content or post.get("is_video") or post.get("stickied"):
                    continue

                tickers = self._extract_tickers(content)
                score = post.get("score", 0)
                num_comments = post.get("num_comments", 0)

                # Skip low-engagement posts
                if score < 10:
                    continue

                posted_at = datetime.fromtimestamp(
                    post.get("created_utc", datetime.now(timezone.utc).timestamp()),
                    tz=timezone.utc
                )

                item = SocialPost(
                    external_id=external_id,
                    platform="reddit",
                    author=post.get("author", "unknown"),
                    content=content[:2000],
                    url=f"https://reddit.com{post.get('permalink', '')}",
                    subreddit=subreddit,
                    posted_at=posted_at,
                    tickers=tickers,
                    score=score,
                    num_comments=num_comments,
                )
                db.add(item)
                saved += 1

            if saved > 0:
                await db.commit()

        return saved
