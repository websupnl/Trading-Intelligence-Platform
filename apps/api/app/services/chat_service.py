import json
import logging
import anthropic
from typing import AsyncIterator
from app.config import get_settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Je bent een intelligente trading assistent voor Trading OS - een autonoom trading platform.
Je hebt toegang tot real-time data via tools. Spreek Nederlands tenzij de gebruiker Engels gebruikt.

Je kunt:
- Portfolio, posities, orders, signalen, nieuws en geruchten opvragen
- Risk status en bot configuratie controleren
- Trade historiek en performance analyseren
- Tickers analyseren met technische indicatoren
- Suggesties geven voor settings aanpassingen

Je kunt GEEN trades uitvoeren — daarvoor gebruikt de gebruiker de UI.
Wees beknopt maar volledig. Bij financiële adviezen: benoem altijd risico's."""

TOOLS = [
    {
        "name": "get_portfolio",
        "description": "Haal portfolio/account informatie op: balans, equity, koopkracht, dag P&L",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "get_positions",
        "description": "Haal alle open posities op met symbool, hoeveelheid, gemiddelde prijs en P&L",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "get_signals",
        "description": "Haal recente trading signalen op met asset, richting, confidence, entry/stop/TP",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 10, "description": "Aantal signalen (max 50)"},
                "status": {"type": "string", "default": "all", "description": "Filter: pending, paper_traded, all"}
            }
        }
    },
    {
        "name": "get_news",
        "description": "Haal recent marktnieuws op met sentiment en impact scores",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 10, "description": "Aantal items (max 30)"},
                "ticker": {"type": "string", "description": "Filter op ticker symbol (optioneel)"}
            }
        }
    },
    {
        "name": "get_rumours",
        "description": "Haal actieve marktgeruchten op met confidence en manipulation risk",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 10}
            }
        }
    },
    {
        "name": "get_risk_status",
        "description": "Haal de huidige risk engine status op: kill switch, trading mode, limieten, require_manual_confirmation",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "get_bot_status",
        "description": "Controleer of de trading bot autonoom actief is. Geeft blockers, recent signalen en trades",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "get_performance",
        "description": "Haal trade performance statistieken op: win rate, totale P&L, profit factor, beste/slechtste trades",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "get_trade_history",
        "description": "Haal recente gesloten trades op met P&L, entry/exit prijzen en AI lessen",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 10, "description": "Aantal trades (max 50)"}
            }
        }
    },
    {
        "name": "analyze_ticker",
        "description": "Analyseer een specifiek aandeel of crypto: prijs, RSI, MACD, trend, recente signalen",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "Ticker symbool, bijv. AAPL, BTC, NVDA"}
            },
            "required": ["symbol"]
        }
    },
    {
        "name": "get_config_status",
        "description": "Haal de systeem configuratie op: welke integraties actief zijn (Alpaca, Anthropic, etc.)",
        "input_schema": {"type": "object", "properties": {}}
    },
]


def _serialize_content(content) -> list:
    """Serialize Anthropic SDK ContentBlock objects to plain dicts for message history."""
    result = []
    for block in content:
        block_type = getattr(block, "type", None)
        if block_type == "text":
            result.append({"type": "text", "text": block.text})
        elif block_type == "tool_use":
            result.append({
                "type": "tool_use",
                "id": block.id,
                "name": block.name,
                "input": block.input,
            })
        elif isinstance(block, dict):
            result.append(block)
    return result


