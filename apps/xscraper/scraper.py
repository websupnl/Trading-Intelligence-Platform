"""
X (Twitter) scraper — echte browser via Playwright + GraphQL intercept.

Waarom deze aanpak:
- We loggen NIET in met wachtwoord (captcha/2FA-risico op een headless server).
  In plaats daarvan injecteren we de sessie-cookies (auth_token + ct0) die je
  eenmalig uit je eigen ingelogde browser haalt. Veel stabieler en minder ban-gevoelig.
- We parsen GEEN HTML. We luisteren mee op het netwerkverkeer: zodra X intern een
  GraphQL-response stuurt (SearchTimeline / UserTweets), pakken we de schone JSON.

Output: rijen in de bestaande `social_posts` tabel met platform='x', dedup op url.
De bestaande news/social-analyzer pikt deze vanzelf op (ai_analyzed=false).

Volledig ontkoppeld van de trading-workers: crasht dit, dan draait de bot door.
"""

import asyncio
import json
import logging
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote

import psycopg
from playwright.async_api import async_playwright

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [xscraper] %(message)s",
)
logger = logging.getLogger("xscraper")

# ---- Config via env ---------------------------------------------------------
RAW_DB_URL = os.getenv("DATABASE_URL", "")
AUTH_TOKEN = os.getenv("X_AUTH_TOKEN", "").strip()
CT0 = os.getenv("X_CT0", "").strip()
INTERVAL = int(os.getenv("X_SCRAPE_INTERVAL_SEC", "1800"))
MIN_FAVES = int(os.getenv("X_MIN_FAVES", "50"))
HEADLESS = os.getenv("X_HEADLESS", "true").lower() != "false"

# Elke query = 1 zoekopdracht. min_faves houdt de ruis laag (alleen engagement).
DEFAULT_QUERIES = [
    "($BTC OR $ETH OR $SOL OR $DOGE) min_faves:200 lang:en -filter:retweets",
    "($NVDA OR $TSLA OR $META OR $AMD) min_faves:150 lang:en -filter:retweets",
    "(coinbase listing OR binance listing OR exchange listing) min_faves:100 lang:en -filter:retweets",
    "(market crash OR circuit breaker OR SEC crypto) min_faves:300 lang:en -filter:retweets",
]
QUERIES = [q.strip() for q in os.getenv("X_SEARCH_QUERIES", "").split("||") if q.strip()] or DEFAULT_QUERIES

_TICKER_RE = re.compile(r"\$([A-Z]{2,6})\b")


def _pg_dsn(url: str) -> str:
    """psycopg accepteert geen sqlalchemy '+psycopg' dialect-suffix."""
    return url.replace("postgresql+psycopg://", "postgresql://").replace("postgresql+asyncpg://", "postgresql://")


def _extract_tickers(text: str) -> list[str]:
    tickers = {m.group(1) for m in _TICKER_RE.finditer(text.upper())}
    return sorted(tickers)[:5]


def _walk_tweet_results(obj) -> list[dict]:
    """Loop recursief door de GraphQL-JSON en verzamel alle tweet-result objecten."""
    found = []
    if isinstance(obj, dict):
        tr = obj.get("tweet_results")
        if isinstance(tr, dict) and isinstance(tr.get("result"), dict):
            found.append(tr["result"])
        for v in obj.values():
            found.extend(_walk_tweet_results(v))
    elif isinstance(obj, list):
        for v in obj:
            found.extend(_walk_tweet_results(v))
    return found


def _normalize(result: dict) -> dict | None:
    # TweetWithVisibilityResults wikkelt de echte tweet in 'tweet'
    if result.get("__typename") == "TweetWithVisibilityResults" and isinstance(result.get("tweet"), dict):
        result = result["tweet"]
    legacy = result.get("legacy") or {}
    text = (legacy.get("full_text") or "").strip()
    rest_id = result.get("rest_id") or legacy.get("id_str")
    if not text or not rest_id:
        return None
    user = (
        result.get("core", {})
        .get("user_results", {})
        .get("result", {})
        .get("legacy", {})
    )
    username = user.get("screen_name", "")
    created = datetime.now(timezone.utc)
    try:
        created = parsedate_to_datetime(legacy["created_at"])
    except Exception:
        pass
    likes = int(legacy.get("favorite_count", 0) or 0)
    rts = int(legacy.get("retweet_count", 0) or 0)
    replies = int(legacy.get("reply_count", 0) or 0)
    return {
        "rest_id": str(rest_id),
        "text": text,
        "username": username,
        "url": f"https://x.com/{username or 'i/web'}/status/{rest_id}",
        "likes": likes,
        "retweets": rts,
        "replies": replies,
        "created_at": created,
        "hype_score": min(1.0, (likes + rts * 2) / 2000),
        "tickers": _extract_tickers(text),
    }


