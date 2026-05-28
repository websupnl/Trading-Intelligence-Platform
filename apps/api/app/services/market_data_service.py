import logging
from datetime import datetime, timezone, timedelta
import httpx
from sqlalchemy import select
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.candles import Candle
from app.services.alpaca_broker import CRYPTO_SYMBOLS, is_crypto

logger = logging.getLogger(__name__)


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
        crypto = [s.upper() for s in symbols if is_crypto(s)]
        stocks = [s.upper() for s in symbols if not is_crypto(s)]
        saved = 0

        async with httpx.AsyncClient(timeout=30) as client:
            # ── Stocks ────────────────────────────────────────────────────────
            if stocks:
                try:
                    resp = await client.get(
                        f"{self.settings.alpaca_data_url}/v2/stocks/bars",
                        headers=self._data_headers(),
                        params={
                            "symbols": ",".join(stocks[:50]),
                            "timeframe": timeframe,
                            "limit": limit,
                            "adjustment": "raw",
                            "feed": "iex",
                        },
                    )
                    if resp.status_code == 200:
                        saved += await self._save_bars(resp.json().get("bars", {}), timeframe, normalize=False)
                    else:
                        logger.warning(f"Stocks market data error: {resp.status_code}")
                except Exception as e:
                    logger.error(f"Stocks fetch fout: {e}")

            # ── Crypto ────────────────────────────────────────────────────────
            if crypto:
                # Alpaca crypto endpoint uses "BTC/USD" format
                crypto_pairs = [f"{s}/USD" for s in crypto]
                try:
                    resp = await client.get(
                        f"{self.settings.alpaca_data_url}/v2/crypto/bars",
                        headers=self._data_headers(),
                        params={
                            "symbols": ",".join(crypto_pairs[:50]),
                            "timeframe": timeframe,
                            "limit": limit,
                        },
                    )
                    if resp.status_code == 200:
                        # normalize=True strips '/USD' so stored as 'BTC', 'ETH', etc.
                        saved += await self._save_bars(resp.json().get("bars", {}), timeframe, normalize=True)
                    else:
                        logger.warning(f"Crypto market data error: {resp.status_code} — {resp.text[:200]}")
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
                        f"{self.settings.alpaca_data_url}/v2/crypto/latest/bars",
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
