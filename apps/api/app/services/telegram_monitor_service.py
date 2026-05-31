"""
Monitor public Telegram channels for market-moving signals.

Works with any public channel (no user credentials needed).
Scrapes the public t.me/s/{channel} preview page.

To add channels: set TELEGRAM_MONITOR_CHANNELS in Coolify:
  trading,stockbot,futures,interest,budget,financial
"""

import re
import html as html_module
import logging
from datetime import datetime, timezone, timedelta

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.news import NewsItem

logger = logging.getLogger(__name__)

_SCRAPE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
                  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Keywords that indicate high-signal trading content
_SIGNAL_KEYWORDS = [
    "breaking", "urgent", "🚨", "🔥", "⚡", "📈", "📉",
    "listing", "halt", "fda", "earnings", "acquisition", "merger",
    "hack", "exploit", "sec", "etf", "approval", "ban", "crash",
    "pump", "dump", "whale", "ath", "support", "resistance",
    "rally", "selloff", "buy", "sell", "target", "stop",
]


def _strip_html(raw: str) -> str:
    """Strip HTML tags and decode entities from a string."""
    # Replace <br> tags with newlines
    cleaned = re.sub(r'<br\s*/?>', '\n', raw, flags=re.IGNORECASE)
    # Remove all remaining HTML tags
    cleaned = re.sub(r'<[^>]+>', '', cleaned)
    cleaned = html_module.unescape(cleaned)
    # Normalise whitespace
    cleaned = re.sub(r' +', ' ', cleaned)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned.strip()


def _parse_channel_html(page_html: str, channel: str) -> list[dict]:
    """Extract messages from t.me/s/{channel} HTML."""
    messages = []

    # Each message has data-post="channelname/12345"
    # We split on message boundaries using that attribute
    message_blocks = re.split(r'(?=data-post=")', page_html)

    for block in message_blocks:
        post_match = re.match(r'data-post="([^/]+/(\d+))"', block)
        if not post_match:
            continue

        post_path = post_match.group(1)   # e.g. "trading/12345"
        msg_id = int(post_match.group(2))

        # Extract datetime
        dt_match = re.search(r'<time[^>]+datetime="([^"]+)"', block)
        if not dt_match:
            continue
        dt_str = dt_match.group(1)

        # Extract message text (may span multiple divs)
        text_match = re.search(
            r'class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>',
            block, re.DOTALL
        )
        if not text_match:
            # Some messages are photo-only — skip
            continue

        raw_text = text_match.group(1)
        clean_text = _strip_html(raw_text)

        if not clean_text or len(clean_text) < 20:
            continue

        try:
            published_at = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        except Exception:
            continue

        messages.append({
            "url": f"https://t.me/{post_path}",
            "text": clean_text[:2000],
            "published_at": published_at,
            "channel": channel,
            "msg_id": msg_id,
        })

    return messages


def _has_trading_signal(text: str) -> bool:
    """Quick keyword check — avoid storing pure chat noise."""
    lower = text.lower()
    return any(kw in lower for kw in _signal_keywords)


# Make it work with both lowercase list and uppercase list
_signal_keywords = [kw.lower() for kw in _SIGNAL_KEYWORDS]


class TelegramMonitorService:
    def __init__(self):
        self.settings = get_settings()

    async def monitor_all(self) -> int:
        channels = self.settings.telegram_monitor_channel_list
        if not channels:
            return 0

        total = 0
        for channel in channels:
            try:
                count = await self._monitor_channel(channel)
                total += count
                if count:
                    logger.info(f"Telegram @{channel}: {count} nieuwe signalen")
            except Exception as e:
                logger.debug(f"Telegram @{channel} fout: {e}")

        return total

    async def _monitor_channel(self, channel: str) -> int:
        url = f"https://t.me/s/{channel}"
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(url, headers=_SCRAPE_HEADERS)
                if resp.status_code != 200:
                    logger.debug(f"Telegram @{channel} HTTP {resp.status_code}")
                    return 0
                page_html = resp.text
        except Exception as e:
            logger.debug(f"Telegram @{channel} fetch fout: {e}")
            return 0

        messages = _parse_channel_html(page_html, channel)
        if not messages:
            return 0

        cutoff = datetime.now(timezone.utc) - timedelta(hours=6)
        saved = 0

        async with AsyncSessionLocal() as db:
            for msg in messages:
                if msg["published_at"] < cutoff:
                    continue

                existing = await db.execute(
                    select(NewsItem).where(NewsItem.url == msg["url"]).limit(1)
                )
                if existing.scalar_one_or_none():
                    continue

                text = msg["text"]

                # Skip very short or pure-emoji messages that carry no signal
                if len(text) < 30:
                    continue

                title = text.split("\n")[0][:200] or text[:200]

                db.add(NewsItem(
                    title=title,
                    content=text[:5000],
                    url=msg["url"],
                    source=f"Telegram @{channel}",
                    source_type="telegram",
                    tickers=[],
                    published_at=msg["published_at"],
                    status="new",
                ))
                saved += 1

            if saved:
                await db.commit()

        return saved
