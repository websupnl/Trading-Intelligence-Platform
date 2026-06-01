import asyncio
import json
import logging
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class GokWebSocketManager:
    def __init__(self):
        self._connections: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._connections.append(ws)
        logger.info(f"Gok WS verbonden. Totaal: {len(self._connections)}")

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            if ws in self._connections:
                self._connections.remove(ws)
        logger.info(f"Gok WS verbroken. Totaal: {len(self._connections)}")

    async def broadcast(self, event_type: str, data: dict):
        if not self._connections:
            return
        message = json.dumps({"type": event_type, "data": data})
        dead = []
        async with self._lock:
            connections = list(self._connections)
        for ws in connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)

    async def send_to(self, ws: WebSocket, event_type: str, data: dict):
        try:
            await ws.send_text(json.dumps({"type": event_type, "data": data}))
        except Exception as e:
            logger.warning(f"WS send fout: {e}")
            await self.disconnect(ws)

    @property
    def active_count(self) -> int:
        return len(self._connections)


# Singleton — gedeeld door router en engine
gok_ws_manager = GokWebSocketManager()
