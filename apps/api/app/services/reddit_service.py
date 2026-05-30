import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml",
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
        url = f"https://www.reddit.com/r/{subreddit}/hot.rss?limit=25"
        resp = await client.get(url)
        if resp.status_code != 200:
            logger.warning(f"Reddit {subreddit}: HTTP {resp.status_code}")
            return 0

        try:
            root = ET.fromstring(resp.text)
        except ET.ParseError as e:
            logger.warning(f"Reddit {subreddit}: RSS parse fout: {e}")
            return 0

        ns = {"atom": "http://www.w3.org/2005/Atom"}
        entries = root.findall("atom:entry", ns) or root.findall(".//item")
        saved = 0

        async with AsyncSessionLocal() as db:
            for entry in entries:
                # Support both Atom and RSS formats
                entry_id = (
                    _text(entry, "atom:id", ns)
                    or _text(entry, "guid")
                    or ""
                )
                if not entry_id:
                    continue

                external_id = f"reddit_rss_{abs(hash(entry_id)) % 10**12}"

                existing = await db.execute(
                    select(SocialPost).where(SocialPost.external_id == external_id).limit(1)
                )
                if existing.scalar_one_or_none():
                    continue

                title = (
                    _text(entry, "atom:title", ns)
                    or _text(entry, "title")
                    or ""
                ).strip()
                content_el = entry.find("atom:content", ns) or entry.find("description")
                content_text = (content_el.text or "") if content_el is not None else ""
                content = f"{title}\n\n{content_text}".strip() if content_text else title
                if not content:
                    continue

                # Parse publication date
                pub_str = (
                    _text(entry, "atom:updated", ns)
                    or _text(entry, "atom:published", ns)
                    or _text(entry, "pubDate")
                    or ""
                )
                try:
                    posted_at = datetime.fromisoformat(pub_str.replace("Z", "+00:00")) if pub_str else datetime.now(timezone.utc)
                except ValueError:
                    try:
                        posted_at = parsedate_to_datetime(pub_str).replace(tzinfo=timezone.utc)
                    except Exception:
                        posted_at = datetime.now(timezone.utc)

                link_el = entry.find("atom:link", ns)
                url_val = (link_el.get("href") if link_el is not None else None) or _text(entry, "link") or ""
                author = _text(entry, "atom:author/atom:name", ns) or "unknown"

                tickers = self._extract_tickers(f"{title} {content_text}")

                item = SocialPost(
                    external_id=external_id,
                    platform="reddit",
                    author=author,
                    content=content[:2000],
                    url=url_val,
                    subreddit=subreddit,
                    posted_at=posted_at,
                    tickers=tickers,
                    score=50,
                    num_comments=0,
                    hype_score=0.3,
                )
                db.add(item)
                saved += 1

            if saved > 0:
                await db.commit()

        return saved


def _text(el, path: str, ns: dict | None = None) -> str:
    found = el.find(path, ns) if ns else el.find(path)
    return (found.text or "").strip() if found is not None else ""