def _save(conn, tweets: list[dict]) -> int:
    saved = 0
    with conn.cursor() as cur:
        for t in tweets:
            if t["likes"] < MIN_FAVES or len(t["text"]) < 30:
                continue
            cur.execute("SELECT 1 FROM social_posts WHERE url = %s LIMIT 1", (t["url"],))
            if cur.fetchone():
                continue
            now = datetime.now(timezone.utc)
            cur.execute(
                """
                INSERT INTO social_posts
                    (id, external_id, platform, author, content, url, posted_at,
                     tickers, score, num_comments, hype_score, ai_analyzed,
                     created_at, updated_at)
                VALUES (%s,%s,'x',%s,%s,%s,%s,%s,%s,%s,%s,false,%s,%s)
                """,
                (
                    str(uuid.uuid4()),
                    f"x_{t['rest_id']}",
                    t["username"],
                    t["text"][:2000],
                    t["url"],
                    t["created_at"],
                    json.dumps(t["tickers"]),
                    t["likes"],
                    t["replies"],
                    t["hype_score"],
                    now,
                    now,
                ),
            )
            saved += 1
    conn.commit()
    return saved


async def _scrape_once(context, conn) -> int:
    total = 0
    for query in QUERIES:
        captured: dict[str, dict] = {}

        async def on_response(response):
            url = response.url
            if "SearchTimeline" not in url and "UserTweets" not in url:
                return
            try:
                data = await response.json()
            except Exception:
                return
            for result in _walk_tweet_results(data):
                norm = _normalize(result)
                if norm:
                    captured[norm["rest_id"]] = norm

        page = await context.new_page()
        page.on("response", on_response)
        try:
            search_url = f"https://x.com/search?q={quote(query)}&f=live"
            await page.goto(search_url, wait_until="networkidle", timeout=45000)
            # Korte scroll om meer timeline-batches te triggeren
            for _ in range(2):
                await page.mouse.wheel(0, 3000)
                await page.wait_for_timeout(2500)
        except Exception as e:
            logger.warning("Query mislukt '%s…': %s", query[:40], e)
        finally:
            await page.close()

        if captured:
            saved = _save(conn, list(captured.values()))
            total += saved
            logger.info("Query '%s…': %d tweets gezien, %d nieuw opgeslagen", query[:40], len(captured), saved)
        else:
            logger.info("Query '%s…': 0 tweets (login-wall of geen resultaten?)", query[:40])
        await asyncio.sleep(3)
    return total


async def main():
    if not RAW_DB_URL:
        logger.error("DATABASE_URL ontbreekt — afsluiten.")
        sys.exit(1)
    while not (AUTH_TOKEN and CT0):
        # Niet crashen (zou met restart:unless-stopped een crash-loop geven) — idle wachten
        # tot de cookies in Coolify gezet zijn. Container daarna 1x herstarten.
        logger.error(
            "X_AUTH_TOKEN en/of X_CT0 ontbreken. Zet beide als env in Coolify "
            "(cookies 'auth_token' en 'ct0' uit je ingelogde X-browser). Idle, retry in 300s."
        )
        await asyncio.sleep(300)

    dsn = _pg_dsn(RAW_DB_URL)
    cookies = [
        {"name": "auth_token", "value": AUTH_TOKEN, "domain": ".x.com", "path": "/", "httpOnly": True, "secure": True},
        {"name": "ct0", "value": CT0, "domain": ".x.com", "path": "/", "secure": True},
    ]

    logger.info("xscraper gestart — %d queries, interval %ds, min_faves %d", len(QUERIES), INTERVAL, MIN_FAVES)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=HEADLESS, args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )
        await context.add_cookies(cookies)

        while True:
            try:
                with psycopg.connect(dsn, connect_timeout=10) as conn:
                    n = await _scrape_once(context, conn)
                logger.info("Cyclus klaar: %d nieuwe tweets opgeslagen", n)
            except Exception as e:
                logger.error("Cyclus-fout: %s", e)
            await asyncio.sleep(INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
