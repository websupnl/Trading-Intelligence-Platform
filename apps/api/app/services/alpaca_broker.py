import logging
import uuid
import httpx
from typing import Optional, Any
from app.config import get_settings
from app.services.runtime_state import get_runtime_value

logger = logging.getLogger(__name__)
settings = get_settings()

# Alpaca-supported crypto base symbols
CRYPTO_SYMBOLS = {
    "BTC", "ETH", "SOL", "DOGE", "AVAX", "LINK", "LTC", "BCH", "UNI",
    "AAVE", "CRV", "BAT", "ALGO", "XTZ", "MKR", "SUSHI", "YFI",
}


def to_alpaca_symbol(symbol: str) -> str:
    base = symbol.upper().split("/")[0]
    if base in CRYPTO_SYMBOLS:
        return f"{base}/USD"
    return symbol.upper()


def is_crypto(symbol: str) -> bool:
    base = symbol.upper().split("/")[0]
    return base in CRYPTO_SYMBOLS or "/" in symbol


class AlpacaNotConfiguredError(Exception):
    pass


class AlpacaAPIError(Exception):
    pass


class AlpacaBroker:
    def __init__(self):
        if not settings.alpaca_configured:
            self._configured = False
        else:
            self._configured = True
            self._headers = {
                "APCA-API-KEY-ID": settings.alpaca_api_key,
                "APCA-API-SECRET-KEY": settings.alpaca_secret_key,
                "Content-Type": "application/json",
            }

    def _require_configured(self):
        if not self._configured:
            raise AlpacaNotConfiguredError("Alpaca API keys niet geconfigureerd. Vul ALPACA_API_KEY en ALPACA_SECRET_KEY in .env in.")

    async def get_account(self) -> dict:
        self._require_configured()
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{settings.alpaca_base_url}/v2/account", headers=self._headers, timeout=10)
            if resp.status_code != 200:
                raise AlpacaAPIError(f"Alpaca account error: {resp.status_code} {resp.text}")
            return resp.json()

    async def get_positions(self) -> list[dict]:
        self._require_configured()
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{settings.alpaca_base_url}/v2/positions", headers=self._headers, timeout=10)
            if resp.status_code != 200:
                raise AlpacaAPIError(f"Alpaca positions error: {resp.status_code}")
            return resp.json()

    async def get_asset(self, symbol: str) -> dict:
        self._require_configured()
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{settings.alpaca_base_url}/v2/assets/{symbol}", headers=self._headers, timeout=10)
            if resp.status_code != 200:
                raise AlpacaAPIError(f"Alpaca asset error: {resp.status_code}")
            return resp.json()

    async def get_orders(self, status: str = "open") -> list[dict]:
        self._require_configured()
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.alpaca_base_url}/v2/orders",
                headers=self._headers,
                params={"status": status, "limit": 100},
                timeout=10,
            )
            if resp.status_code != 200:
                raise AlpacaAPIError(f"Alpaca orders error: {resp.status_code}")
            return resp.json()

    async def submit_order(self, symbol: str, qty: Optional[float], notional: Optional[float],
                           side: str, order_type: str = "market", limit_price: Optional[float] = None,
                           stop_price: Optional[float] = None,
                           take_profit_price: Optional[float] = None) -> dict:
        mode = get_runtime_value("trading_mode", settings.trading_mode)
        if not self._configured:
            if mode == "paper":
                # Simulate paper order without Alpaca API keys
                return {
                    "id": str(uuid.uuid4()),
                    "symbol": symbol,
                    "side": side,
                    "type": order_type,
                    "status": "accepted",
                    "qty": str(qty or 0),
                    "notional": str(notional or 0),
                    "filled_avg_price": None,
                    "client_order_id": f"sim_{symbol}_{side}_{uuid.uuid4().hex[:8]}",
                    "simulated": True,
                }
            raise AlpacaNotConfiguredError("Alpaca API keys niet geconfigureerd. Vul ALPACA_API_KEY en ALPACA_SECRET_KEY in .env in.")
        live_enabled = get_runtime_value("live_trading_enabled", settings.live_trading_enabled)
        if not live_enabled and mode != "paper":
            raise AlpacaAPIError("Live trading is uitgeschakeld.")

        alpaca_sym = to_alpaca_symbol(symbol)
        tif = "gtc" if is_crypto(symbol) else "day"
        payload: dict[str, Any] = {"symbol": alpaca_sym, "side": side, "type": order_type, "time_in_force": tif}
        if notional and not is_crypto(symbol):
            payload["notional"] = str(notional)
        elif qty:
            payload["qty"] = str(qty)
        elif notional and is_crypto(symbol):
            # Alpaca crypto uses qty, not notional; use a minimal qty fallback
            payload["qty"] = "0.001"
        if limit_price:
            payload["limit_price"] = str(limit_price)

        # Use bracket order when both SL and TP are provided (equity only, not crypto)
        if stop_price and take_profit_price and not is_crypto(symbol):
            payload["order_class"] = "bracket"
            payload["take_profit"] = {"limit_price": str(round(take_profit_price, 4))}
            payload["stop_loss"] = {"stop_price": str(round(stop_price, 4))}
        elif stop_price:
            payload["stop_price"] = str(stop_price)

        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{settings.alpaca_base_url}/v2/orders", headers=self._headers, json=payload, timeout=15)
            if resp.status_code not in (200, 201):
                raise AlpacaAPIError(f"Order mislukt: {resp.status_code} {resp.text}")
            return resp.json()

    async def cancel_order(self, alpaca_order_id: str) -> bool:
        self._require_configured()
        async with httpx.AsyncClient() as client:
            resp = await client.delete(f"{settings.alpaca_base_url}/v2/orders/{alpaca_order_id}", headers=self._headers, timeout=10)
            return resp.status_code in (200, 204)

    async def close_position(self, symbol: str) -> dict:
        """Liquidate only the existing position; this must remain available as an emergency exit."""
        self._require_configured()
        async with httpx.AsyncClient() as client:
            resp = await client.delete(
                f"{settings.alpaca_base_url}/v2/positions/{symbol}",
                headers=self._headers,
                timeout=15,
            )
            if resp.status_code not in (200, 201, 202, 204):
                raise AlpacaAPIError(f"Positie sluiten mislukt: {resp.status_code} {resp.text}")
            return resp.json() if resp.content else {"symbol": symbol, "status": "accepted"}

    async def close_all_positions(self) -> list[dict]:
        """Liquidate all positions through Alpaca's close-all route."""
        self._require_configured()
        async with httpx.AsyncClient() as client:
            resp = await client.delete(
                f"{settings.alpaca_base_url}/v2/positions",
                headers=self._headers,
                params={"cancel_orders": "true"},
                timeout=20,
            )
            if resp.status_code not in (200, 202, 204, 207):
                raise AlpacaAPIError(f"Alle posities sluiten mislukt: {resp.status_code} {resp.text}")
            return resp.json() if resp.content else []

    async def get_portfolio_history(self, period: str = "1M", timeframe: str = "1D") -> dict:
        self._require_configured()
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.alpaca_base_url}/v2/account/portfolio/history",
                headers=self._headers,
                params={"period": period, "timeframe": timeframe},
                timeout=10,
            )
            if resp.status_code != 200:
                raise AlpacaAPIError(f"Portfolio history error: {resp.status_code}")
            return resp.json()

    async def get_clock(self) -> dict:
        self._require_configured()
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{settings.alpaca_base_url}/v2/clock", headers=self._headers, timeout=10)
            return resp.json()
