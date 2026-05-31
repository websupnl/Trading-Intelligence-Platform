"""
Bitvavo broker via CCXT — EUR-based crypto exchange for NL users.

Handles: BTC/ETH/SOL and all crypto assets via Bitvavo API.
Falls back to paper simulation when BITVAVO_API_KEY is not set.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)


def _make_pair(symbol: str) -> str:
    base = symbol.upper().split("/")[0]
    return f"{base}/EUR"


class BitvavoNotConfiguredError(Exception):
    pass


class BitvavoAPIError(Exception):
    pass


class CCXTBroker:
    """Async Bitvavo broker. Same interface as AlpacaBroker for drop-in use."""

    def __init__(self):
        self.settings = get_settings()
        self._exchange = None

    @property
    def _configured(self) -> bool:
        return self.settings.bitvavo_configured

    def _get_exchange(self):
        if self._exchange is None:
            try:
                import ccxt.async_support as ccxt
                self._exchange = ccxt.bitvavo({
                    "apiKey": self.settings.bitvavo_api_key,
                    "secret": self.settings.bitvavo_api_secret,
                    "enableRateLimit": True,
                    "options": {"defaultType": "spot"},
                })
            except ImportError:
                raise BitvavoAPIError("ccxt not installed — run: pip install ccxt")
        return self._exchange

    async def close(self):
        if self._exchange:
            await self._exchange.close()
            self._exchange = None

    async def get_account(self) -> dict:
        if not self._configured:
            return {"equity": 1000.0, "cash": 1000.0, "currency": "EUR", "paper": True}
        try:
            ex = self._get_exchange()
            balance = await ex.fetch_balance()
            total_eur = balance.get("EUR", {}).get("total", 0) or 0
            # Add EUR value of all held crypto positions
            for coin, amounts in balance.items():
                if coin in ("EUR", "info", "free", "used", "total"):
                    continue
                free = amounts.get("total", 0) or 0
                if free > 0:
                    try:
                        ticker = await ex.fetch_ticker(f"{coin}/EUR")
                        total_eur += free * (ticker.get("last") or 0)
                    except Exception:
                        pass
            return {"equity": total_eur, "cash": balance.get("EUR", {}).get("free", 0), "currency": "EUR"}
        except Exception as e:
            raise BitvavoAPIError(f"Bitvavo account ophalen mislukt: {e}") from e

    async def get_latest_price(self, symbol: str) -> Optional[float]:
        pair = _make_pair(symbol)
        if not self._configured:
            return None
        try:
            ex = self._get_exchange()
            ticker = await ex.fetch_ticker(pair)
            return float(ticker.get("last") or 0) or None
        except Exception as e:
            logger.warning(f"Bitvavo prijs ophalen mislukt voor {pair}: {e}")
            return None

    async def get_latest_prices_batch(self, symbols: list[str]) -> dict[str, float]:
        if not self._configured or not symbols:
            return {}
        try:
            ex = self._get_exchange()
            tickers = await ex.fetch_tickers([_make_pair(s) for s in symbols])
            result = {}
            for symbol in symbols:
                pair = _make_pair(symbol)
                t = tickers.get(pair, {})
                price = t.get("last")
                if price:
                    result[symbol] = float(price)
            return result
        except Exception as e:
            logger.warning(f"Bitvavo batch prijs ophalen mislukt: {e}")
            return {}

    async def submit_order(
        self,
        symbol: str,
        side: str,
        qty: Optional[float] = None,
        notional: Optional[float] = None,
    ) -> dict:
        pair = _make_pair(symbol)
        mode = self.settings.trading_mode

        if not self._configured or mode == "paper":
            # Paper simulation — return fake fill
            price = await self.get_latest_price(symbol) or 100.0
            filled_qty = qty if qty else (notional / price if notional and price else 0)
            order_id = f"paper-bv-{symbol}-{int(datetime.now(timezone.utc).timestamp())}"
            logger.info(f"[PAPER Bitvavo] {side} {symbol} qty={filled_qty:.6f} @ €{price:.4f}")
            return {
                "id": order_id,
                "status": "filled",
                "filled_qty": filled_qty,
                "filled_avg_price": price,
                "symbol": symbol,
                "side": side,
                "paper": True,
            }

        try:
            ex = self._get_exchange()
            if notional and not qty:
                ticker = await ex.fetch_ticker(pair)
                price = float(ticker.get("last") or 0)
                if price <= 0:
                    raise BitvavoAPIError(f"Ongeldige prijs voor {pair}")
                qty = notional / price

            order = await ex.create_order(
                symbol=pair,
                type="market",
                side=side,
                amount=round(qty, 8),
            )
            return {
                "id": order.get("id"),
                "status": order.get("status"),
                "filled_qty": float(order.get("filled") or order.get("amount") or qty),
                "filled_avg_price": float(order.get("average") or order.get("price") or 0),
                "symbol": symbol,
                "side": side,
            }
        except Exception as e:
            raise BitvavoAPIError(f"Bitvavo order mislukt voor {symbol}: {e}") from e

    async def close_position(self, symbol: str) -> None:
        base = symbol.upper().split("/")[0]
        pair = _make_pair(base)
        mode = self.settings.trading_mode

        if not self._configured or mode == "paper":
            logger.info(f"[PAPER Bitvavo] Positie gesloten: {base}")
            return

        try:
            ex = self._get_exchange()
            balance = await ex.fetch_balance()
            qty = balance.get(base, {}).get("free", 0)
            if qty and qty > 0:
                await ex.create_order(pair, "market", "sell", round(qty, 8))
                logger.info(f"Bitvavo positie gesloten: {base} qty={qty:.6f}")
        except Exception as e:
            logger.warning(f"Bitvavo positie sluiten mislukt voor {base}: {e}")
