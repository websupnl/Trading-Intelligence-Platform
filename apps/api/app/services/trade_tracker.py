"""
TradeTracker: Syncs closed positions from Alpaca, computes P&L,
writes AI reflections, and stores MemoryEntries for learning.
"""
import logging
import json
import os
from datetime import datetime, timezone
from typing import Optional
import anthropic
import httpx
from sqlalchemy import select
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.trades import Trade
from app.models.memory import MemoryEntry
from app.models.audit import AuditLog

logger = logging.getLogger(__name__)

REFLECTION_PROMPT = """Je bent een trading coach die lessen trekt uit afgeronde trades.

Trade samenvatting:
- Asset: {symbol}
- Richting: {side}
- Entry prijs: ${entry}
- Exit prijs: ${exit}
- Hoeveelheid: {qty}
- P&L: ${pnl} ({pnl_pct:.1f}%)
- Entry reden: {entry_reason}
- Trade duur: {duration}

Wat kunnen we leren van deze trade? Geef ALLEEN JSON:
{{
  "lesson": "<max 100 woorden: wat ging goed of fout, wat leren we>",
  "rule_suggestion": "<optionele concrete regel: bijv. 'Trade {symbol} niet rond earnings'> of null",
  "pattern": "winning" | "losing" | "breakeven",
  "confidence_assessment": "<was de entry terecht? max 50 woorden>",
  "next_time": "<wat anders doen? max 50 woorden>"
}}"""


