import json
import anthropic
from typing import AsyncIterator
from app.config import get_settings

SYSTEM_PROMPT = """Je bent een intelligente trading assistent voor een Trading Intelligence Platform.
Je hebt toegang tot real-time data via tools: portfolio, posities, orders, signalen, nieuws, geruchten en risk status.
Spreek Nederlands tenzij de gebruiker een andere taal gebruikt.
Wees beknopt maar volledig. Bij financiële acties: wees voorzichtig en benoem risico's.
Je kunt analyses uitvoeren, data opvragen en inzichten geven. Je kunt GEEN trades uitvoeren — daarvoor moet de gebruiker de UI gebruiken."""

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
        "name": "get_orders",
        "description": "Haal recente orders op",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["open", "closed", "all"], "default": "open", "description": "Order status filter"}
            }
        }
    },
    {
        "name": "get_signals",
        "description": "Haal recente trading signalen op met symbool, richting, confidence en status",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 10, "description": "Aantal signalen (max 50)"}
            }
        }
    },
    {
        "name": "get_news",
        "description": "Haal recent marktnieuws op",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 10, "description": "Aantal nieuwsitems (max 50)"}
            }
        }
    },
    {
        "name": "get_rumours",
        "description": "Haal actieve marktgeruchten op",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 10, "description": "Aantal geruchten"}
            }
        }
    },
    {
        "name": "get_risk_status",
        "description": "Haal de huidige risk engine status op: kill switch, trading mode, limieten",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "get_config_status",
        "description": "Haal de systeem configuratie status op: welke integraties actief zijn",
        "input_schema": {"type": "object", "properties": {}}
    },
]


async def execute_tool(name: str, inputs: dict) -> str:
    """Execute a tool by calling internal services directly."""
    try:
        if name == "get_portfolio":
            from app.services.alpaca_broker import AlpacaBroker
            broker = AlpacaBroker()
            account = await broker.get_account()
            return json.dumps(account, default=str)

        elif name == "get_positions":
            from app.services.alpaca_broker import AlpacaBroker
            broker = AlpacaBroker()
            positions = await broker.get_positions()
            return json.dumps(positions, default=str)

        elif name == "get_orders":
            from app.services.alpaca_broker import AlpacaBroker
            broker = AlpacaBroker()
            status = inputs.get("status", "open")
            orders = await broker.get_orders(status=status)
            return json.dumps(orders, default=str)

        elif name == "get_signals":
            from app.database import AsyncSessionLocal
            from app.models.signals import Signal
            from sqlalchemy import select, desc
            limit = min(int(inputs.get("limit", 10)), 50)
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Signal).order_by(desc(Signal.created_at)).limit(limit))
                signals = result.scalars().all()
                return json.dumps([{
                    "id": str(s.id),
                    "symbol": s.symbol,
                    "direction": s.direction,
                    "confidence": s.confidence,
                    "status": s.status,
                    "source": s.source,
                    "created_at": str(s.created_at),
                } for s in signals])

        elif name == "get_news":
            from app.database import AsyncSessionLocal
            from app.models.news import NewsItem
            from sqlalchemy import select, desc
            limit = min(int(inputs.get("limit", 10)), 50)
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(NewsItem).order_by(desc(NewsItem.published_at)).limit(limit))
                items = result.scalars().all()
                return json.dumps([{
                    "title": n.title,
                    "source": n.source,
                    "sentiment": n.sentiment,
                    "published_at": str(n.published_at),
                } for n in items])

        elif name == "get_rumours":
            from app.database import AsyncSessionLocal
            from app.models.rumours import Rumour
            from sqlalchemy import select, desc
            limit = min(int(inputs.get("limit", 10)), 50)
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Rumour).order_by(desc(Rumour.created_at)).limit(limit))
                items = result.scalars().all()
                return json.dumps([{
                    "title": getattr(r, "title", ""),
                    "content": getattr(r, "content", "")[:200],
                    "confidence": getattr(r, "confidence", None),
                    "status": getattr(r, "status", ""),
                    "created_at": str(r.created_at),
                } for r in items])

        elif name == "get_risk_status":
            from app.services.risk_engine import RiskEngine
            engine = RiskEngine()
            status = await engine.get_status()
            return json.dumps(status, default=str)

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
        return json.dumps({"error": str(e), "tool": name})


async def stream_chat(messages: list[dict], context: str | None = None) -> AsyncIterator[str]:
    """
    Stream chat response as SSE data lines.
    Yields strings like: 'data: {"type": "text", "text": "..."}\n\n'
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        yield 'data: {"type": "error", "text": "ANTHROPIC_API_KEY niet geconfigureerd"}\n\n'
        return

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    system = SYSTEM_PROMPT
    if settings.anthropic_enable_web_search:
        system += "\n\nJe hebt toegang tot internet zoeken via de web_search tool. Gebruik dit voor actueel nieuws, koersen, earnings, en marktonderzoek."
    if context:
        system += f"\n\nHuidige pagina context: {context}"

    # Agentic tool-use loop (non-streaming tool calls, streaming final text)
    current_messages = list(messages)
    max_iterations = 5

    for iteration in range(max_iterations):
        # Build tools list
        tools_list = list(TOOLS)
        if settings.anthropic_enable_web_search:
            tools_list.append({
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": 5,
            })

        # Non-streaming call to detect tool use
        response = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=settings.anthropic_max_tokens,
            system=system,
            tools=tools_list,
            messages=current_messages,
            betas=["web-search-2025-03-05"] if settings.anthropic_enable_web_search else [],
        )

        # Collect text from this response
        has_tool_use = False
        for block in response.content:
            if block.type == "text":
                # Stream the text token by token (simulate by yielding the whole block)
                # For true streaming we'd use streaming API, but tool loop complicates that
                text = block.text
                # Yield in chunks for a streaming feel
                chunk_size = 10
                for i in range(0, len(text), chunk_size):
                    chunk = text[i:i+chunk_size]
                    yield f'data: {json.dumps({"type": "text", "text": chunk})}\n\n'

            elif block.type == "tool_use":
                has_tool_use = True
                # Notify frontend about tool call
                yield f'data: {json.dumps({"type": "tool_call", "tool": block.name})}\n\n'

                # Execute tool
                result = await execute_tool(block.name, block.input)

                # Add assistant message and tool result to messages
                current_messages.append({"role": "assistant", "content": response.content})
                current_messages.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    }]
                })
                break  # restart loop with tool results

        if not has_tool_use:
            # No more tool calls, we're done
            break

        if response.stop_reason == "end_turn" and not has_tool_use:
            break

    yield 'data: {"type": "done"}\n\n'
