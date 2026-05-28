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
from app.services.token_tracker import usage_record, flush_usage
import httpx
from sqlalchemy import select
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.trades import Trade
from app.models.memory import MemoryEntry
from app.models.audit import AuditLog
from app.models.rules import PendingRule
from app.services.notifications import NotificationService
from app.services.ai_guard import is_ai_paused, is_ai_failure, pause_ai

logger = logging.getLogger(__name__)

REFLECTION_SYSTEM_PROMPT = """Je bent een meedogenloze trading coach. Je analyseert afgeronde trades om patronen te identificeren die het systeem winstgevender maken.

JE PRINCIPES
- Process > Outcome: een winnende trade kan slecht proces zijn, een verliezer kan goed proces zijn. Beoordeel BEIDE.
- Zoek de FOUT, niet de excuses. "De markt was irrationeel" is geen les.
- Pattern over individual: deze trade alleen leert weinig. Zoek de PATROON-categorie waar dit in valt.
- Concrete regels > vage adviezen. "Trade niet rond earnings" is een regel; "wees voorzichtig" is ruis.
- Eerlijk over edge: had het systeem een echte edge, of was dit luck/unluck?

CATEGORISEER DE TRADE (process_quality)
- excellent: signaal had echte edge, entry/exit timing was correct, risk management gevolgd
- adequate: signaal redelijk, niet perfect uitgevoerd maar verantwoord
- poor: signaal had geen echte edge, hindsight bias als rationale, bad timing
- gambled: geen edge, FOMO, ignored stops/sizing

KEY MISTAKES (kies de #1 grootste lesson)
- premature_entry: gekocht voor confirmatie, prijs werd nog rejected
- chasing: gekocht na extension, weinig ruimte tot resistance
- thesis_invalidation_ignored: bear case bewees zich maar positie behouden
- stop_too_tight: gestopt op normale ruis, niet op echte invalidatie
- stop_too_wide: liet verlies onnodig groeien
- early_exit: te vroeg uit een winning trade gestapt
- held_too_long: winst teruggegeven door geen partial profit
- correlation_blindspot: andere posities maakten dit een gestapeld risico
- no_edge: er was nooit een echte edge, alleen sentiment
- size_mismatch: positie te groot voor confidence, of te klein voor edge
- timing_bad: juiste richting maar slechte entry timing

RULE SUGGESTION
- Alleen voorstellen als de fout HERHAALBAAR/SYSTEMATISCH is, niet als one-off.
- Format: "[Wanneer X] [doe Y]" — actionable, niet aspirational.
- Voorbeelden goed: "Skip MSTR signalen als BTC >2% gedaald is op de dag", "Wacht op RSI<40 voor buy als 5-day return >10%"
- Voorbeelden slecht: "Wees voorzichtiger met crypto", "Beter risk management"

Geef ALLEEN geldig JSON terug."""