async def execute_tool(name: str, inputs: dict) -> str:
    """Execute a tool by calling internal services directly."""
    try:
        if name == "get_portfolio":
            from app.services.alpaca_broker import AlpacaBroker
            broker = AlpacaBroker()
            account = await broker.get_account()
            return json.dumps({
                "portfolio_value": account.get("portfolio_value"),
                "equity": account.get("equity"),
                "cash": account.get("cash"),
                "buying_power": account.get("buying_power"),
                "day_pnl": float(account.get("equity", 0)) - float(account.get("last_equity", account.get("equity", 0))),
                "status": account.get("status"),
            }, default=str)

        elif name == "get_positions":
            from app.services.alpaca_broker import AlpacaBroker
            broker = AlpacaBroker()
            positions = await broker.get_positions()
            return json.dumps(positions[:20], default=str)

        elif name == "get_signals":
            from app.database import AsyncSessionLocal
            from app.models.signals import Signal
            from sqlalchemy import select, desc
            limit = min(int(inputs.get("limit", 10)), 50)
            status_filter = inputs.get("status", "all")
            async with AsyncSessionLocal() as db:
                q = select(Signal).order_by(desc(Signal.created_at)).limit(limit)
                if status_filter != "all":
                    q = q.where(Signal.status == status_filter)
                result = await db.execute(q)
                signals = result.scalars().all()
                return json.dumps([{
                    "id": str(s.id),
                    "asset": s.asset,
                    "direction": s.direction,
                    "confidence": round(s.confidence, 2),
                    "status": s.status,
                    "reason": (s.reason or "")[:200],
                    "suggested_entry": s.suggested_entry,
                    "suggested_stop": s.suggested_stop,
                    "suggested_take_profit": s.suggested_take_profit,
                    "risk_reward": s.risk_reward,
                    "created_at": str(s.created_at),
                } for s in signals])

        elif name == "get_news":
            from app.database import AsyncSessionLocal
            from app.models.news import NewsItem
            from sqlalchemy import select, desc
            limit = min(int(inputs.get("limit", 10)), 30)
            ticker = inputs.get("ticker", "").upper()
            async with AsyncSessionLocal() as db:
                q = select(NewsItem).order_by(desc(NewsItem.published_at)).limit(limit)
                result = await db.execute(q)
                items = result.scalars().all()
                filtered = items
                if ticker:
                    filtered = [n for n in items if ticker in (n.tickers or [])]
                return json.dumps([{
                    "title": n.title,
                    "source": n.source,
                    "sentiment": n.sentiment,
                    "impact_score": n.impact_score,
                    "tickers": n.tickers,
                    "published_at": str(n.published_at),
                } for n in filtered[:limit]])

        elif name == "get_rumours":
            from app.database import AsyncSessionLocal
            from app.models.rumours import Rumour
            from sqlalchemy import select, desc
            limit = min(int(inputs.get("limit", 10)), 30)
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Rumour).where(Rumour.status == "active").order_by(desc(Rumour.created_at)).limit(limit))
                items = result.scalars().all()
                return json.dumps([{
                    "title": r.title,
                    "related_assets": r.related_assets,
                    "confidence": r.confidence,
                    "manipulation_risk": r.manipulation_risk,
                    "recommendation": r.recommendation,
                    "created_at": str(r.created_at),
                } for r in items])

        elif name == "get_risk_status":
            from app.services.risk_engine import RiskEngine
            engine = RiskEngine()
            status = await engine.get_status()
            return json.dumps(status, default=str)

        elif name == "get_bot_status":
            from app.config import get_settings
            from app.services.runtime_state import get_runtime_value
            from app.database import AsyncSessionLocal
            from app.models.signals import Signal
            from app.models.trades import Trade
            from app.models.audit import AuditLog
            from sqlalchemy import select, func
            from datetime import datetime, timezone, timedelta
            settings = get_settings()
            now = datetime.now(timezone.utc)
            since_1h = now - timedelta(hours=1)
            kill_switch = get_runtime_value("kill_switch_enabled", settings.kill_switch_enabled)
            require_manual = get_runtime_value("require_manual_confirmation", settings.require_manual_confirmation)
            trading_mode = get_runtime_value("trading_mode", settings.trading_mode)
            blockers = []
            if kill_switch:
                blockers.append("kill_switch_enabled")
            if require_manual:
                blockers.append("require_manual_confirmation=True")
            if not settings.anthropic_api_key:
                blockers.append("ANTHROPIC_API_KEY niet ingesteld")
            if not settings.alpaca_configured:
                blockers.append("Alpaca niet geconfigureerd")
            async with AsyncSessionLocal() as db:
                r = await db.execute(select(func.count()).where(Signal.created_at >= since_1h))
                recent_signals = r.scalar() or 0
                r = await db.execute(select(func.count()).where(Trade.opened_at >= since_1h))
                recent_trades = r.scalar() or 0
                r = await db.execute(select(func.count()).where(Trade.status == "open"))
                open_trades = r.scalar() or 0
                r = await db.execute(
                    select(AuditLog.created_at)
                    .where(AuditLog.action == "auto_trade_executed")
                    .order_by(AuditLog.created_at.desc()).limit(1)
                )
                last_trade = r.scalar_one_or_none()
            return json.dumps({
                "ready": len(blockers) == 0,
                "blockers": blockers,
                "trading_mode": trading_mode,
                "kill_switch": kill_switch,
                "require_manual_confirmation": require_manual,
                "recent_signals_1h": recent_signals,
                "recent_trades_1h": recent_trades,
                "open_trades": open_trades,
                "last_auto_trade": str(last_trade) if last_trade else "Nog geen trades",
            })

        elif name == "get_performance":
            from app.database import AsyncSessionLocal
            from app.models.trades import Trade
            from sqlalchemy import select, func
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Trade).where(Trade.status == "closed", Trade.pnl.isnot(None)))
                trades = result.scalars().all()
                if not trades:
                    return json.dumps({"message": "Nog geen gesloten trades"})
                wins = [t for t in trades if (t.pnl or 0) > 0]
                losses = [t for t in trades if (t.pnl or 0) <= 0]
                total_pnl = sum(t.pnl or 0 for t in trades)
                gross_profit = sum(t.pnl for t in wins if t.pnl)
                gross_loss = abs(sum(t.pnl for t in losses if t.pnl))
                return json.dumps({
                    "total_trades": len(trades),
                    "win_trades": len(wins),
                    "loss_trades": len(losses),
                    "win_rate_pct": round(len(wins) / len(trades) * 100, 1),
                    "total_pnl": round(total_pnl, 2),
                    "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else None,
                    "avg_win": round(gross_profit / len(wins), 2) if wins else 0,
                    "avg_loss": round(-gross_loss / len(losses), 2) if losses else 0,
                    "best_trade": round(max(t.pnl or 0 for t in trades), 2),
                    "worst_trade": round(min(t.pnl or 0 for t in trades), 2),
                })

        elif name == "get_trade_history":
            from app.database import AsyncSessionLocal
            from app.models.trades import Trade
            from sqlalchemy import select, desc
            limit = min(int(inputs.get("limit", 10)), 50)
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(Trade).where(Trade.status == "closed")
                    .order_by(desc(Trade.closed_at)).limit(limit)
                )
                trades = result.scalars().all()
                return json.dumps([{
                    "symbol": t.symbol,
                    "side": t.side,
                    "pnl": round(t.pnl or 0, 2),
                    "pnl_pct": round(t.pnl_pct or 0, 2),
                    "entry_price": t.entry_price,
                    "exit_price": t.exit_price,
                    "closed_at": str(t.closed_at),
                } for t in trades])

        elif name == "analyze_ticker":
            symbol = inputs.get("symbol", "").upper()
            if not symbol:
                return json.dumps({"error": "Symbol vereist"})
            from app.database import AsyncSessionLocal
            from app.models.candles import Candle
            from app.models.signals import Signal
            from app.services.technical_analysis import analyze as ta_analyze
            from sqlalchemy import select, desc
            async with AsyncSessionLocal() as db:
                r = await db.execute(
                    select(Candle).where(Candle.symbol == symbol, Candle.timeframe == "1Day")
                    .order_by(Candle.timestamp.desc()).limit(50)
                )
                candles = list(reversed(r.scalars().all()))
                r2 = await db.execute(
                    select(Signal).where(Signal.asset == symbol)
                    .order_by(desc(Signal.created_at)).limit(3)
                )
                recent_signals = r2.scalars().all()
            if not candles:
                return json.dumps({"symbol": symbol, "message": "Geen candle data beschikbaar. Market data fetch loopt elk uur."})
            ta = ta_analyze(candles)
            latest = candles[-1]
            return json.dumps({
                "symbol": symbol,
                "latest_price": latest.close,
                "change_1d_pct": round((latest.close - candles[-2].close) / candles[-2].close * 100, 2) if len(candles) >= 2 else None,
                "ta_score": round(ta.score, 2) if ta else None,
                "rsi": round(ta.rsi, 1) if ta and ta.rsi else None,
                "macd_signal": ta.macd_signal if ta else None,
                "trend": ta.trend if ta else None,
                "summary": ta.summary if ta else None,
                "recent_signals": [{"direction": s.direction, "confidence": s.confidence, "status": s.status} for s in recent_signals],
            }, default=str)

        elif name == "get_config_status":
            from app.services.config_service import get_config_status
            cfg = get_config_status()
            return json.dumps({
                "alpaca": {"configured": cfg.alpaca.configured, "status": cfg.alpaca.status},
                "anthropic": {"configured": cfg.anthropic.configured},
                "openai": {"configured": cfg.openai.configured},
                "trading_mode": cfg.trading_mode,
                "live_trading_enabled": cfg.live_trading_enabled,
            })

        else:
            return json.dumps({"error": f"Onbekende tool: {name}"})

    except Exception as e:
        logger.warning(f"Tool {name} fout: {e}")
        return json.dumps({"error": str(e), "tool": name})


