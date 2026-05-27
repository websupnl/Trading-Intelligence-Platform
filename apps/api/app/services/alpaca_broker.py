import logging
import httpx
from typing import Optional, Any
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


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
                           stop_price: Optional[float] = None) -> dict:
        self._require_configured()
        if settings.live_trading_enabled is False and settings.trading_mode != "paper":
            raise AlpacaAPIError("Live trading is uitgeschakeld.")

        payload: dict[str, Any] = {"symbol": symbol, "side": side, "type": order_type, "time_in_force": "day"}
        if notional:
            payload["notional"] = str(notional)
        elif qty:
            payload["qty"] = str(qty)
        if limit_price:
            payload["limit_price"] = str(limit_price)
        if stop_price:
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
