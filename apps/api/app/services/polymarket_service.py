"""Polymarket data service — read-only market intelligence.

Uses the public Gamma API for market discovery and the CLOB API for prices.
L2 credentials (api_key/secret/passphrase) are used for authenticated data
endpoints only; no order placement is performed.
"""
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GAMMA_API = "https://gamma-api.polymarket.com"
CLOB_API = "https://clob.polymarket.com"

CRYPTO_KEYWORDS = [
    "btc", "bitcoin", "eth", "ethereum", "sol", "solana", "crypto",
    "doge", "dogecoin", "avax", "avalanche", "bnb", "xrp", "ada",
    "link", "chainlink", "matic", "polygon",
]


class PolymarketService:
    def __init__(self, api_key: str = "", secret: str = "", passphrase: str = ""):
        self.api_key = api_key
        self.secret = secret
        self.passphrase = passphrase

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _l2_headers(self) -> dict[str, str]:
        """Build L2 auth headers for CLOB API authenticated endpoints."""
        if not (self.api_key and self.secret and self.passphrase):
            return {}
        try:
            import time
            import hmac
            import hashlib
            import base64
            ts = str(int(time.time()))
            msg = ts + "GET" + "/"
            sig = base64.b64encode(
                hmac.new(
                    base64.b64decode(self.secret),
                    msg.encode(),
                    hashlib.sha256,
                ).digest()
            ).decode()
            return {
                "POLY_ADDRESS": self.api_key,
                "POLY_SIGNATURE": sig,
                "POLY_TIMESTAMP": ts,
                "POLY_PASSPHRASE": self.passphrase,
            }
        except Exception:
            return {}

    async def get_markets(
        self,
        crypto_only: bool = True,
        max_end_hours: int = 48,
        min_volume: float = 500.0,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Fetch active markets from Gamma API."""
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(
                    f"{GAMMA_API}/markets",
                    params={"active": "true", "closed": "false", "limit": limit},
                )
                resp.raise_for_status()
                markets = resp.json()
        except Exception as e:
            logger.error(f"Gamma API fout: {e}")
            return []

        now = datetime.now(timezone.utc)
        result = []
        for m in markets:
            volume = float(m.get("volume") or m.get("volumeNum") or 0)
            if volume < min_volume:
                continue

            end_str = m.get("endDate") or m.get("end_date_iso") or ""
            hours_left = None
            if end_str:
                try:
                    end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                    hours_left = (end_dt - now).total_seconds() / 3600
                    if hours_left < 0 or hours_left > max_end_hours:
                        continue
                except (ValueError, TypeError):
                    pass

            question = (m.get("question") or "").lower()
            description = (m.get("description") or "").lower()
            if crypto_only:
                if not any(kw in question or kw in description for kw in CRYPTO_KEYWORDS):
                    continue

            tokens = m.get("tokens") or []
            yes_token = next((t for t in tokens if str(t.get("outcome", "")).lower() == "yes"), None)
            no_token = next((t for t in tokens if str(t.get("outcome", "")).lower() == "no"), None)

            outcome_prices = m.get("outcomePrices") or []
            yes_price = float(outcome_prices[0]) if outcome_prices else (float(yes_token.get("price", 0.5)) if yes_token else 0.5)
            no_price = float(outcome_prices[1]) if len(outcome_prices) > 1 else (1.0 - yes_price)

            result.append({
                "condition_id": m.get("conditionId") or m.get("id") or "",
                "question": m.get("question") or "",
                "slug": m.get("slug") or "",
                "end_date": end_str,
                "hours_left": round(hours_left, 1) if hours_left is not None else None,
                "volume": volume,
                "yes_price": round(yes_price, 4),
                "no_price": round(no_price, 4),
                "yes_token_id": yes_token.get("token_id") if yes_token else "",
                "no_token_id": no_token.get("token_id") if no_token else "",
                "active": bool(m.get("active")),
                "liquidity": float(m.get("liquidity") or 0),
            })

        return sorted(result, key=lambda x: x["volume"], reverse=True)

    async def get_token_price(self, token_id: str) -> dict[str, Any]:
        """Get best bid/ask from CLOB for a token."""
        if not token_id:
            return {"buy": None, "sell": None, "mid": None}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                buy_r = await client.get(f"{CLOB_API}/price", params={"token_id": token_id, "side": "buy"})
                sell_r = await client.get(f"{CLOB_API}/price", params={"token_id": token_id, "side": "sell"})
            buy_price = float(buy_r.json().get("price", 0)) if buy_r.status_code == 200 else None
            sell_price = float(sell_r.json().get("price", 0)) if sell_r.status_code == 200 else None
            mid = round((buy_price + sell_price) / 2, 4) if buy_price and sell_price else (buy_price or sell_price)
            return {"buy": buy_price, "sell": sell_price, "mid": mid}
        except Exception as e:
            logger.warning(f"CLOB prijs mislukt voor {token_id[:12]}: {e}")
            return {"buy": None, "sell": None, "mid": None}

    async def get_markets_for_ticker(self, ticker: str, max_hours: int = 48) -> list[dict[str, Any]]:
        """Fetch Polymarket markets relevant to a specific ticker (e.g. BTC, ETH).
        Used by the signal generator to enrich AI prompts with prediction market data."""
        all_markets = await self.get_markets(crypto_only=True, max_end_hours=max_hours, min_volume=200, limit=100)
        ticker_lower = ticker.lower()
        name_map = {
            "btc": ["bitcoin", "btc"],
            "eth": ["ethereum", "eth"],
            "sol": ["solana", "sol"],
            "doge": ["dogecoin", "doge"],
            "avax": ["avalanche", "avax"],
            "bnb": ["bnb", "binance"],
            "xrp": ["xrp", "ripple"],
        }
        keywords = name_map.get(ticker_lower, [ticker_lower])
        return [
            m for m in all_markets
            if any(kw in m["question"].lower() for kw in keywords)
        ]