class TradeTrackerService:
    def __init__(self):
        self.settings = get_settings()

    async def sync_closed_trades(self) -> int:
        """
        Fetch all filled orders from Alpaca, match with open Trade records,
        close them with P&L. Returns count of newly closed trades.
        """
        if not self.settings.alpaca_configured:
            return 0

        try:
            filled_orders = await self._fetch_filled_orders()
        except Exception as e:
            logger.error(f"Alpaca orders ophalen mislukt: {e}")
            return 0

        closed = 0
        for order in filled_orders:
            try:
                result = await self._process_order(order)
                if result:
                    closed += 1
            except Exception as e:
                logger.error(f"Trade verwerking fout {order.get('id')}: {e}")

        if closed > 0:
            logger.info(f"TradeTracker: {closed} trades gesloten en bijgewerkt")

        return closed

    async def sync_open_trades_from_orders(self) -> int:
        """
        Create Trade records for filled orders that don't have a DB entry yet.
        This handles trades placed manually or via auto-trader without DB record.
        """
        if not self.settings.alpaca_configured:
            return 0

        try:
            # Get all filled orders from last 30 days
            filled_orders = await self._fetch_filled_orders(limit=200)
        except Exception as e:
            logger.error(f"Orders sync mislukt: {e}")
            return 0

        created = 0
        async with AsyncSessionLocal() as db:
            for order in filled_orders:
                alpaca_id = order.get("id")
                if not alpaca_id:
                    continue

                # Check if already in DB
                existing = await db.execute(
                    select(Trade).where(Trade.alpaca_order_id == alpaca_id).limit(1)
                )
                if existing.scalar_one_or_none():
                    continue

                # Create trade record
                side = order.get("side", "buy")
                symbol = order.get("symbol", "")
                qty = float(order.get("filled_qty") or order.get("qty") or 1)
                fill_price = float(order.get("filled_avg_price") or 0)
                filled_at_str = order.get("filled_at") or order.get("created_at")

                try:
                    filled_at = datetime.fromisoformat(
                        filled_at_str.replace("Z", "+00:00")
                    ) if filled_at_str else datetime.now(timezone.utc)
                except Exception:
                    filled_at = datetime.now(timezone.utc)

                status = "closed" if order.get("status") == "filled" else "open"

                trade = Trade(
                    alpaca_order_id=alpaca_id,
                    symbol=symbol,
                    side=side,
                    quantity=qty,
                    entry_price=fill_price if side == "buy" else None,
                    exit_price=fill_price if side == "sell" else None,
                    mode="paper" if "paper" in self.settings.alpaca_base_url else "live",
                    status=status,
                    entry_reason="Handmatig of auto-trader",
                    opened_at=filled_at,
                    closed_at=filled_at if status == "closed" else None,
                )
                db.add(trade)
                created += 1

                # Audit log
                db.add(AuditLog(
                    action="trade_synced_from_alpaca",
                    actor="trade_tracker",
                    entity_type="trade",
                    details={"symbol": symbol, "side": side, "alpaca_id": alpaca_id},
                    status="success",
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                ))

            if created > 0:
                await db.commit()
                logger.info(f"TradeTracker: {created} nieuwe trade records aangemaakt")

        return created

    async def _process_order(self, order: dict) -> bool:
        """Match a filled order to an open Trade, close it and compute P&L."""
        symbol = order.get("symbol", "")
        side = order.get("side", "buy")
        fill_price = float(order.get("filled_avg_price") or 0)
        alpaca_id = order.get("id", "")

        if not fill_price or not symbol:
            return False

        async with AsyncSessionLocal() as db:
            # Find open trade for this symbol
            result = await db.execute(
                select(Trade).where(
                    Trade.symbol == symbol,
                    Trade.status == "open",
                    Trade.side == ("buy" if side == "sell" else "sell"),  # closing side
                ).order_by(Trade.opened_at.asc()).limit(1)
            )
            trade = result.scalar_one_or_none()

            if not trade:
                return False

            # Compute P&L
            entry = trade.entry_price or 0
            exit_p = fill_price
            qty = trade.quantity or 1

            if trade.side == "buy":
                pnl = (exit_p - entry) * qty
            else:
                pnl = (entry - exit_p) * qty

            pnl_pct = (pnl / (entry * qty) * 100) if entry > 0 else 0

            trade.exit_price = exit_p
            trade.pnl = pnl
            trade.pnl_pct = pnl_pct
            trade.status = "closed"
            trade.closed_at = datetime.now(timezone.utc)
            trade.exit_reason = f"Alpaca order {alpaca_id} uitgevoerd"

            await db.commit()
            await db.refresh(trade)

            # Now write AI reflection + memory (outside DB session to avoid timeout)
            trade_data = {
                "id": trade.id,
                "symbol": trade.symbol,
                "side": trade.side,
                "entry_price": entry,
                "exit_price": exit_p,
                "pnl": pnl,
                "pnl_pct": pnl_pct,
                "quantity": qty,
                "entry_reason": trade.entry_reason or "",
                "opened_at": trade.opened_at,
                "closed_at": trade.closed_at,
            }

        await self._write_reflection(trade_data)
        return True

    async def _write_reflection(self, trade_data: dict):
        """Write Claude reflection + MemoryEntry for a closed trade."""
        if not self.settings.anthropic_api_key:
            return

        symbol = trade_data["symbol"]
        side = trade_data["side"]
        entry = trade_data["entry_price"]
        exit_p = trade_data["exit_price"]
        pnl = trade_data["pnl"]
        pnl_pct = trade_data["pnl_pct"]
        qty = trade_data["quantity"]
        entry_reason = trade_data["entry_reason"]

        # Compute duration
        duration = "onbekend"
        if trade_data.get("opened_at") and trade_data.get("closed_at"):
            delta = trade_data["closed_at"] - trade_data["opened_at"]
            hours = int(delta.total_seconds() / 3600)
            duration = f"{hours}u" if hours >= 1 else f"{int(delta.total_seconds() / 60)}min"

        try:
            client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
            prompt = REFLECTION_PROMPT.format(
                symbol=symbol,
                side=side,
                entry=f"{entry:.2f}" if entry else "onbekend",
                exit=f"{exit_p:.2f}" if exit_p else "onbekend",
                qty=qty,
                pnl=f"{pnl:.2f}" if pnl is not None else "0",
                pnl_pct=pnl_pct or 0,
                entry_reason=entry_reason[:200] if entry_reason else "niet opgegeven",
                duration=duration,
            )
            response = client.messages.create(
                model=self.settings.anthropic_model,
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.content[0].text.strip()
            start = text.find("{")
            end = text.rfind("}") + 1
            reflection = {}
            if start >= 0 and end > start:
                reflection = json.loads(text[start:end])

            # Save reflection to Trade
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(Trade).where(Trade.id == trade_data["id"])
                )
                trade = result.scalar_one_or_none()
                if trade:
                    trade.ai_reflection = reflection
                    await db.commit()

            # Save MemoryEntry
            pattern = reflection.get("pattern", "unknown")
            lesson = reflection.get("lesson", "")
            title = f"Trade {symbol} {side}: {'✅' if pnl and pnl > 0 else '❌'} {pattern} — P&L ${pnl:.2f}"

            async with AsyncSessionLocal() as db:
                memory = MemoryEntry(
                    memory_type="trade_lesson",
                    title=title[:500],
                    content=json.dumps({
                        "lesson": lesson,
                        "rule_suggestion": reflection.get("rule_suggestion"),
                        "confidence_assessment": reflection.get("confidence_assessment"),
                        "next_time": reflection.get("next_time"),
                        "pnl": pnl,
                        "pnl_pct": pnl_pct,
                        "symbol": symbol,
                        "side": side,
                        "entry": entry,
                        "exit": exit_p,
                    }, ensure_ascii=False),
                    tags=["trade_lesson", symbol, pattern],
                    related_symbols=[symbol],
                    importance=min(1.0, abs(pnl_pct or 0) / 20) if pnl_pct else 0.5,
                    status="active",
                )
                db.add(memory)

                # Audit log
                db.add(AuditLog(
                    action="trade_reflection_written",
                    actor="trade_tracker",
                    entity_type="memory",
                    details={"symbol": symbol, "pnl": pnl, "pattern": pattern},
                    status="success",
                    message=lesson[:200] if lesson else None,
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                ))
                await db.commit()

            # Write to memory file
            await self._write_memory_file(symbol, reflection, trade_data)
            logger.info(f"Reflectie geschreven voor {symbol} trade: {pattern}, P&L ${pnl:.2f}")

        except Exception as e:
            logger.error(f"Reflectie schrijven mislukt voor {symbol}: {e}")

    async def _write_memory_file(self, symbol: str, reflection: dict, trade_data: dict):
        """Write reflection to memory/trades/ filesystem."""
        try:
            # Find the memory/trades dir relative to project root
            base = os.environ.get("MEMORY_DIR", "/app/memory")
            trades_dir = os.path.join(base, "trades")
            os.makedirs(trades_dir, exist_ok=True)

            date_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
            filename = f"{date_str}_{symbol}_{trade_data['side']}.md"
            path = os.path.join(trades_dir, filename)

            pnl = trade_data.get("pnl", 0)
            pnl_pct = trade_data.get("pnl_pct", 0)
            content = f"""# Trade Lesson: {symbol} {trade_data['side']}

**Datum:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}
**Patroon:** {reflection.get('pattern', 'unknown')}
**P&L:** ${pnl:.2f} ({pnl_pct:.1f}%)

## Les
{reflection.get('lesson', 'Geen les gegenereerd')}

## Confidence Assessment
{reflection.get('confidence_assessment', 'N/A')}

## Volgende keer
{reflection.get('next_time', 'N/A')}

## Regelvoorstel
{reflection.get('rule_suggestion') or 'Geen regelvoorstel'}

## Trade Details
- Entry: ${trade_data.get('entry_price', 0):.2f}
- Exit: ${trade_data.get('exit_price', 0):.2f}
- Qty: {trade_data.get('quantity', 0)}
- Entry reden: {trade_data.get('entry_reason', 'onbekend')}
"""
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception as e:
            logger.warning(f"Memory file schrijven mislukt: {e}")

    async def get_performance_stats(self) -> dict:
        """Compute performance statistics from closed trades."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Trade).where(Trade.status == "closed", Trade.pnl.isnot(None))
            )
            trades = result.scalars().all()

        if not trades:
            return {
                "total_trades": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "win_rate": 0.0,
                "total_pnl": 0.0,
                "avg_pnl": 0.0,
                "avg_win": 0.0,
                "avg_loss": 0.0,
                "best_trade": None,
                "worst_trade": None,
                "profit_factor": 0.0,
            }

        pnls = [t.pnl for t in trades if t.pnl is not None]
        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p <= 0]

        gross_profit = sum(wins) if wins else 0
        gross_loss = abs(sum(losses)) if losses else 0

        best = max(trades, key=lambda t: t.pnl or 0, default=None)
        worst = min(trades, key=lambda t: t.pnl or 0, default=None)

        # Build P&L over time series
        sorted_trades = sorted(trades, key=lambda t: t.closed_at or datetime.min)
        cumulative = 0.0
        pnl_series = []
        for t in sorted_trades:
            cumulative += t.pnl or 0
            pnl_series.append({
                "date": t.closed_at.isoformat() if t.closed_at else None,
                "pnl": round(t.pnl or 0, 2),
                "cumulative": round(cumulative, 2),
                "symbol": t.symbol,
            })

        return {
            "total_trades": len(pnls),
            "winning_trades": len(wins),
            "losing_trades": len(losses),
            "win_rate": round(len(wins) / len(pnls) * 100, 1) if pnls else 0.0,
            "total_pnl": round(sum(pnls), 2),
            "avg_pnl": round(sum(pnls) / len(pnls), 2) if pnls else 0.0,
            "avg_win": round(sum(wins) / len(wins), 2) if wins else 0.0,
            "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0.0,
            "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0.0,
            "best_trade": {
                "symbol": best.symbol,
                "pnl": round(best.pnl, 2),
                "date": best.closed_at.isoformat() if best.closed_at else None,
            } if best else None,
            "worst_trade": {
                "symbol": worst.symbol,
                "pnl": round(worst.pnl, 2),
                "date": worst.closed_at.isoformat() if worst.closed_at else None,
            } if worst else None,
            "pnl_series": pnl_series,
        }

    async def _fetch_filled_orders(self, limit: int = 100) -> list[dict]:
        """Fetch filled orders from Alpaca."""
        headers = {
            "APCA-API-KEY-ID": self.settings.alpaca_api_key,
            "APCA-API-SECRET-KEY": self.settings.alpaca_secret_key,
        }
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{self.settings.alpaca_base_url}/v2/orders",
                headers=headers,
                params={"status": "filled", "limit": limit, "direction": "desc"},
            )
            if resp.status_code != 200:
                logger.warning(f"Alpaca orders fout: {resp.status_code}")
                return []
            return resp.json()