async def stream_chat(messages: list[dict], context: str | None = None) -> AsyncIterator[str]:
    """
    Stream chat response as SSE data lines.
    Yields strings like: 'data: {"type": "text", "text": "..."}\n\n'
    Uses non-streaming for tool-use iterations, streaming for final text response.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        yield 'data: {"type": "error", "text": "ANTHROPIC_API_KEY niet geconfigureerd"}\n\n'
        return

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    system = SYSTEM_PROMPT
    if context:
        system += f"\n\nHuidige pagina: {context}"

    current_messages = list(messages)
    max_iterations = 6

    for iteration in range(max_iterations):
        is_last_iteration = iteration == max_iterations - 1

        # Non-streaming call to detect tool use
        response = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=min(settings.anthropic_max_tokens, 1024),
            system=system,
            tools=TOOLS,
            messages=current_messages,
        )

        has_tool_use = any(getattr(block, "type", None) == "tool_use" for block in response.content)

        if not has_tool_use or is_last_iteration:
            # Final response — stream the text
            for block in response.content:
                if getattr(block, "type", None) == "text":
                    text = block.text
                    # Yield in small chunks for streaming feel
                    chunk_size = 15
                    for i in range(0, len(text), chunk_size):
                        yield f'data: {json.dumps({"type": "text", "text": text[i:i+chunk_size]})}\n\n'
            break

        # Handle tool calls
        serialized_content = _serialize_content(response.content)
        current_messages.append({"role": "assistant", "content": serialized_content})

        tool_results = []
        for block in response.content:
            if getattr(block, "type", None) == "tool_use":
                # Notify frontend immediately
                yield f'data: {json.dumps({"type": "tool_call", "tool": block.name})}\n\n'
                # Execute tool
                result = await execute_tool(block.name, block.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                })

        current_messages.append({"role": "user", "content": tool_results})

    yield 'data: {"type": "done"}\n\n'
