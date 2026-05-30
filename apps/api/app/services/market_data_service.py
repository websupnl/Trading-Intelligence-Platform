import logging
from datetime import datetime, timezone, timedelta
import httpx
from sqlalchemy import select
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.candles import Candle
from app.services.alpaca_broker import CRYPTO_SYMBOLS, is_crypto

logger = logging.getLogger(__name__)


def _chunks(items: list[str], size: int) -> list[list[str]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def _normalize_symbol(symbol: str) -> str:
    """Strip '/USD' suffix from crypto symbols so they're stored as 'BTC' not 'BTC/USD'."""
    return symbol.split("/")[0].upper()


class MarketDataService:
    def __init__(self):
        self.settings = get_settings()

    def _data_headers(self) -> dict:
        return {
            "APCA-API-KEY-ID": self.settings.alpaca_api_key,
            "APCA-API-SECRET-KEY": self.settings.alpaca_secret_key,
        }

    async def _fetch_and_save_paginated(
        self,
        client: httpx.AsyncClient,
        url: str,
        params: dict,
        timeframe: str,
        *,
        normalize: bool,
        label: str,
        max_pages: int = 200,
    ) -> int:
        saved = 0
        page_token = None
        for _ in range(max_pages):
            request_params = dict(params)
            if page_token:
                request_params["page_token"] = page_token

            resp = await client.get(url, headers=self._data_headers(), params=request_params)
            if resp.status_code != 200:
                logger.warning(f"{label} market data error: {resp.status_code} — {resp.text[:200]}")
                break

            payload = resp.json()
            saved += await self._save_bars(payload.get("bars", {}), timeframe, normalize=normalize)
            page_token = payload.get("next_page_token")
            if not page_token:
                break
        return saved

    async def _save_bars(self, bars_by_symbol: dict, timeframe: str, normalize: bool = False) -> int:
        """Persist a bars dict to DB. If normalize=True, strips '/USD' from symbol names."""
        saved = 0
        async with AsyncSessionLocal() as db:
            for raw_symbol, bars in bars_by_symbol.items():
                symbol = _normalize_symbol(raw_symbol) if normalize else raw_symbol
                for bar in bars:
                    ts_str = bar.get("t", "")
                    try:
                        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    except Exception:
                        continue

                    existing = await db.execute(
                        select(Candle).where(
                            Candle.symbol == symbol,
                            Candle.timeframe == timeframe,
                            Candle.timestamp == ts,
                        ).limit(1)
                    )
                    if existing.scalar_one_or_none():
                        continue

                    candle = Candle(
                        symbol=symbol,
                        timeframe=timeframe,
                        timestamp=ts,
                        open=float(bar.get("o", 0)),
                        high=float(bar.get("h", 0)),
                        low=float(bar.get("l", 0)),
                        close=float(bar.get("c", 0)),
                        volume=int(bar.get("v", 0)),
                        vwap=float(bar.get("vw", 0)) if bar.get("vw") else None,
                        trade_count=int(bar.get("n", 0)) if bar.get("n") else None,
                    )
                    db.add(candle)
                    saved += 1

            if saved > 0:
                await db.commit()
        return saved

    async def fetch_bars(self, symbols: list[str], timeframe: str = "1Day", limit: int = 60) -> int:
        """Fetch OHLCV bars for a list of symbols and save to DB. Returns count saved."""
        if not self.settings.alpaca_configured:
            logger.warning("Alpaca niet geconfigureerd - market data overgeslagen")
            return 0
        if not symbols:
            return 0

        # Split into stocks vs crypto — they use different Alpaca endpoints
        normalized = []
        seen = set()
        for raw in symbols:
            symbol = _normalize_symbol(raw) if is_crypto(raw) else raw.upper()
            if symbol and symbol not in seen:
                normalized.append(symbol)
                seen.add(symbol)

        crypto = [s for s in normalized if s in CRYPTO_SYMBOLS]
        stocks = [s for s in normalized if s not in CRYPTO_SYMBOLS]
        saved = 0
        # Alpaca can return only the latest grouped daily bar without an explicit
        # historical window. TA needs enough bars, so always request a lookback.
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=max(limit * 3, 120))

        async with httpx.AsyncClient(timeout=30) as client:
            # ── Stocks ────────────────────────────────────────────────────────
            if stocks:
                for batch in _chunks(stocks, 10):
                    try:
                        saved += await self._fetch_and_save_paginated(
                            client,
                            f"{self.settings.alpaca_data_url}/v2/stocks/bars",
                            {
                                "symbols": ",".join(batch),
                                "timeframe": timeframe,
                                "limit": limit,
                                "start": start.isoformat(),
                                "end": end.isoformat(),
                                "adjustment": "raw",
                                "feed": "iex",
                            },
                            timeframe,
                            normalize=False,
                            label="Stocks",
                        )
                    except Exception as e:
                        logger.error(f"Stocks fetch fout: {e}")

            # ── Crypto ────────────────────────────────────────────────────────
            if crypto:
                # Alpaca crypto market data uses v1beta3 with a location segment.
                # Batch size 5 (not 10) so limit=120 covers more bars per symbol per page.
                crypto_pairs = [f"{s}/USD" for s in crypto]
                for batch in _chunks(crypto_pairs, 5):
                    try:
                        saved += await self._fetch_and_save_paginated(
                            client,
                            f"{self.settings.alpaca_data_url}/v1beta3/crypto/us/bars",
                            {
                                "symbols": ",".join(batch),
                                "timeframe": timeframe,
                                "limit": limit,
                                "start": start.isoformat(),
                                "end": end.isoformat(),
                            },
                            timeframe,
                            normalize=True,
                            label="Crypto",
                        )
                    except Exception as e:
                        logger.error(f"Crypto fetch fout: {e}")

        return saved

    async def get_latest_price(self, symbol: str) -> float | None:
        """Get latest close price for a symbol from DB or Alpaca."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Candle).where(Candle.symbol == symbol)
                .order_by(Candle.timestamp.desc())
                .limit(1)
            )
            candle = result.scalar_one_or_none()
            if candle:
                return candle.close

        # Fallback: fetch from Alpaca
        if not self.settings.alpaca_configured:
            return None
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                if is_crypto(symbol):
                    pair = f"{_normalize_symbol(symbol)}/USD"
                    resp = await client.get(
                        f"{self.settings.alpaca_data_url}/v1beta3/crypto/us/latest/bars",
                        headers=self._data_headers(),
                        params={"symbols": pair},
                    )
                    if resp.status_code == 200:
                        bars = resp.json().get("bars", {})
                        bar = bars.get(pair, {})
                        return float(bar.get("c", 0)) or None
                else:
                    resp = await client.get(
                        f"{self.settings.alpaca_data_url}/v2/stocks/{symbol}/bars/latest",
                        headers=self._data_headers(),
                        params={"feed": "iex"},
                    )
                    if resp.status_code == 200:
                        return float(resp.json().get("bar", {}).get("c", 0)) or None
        except Exception:
            pass
        return None

    async def get_candles(self, symbol: str, timeframe: str = "1Day", limit: int = 50) -> list[Candle]:
        """Get candles from DB for technical analysis."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Candle).where(Candle.symbol == symbol, Candle.timeframe == timeframe)
                .order_by(Candle.timestamp.desc())
                .limit(limit)
            )
            candles = result.scalars().all()
            return list(reversed(candles))  # oldest first for TA