REFLECTION_PROMPT = """Reflecteer kritisch op deze afgeronde trade.

═══ TRADE DETAILS ═══
Asset: {symbol}
Richting: {side}
Entry prijs: ${entry}
Exit prijs: ${exit}
Hoeveelheid: {qty}
P&L: ${pnl} ({pnl_pct:.1f}%)
Trade duur: {duration}

═══ ENTRY RATIONALE ═══
{entry_reason}

═══ ANALYSE-STAPPEN ═══
1. Was er ECHT een edge bij entry, of was dit sentiment/hype?
2. Was de bear case voldoende serieus genomen, of weggewuifd?
3. Was de stop en TP op betekenisvolle technische niveaus, of arbitrair?
4. Bij verlies: had je het kunnen vermijden ZONDER hindsight bias?
5. Bij winst: was het skill of luck? Zou hetzelfde process meer wins produceren?
6. Welke categorie fout/insight is dit (zie key_mistake opties)?
7. Is er een SYSTEMATISCHE regel die helpt voorkomen/herhalen?

JSON formaat:
{{
  "lesson": "<harde les met concrete observaties, max 100 woorden>",
  "process_quality": "excellent" | "adequate" | "poor" | "gambled",
  "key_mistake": "<één van de mistake categorieën, of 'none' bij excellent process>",
  "outcome_vs_process": "<was uitkomst representatief voor process? max 40 woorden>",
  "rule_suggestion": "<concrete actionable regel of null als geen patroon>",
  "rule_trigger_condition": "<onder welke marktomstandigheden zou deze regel toeslaan? of null>",
  "pattern": "winning" | "losing" | "breakeven",
  "confidence_assessment": "<was entry confidence terecht? max 50 woorden>",
  "would_repeat": <true | false — zou je deze trade met dezelfde info weer doen?>,
  "next_time": "<wat anders, concreet, max 50 woorden>"
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
                mode = "paper" if "paper" in self.settings.alpaca_base_url else "live"

                try:
                    filled_at = datetime.fromisoformat(
                        filled_at_str.replace("Z", "+00:00")
                    ) if filled_at_str else datetime.now(timezone.utc)
                except Exception:
                    filled_at = datetime.now(timezone.utc)

                # For sell orders: try to close an existing open buy Trade instead of
                # creating a duplicate sell record
                if side == "sell" and fill_price:
                    open_buy = await db.execute(
                        select(Trade).where(
                            Trade.symbol == symbol,
                            Trade.status == "open",
                            Trade.side == "buy",
                        ).order_by(Trade.opened_at.asc()).limit(1)
                    )
                    open_trade = open_buy.scalar_one_or_none()
                    if open_trade:
                        entry = open_trade.entry_price or 0
                        pnl = (fill_price - entry) * (open_trade.quantity or qty)
                        pnl_pct = (pnl / (entry * (open_trade.quantity or qty)) * 100) if entry > 0 else 0
                        open_trade.exit_price = fill_price
                        open_trade.pnl = pnl
                        open_trade.pnl_pct = pnl_pct
                        open_trade.status = "closed"
                        open_trade.closed_at = filled_at
                        open_trade.exit_reason = f"Alpaca order {alpaca_id} uitgevoerd"
                        db.add(AuditLog(
                            action="trade_synced_from_alpaca",
                            actor="trade_tracker",
                            entity_type="trade",
                            details={"symbol": symbol, "side": side, "alpaca_id": alpaca_id, "pnl": pnl},
                            status="success",
                            created_at=datetime.now(timezone.utc),
                            updated_at=datetime.now(timezone.utc),
                        ))
                        created += 1
                        continue

                trade = Trade(
                    alpaca_order_id=alpaca_id,
                    symbol=symbol,
                    side=side,
                    quantity=qty,
                    entry_price=fill_price if side == "buy" else None,
                    exit_price=fill_price if side == "sell" else None,
                    mode=mode,
                    status="open" if side == "buy" else "closed",
                    entry_reason="Handmatig of auto-trader",
                    opened_at=filled_at,
                    closed_at=filled_at if side == "sell" else None,
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
        """Match a filled exit order to an open Trade, close it and compute P&L."""
        symbol = order.get("symbol", "")
        side = order.get("side", "buy")
        fill_price = float(order.get("filled_avg_price") or 0)
        alpaca_id = order.get("id", "")

        if not fill_price or not symbol or not alpaca_id:
            return False

        async with AsyncSessionLocal() as db:
            # Skip if this order was already processed as an exit
            already_exit = await db.execute(
                select(Trade).where(
                    Trade.exit_reason.contains(alpaca_id),
                ).limit(1)
            )
            if already_exit.scalar_one_or_none():
                return False

            # Skip entry orders — they are already recorded by auto_trader at submission
            entry_exists = await db.execute(
                select(Trade).where(Trade.alpaca_order_id == alpaca_id).limit(1)
            )
            if entry_exists.scalar_one_or_none():
                return False

            # Find the open trade that this exit order closes:
            # sell closes a long (buy), buy closes a short (sell)
            entry_side = "buy" if side == "sell" else "sell"
            result = await db.execute(
                select(Trade).where(
                    Trade.symbol == symbol,
                    Trade.status == "open",
                    Trade.side == entry_side,
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
        if not self.settings.anthropic_api_key or is_ai_paused():
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
            system_blocks = (
                [{"type": "text", "text": REFLECTION_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]
                if self.settings.anthropic_enable_prompt_caching else REFLECTION_SYSTEM_PROMPT
            )
            response = client.messages.create(
                model=self.settings.anthropic_model,
                max_tokens=900,
                temperature=0.3,
                system=system_blocks,
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
                await flush_usage(db, [usage_record(self.settings.anthropic_model, "trade_reflection", response.usage)])
                await db.commit()
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
            rule_suggestion = reflection.get("rule_suggestion")
            title = f"Trade {symbol} {side}: {'✅' if pnl and pnl > 0 else '❌'} {pattern} — P&L ${pnl:.2f}"

            async with AsyncSessionLocal() as db:
                memory = MemoryEntry(
                    memory_type="trade_lesson",
                    title=title[:500],
                    content=json.dumps({
                        "lesson": lesson,
                        "rule_suggestion": rule_suggestion,
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
                if rule_suggestion:
                    existing_rule = await db.execute(
                        select(PendingRule).where(
                            PendingRule.description == rule_suggestion,
                            PendingRule.status == "pending",
                        ).limit(1)
                    )
                    if not existing_rule.scalar_one_or_none():
                        db.add(PendingRule(
                            title=f"{symbol}: {rule_suggestion[:120]}",
                            description=rule_suggestion[:1000],
                            rule_type="risk_filter",
                            proposed_by="trade_tracker",
                            confidence=0.75 if reflection.get("would_repeat") is False else 0.6,
                            supporting_evidence=[{
                                "trade_id": trade_data["id"],
                                "symbol": symbol,
                                "pnl": pnl,
                                "pnl_pct": pnl_pct,
                                "pattern": pattern,
                                "key_mistake": reflection.get("key_mistake"),
                                "trigger_condition": reflection.get("rule_trigger_condition"),
                            }],
                            status="pending",
                            created_at=datetime.now(timezone.utc),
                            updated_at=datetime.now(timezone.utc),
                        ))

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
                await NotificationService(db).send(
                    "trade_reflection_written",
                    f"Trading OS - AI trade-les: {symbol} {side.upper()}",
                    (
                        f"P&L: ${pnl:.2f} ({pnl_pct:.1f}%)\n"
                        f"Les: {(lesson or 'Geen les gegenereerd')[:350]}"
                    ),
                    severity="info" if pnl >= 0 else "warning",
                    entity_type="trade",
                    entity_id=trade_data["id"],
                )

            # Write to memory file
            await self._write_memory_file(symbol, reflection, trade_data)
            logger.info(f"Reflectie geschreven voor {symbol} trade: {pattern}, P&L ${pnl:.2f}")

        except Exception as e:
            logger.error(f"Reflectie schrijven mislukt voor {symbol}: {e}")
            if is_ai_failure(e):
                await pause_ai("trade_tracker.reflection", e)

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
