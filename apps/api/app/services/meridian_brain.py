"""Meridian brain — ported into Trading OS as the streaming "smart gambling" engine.

One button → the brain goes to work and streams every step: it scans, researches
the live situation via web search (news, rumours, catalysts), reasons out loud
(extended thinking), assigns a conviction, and chooses its own stake as a % of
the gok bankroll — scaled by conviction, hard-capped. Each step is yielded as an
event so the UI can show the thinking as it happens.

This is deliberately a *speculative* book: it hunts asymmetric, high-upside,
short-horizon bets — but every bet still needs a thesis, a catalyst and a stop.
Smart gambling, not blind gambling.
"""
from __future__ import annotations

import json
import logging
from typing import AsyncIterator

import anthropic

from app.config import get_settings

logger = logging.getLogger(__name__)

# Prices USD / 1M tokens (input, output); cache write 1.25x, read 0.1x.
_PRICES = {"claude-sonnet-4-6": (3.0, 15.0), "claude-haiku-4-5": (1.0, 5.0), "claude-opus-4-8": (5.0, 25.0)}

GAMBLE_DOCTRINE = """\
Je bent de gok-strateeg van een speculatief crypto-boek. Je zoekt ASYMMETRISCHE,
korte-termijn weddenschappen: setups waar de upside veel groter is dan de
downside, gedreven door een concrete, nabije katalysator (nieuws, gerucht, listing,
unlock, narratief-momentum, technische breakout).

Dit is bewust risicovol — "gokken" — maar SLIM gokken:
- Onderzoek de huidige situatie met web search: vers nieuws, geruchten, sentiment,
  aankomende events. Citeer wat je vindt. Geen verzonnen katalysatoren.
- Geen katalysator of edge binnen een korte horizon → PASS. Niet elke ronde hoeft
  een bet te zijn; geen edge is ook een beslissing.
- Bepaal conviction (0-100): hoe sterk en hoe waarschijnlijk is de edge?
- Kies ZELF de inzet als % van het gok-bankroll, geschaald met conviction:
    60-69 → 5-10% · 70-84 → 10-20% · 85-100 → 20-35%. Nooit meer dan 35%.
- ALTIJD een stop-loss (waar je thesis fout is) en een take-profit (de asymmetrie).
- Wees eerlijk over het risico in key_risk.

Denk hardop, doe je research, en roep dan EXACT ÉÉN keer de tool submit_bet aan
met je conclusie. Bij 'bet' zijn stake_pct, stop_loss en take_profit verplicht.
"""

SUBMIT_BET_TOOL = {
    "name": "submit_bet",
    "description": "Leg je definitieve gok-beslissing vast. Roep exact één keer aan als je klaar bent.",
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["bet", "pass"]},
            "conviction": {"type": "integer"},
            "stake_pct": {"type": ["number", "null"], "description": "% van het bankroll (0-35)"},
            "thesis": {"type": "string"},
            "catalyst": {"type": "string", "description": "De concrete katalysator + tijdsvenster"},
            "stop_loss": {"type": ["number", "null"]},
            "take_profit": {"type": ["number", "null"]},
            "time_horizon": {"type": "string", "enum": ["uren", "dagen", "weken"]},
            "key_risk": {"type": "string"},
        },
        "required": ["action", "conviction", "thesis", "key_risk"],
    },
}

_WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 5}
_WEB_FETCH = {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 3}

# ── Signal brain (non-streaming, for the regular signal pipeline) ────────────
SIGNAL_DOCTRINE = """\
Je bent een long-only crypto trading-analist. Je edge is het vinden van een
ECHTE, nabije katalysator die de markt nog niet volledig heeft ingeprijsd.

Onderzoek de huidige situatie met web search: vers nieuws, geruchten, aankomende
events (listings, unlocks, upgrades, ETF/regulatory, partnerships), sentiment.
Citeer wat je vindt — geen verzonnen katalysatoren.

Regels:
- Geen concrete katalysator of edge binnen uren-tot-dagen → SKIP. SKIP is in ~75%
  van de gevallen het juiste antwoord; idle cash is prima.
- Long-only: een bearish view = SKIP, geen short.
- confidence 0-100. Alleen BUY bij duidelijke edge én R/R >= 1.5.
- Bij BUY: entry rond de huidige prijs, een stop waar je thesis fout is, en een
  target met R/R >= 1.5. Stop en target verplicht.

Doe je research, redeneer, en roep dan EXACT ÉÉN keer submit_signal aan.
"""

SUBMIT_SIGNAL_TOOL = {
    "name": "submit_signal",
    "description": "Leg je definitieve signaal-beslissing vast. Roep exact één keer aan.",
    "input_schema": {
        "type": "object",
        "properties": {
            "direction": {"type": "string", "enum": ["buy", "skip"]},
            "confidence": {"type": "integer"},
            "thesis": {"type": "string"},
            "catalyst": {"type": "string"},
            "suggested_entry": {"type": ["number", "null"]},
            "suggested_stop": {"type": ["number", "null"]},
            "suggested_take_profit": {"type": ["number", "null"]},
            "risk_reward": {"type": ["number", "null"]},
            "key_risk": {"type": "string"},
        },
        "required": ["direction", "confidence", "thesis", "key_risk"],
    },
}

_MAX_ROUNDS = 6


async def conviction_signal(asset: str, price: float | None, memory: str = "") -> dict:
    """Deep, web-researched conviction call for one asset. Non-streaming.
    Returns a dict with the structured signal decision + sources + cost_usd."""
    s = get_settings()
    if not s.anthropic_api_key:
        return {"direction": "skip", "confidence": 0, "thesis": "Geen API key", "cost_usd": 0.0, "sources": []}

    client = anthropic.AsyncAnthropic(api_key=s.anthropic_api_key)
    model = "claude-sonnet-4-6"
    system = [{"type": "text", "text": SIGNAL_DOCTRINE, "cache_control": {"type": "ephemeral"}}]
    if memory:
        system.append({"type": "text", "text": memory, "cache_control": {"type": "ephemeral"}})
    dossier = (
        f"ASSET: {asset}\nHuidige prijs: {price if price is not None else 'zoek zelf op'}\n\n"
        f"Onderzoek of er nú een long-setup met een nabije katalysator in {asset} zit. "
        f"Beslis buy of skip; bij buy geef entry, stop en target (R/R >= 1.5)."
    )
    messages = [{"role": "user", "content": dossier}]
    sources: list[dict] = []
    decision: dict | None = None
    cost = 0.0
    tin = tout = tcr = tcc = 0

    try:
        for _ in range(_MAX_ROUNDS):
            resp = await client.messages.create(
                model=model, max_tokens=4000, system=system,
                tools=[_WEB_SEARCH, _WEB_FETCH, SUBMIT_SIGNAL_TOOL],
                thinking={"type": "adaptive"},
                messages=messages,
            )
            cost += _cost(model, resp.usage)
            u = resp.usage
            tin += getattr(u, "input_tokens", 0) or 0
            tout += getattr(u, "output_tokens", 0) or 0
            tcr += getattr(u, "cache_read_input_tokens", 0) or 0
            tcc += getattr(u, "cache_creation_input_tokens", 0) or 0
            for block in resp.content:
                bt = getattr(block, "type", "")
                if bt == "web_search_tool_result":
                    for r in (getattr(block, "content", None) or []):
                        if getattr(r, "url", None):
                            sources.append({"url": r.url, "title": getattr(r, "title", "") or ""})
                elif bt == "tool_use" and getattr(block, "name", "") == "submit_signal":
                    decision = dict(block.input)
            if decision is not None:
                break
            if resp.stop_reason == "pause_turn":
                messages.append({"role": "assistant", "content": resp.content})
                continue
            break
    except Exception as exc:
        logger.warning("conviction_signal %s fout: %s", asset, exc)
        return {"direction": "skip", "confidence": 0, "thesis": f"fout: {exc}"[:200], "cost_usd": round(cost, 6), "sources": sources}

    if decision is None:
        decision = {"direction": "skip", "confidence": 0, "thesis": "Geen beslissing."}
    decision["sources"] = sources[:8]
    decision["cost_usd"] = round(cost, 6)
    decision["model"] = model
    decision["_usage"] = {"input": tin, "output": tout, "cache_read": tcr, "cache_creation": tcc}
    return decision


_BRAIN_WATCHLIST = ["BTC", "ETH", "SOL", "LINK", "DOGE", "AVAX", "UNI", "AAVE"]


async def run_brain_signals(max_assets: int = 4, min_confidence: int = 60) -> dict:
    """Run the conviction brain over the watchlist and save buy-signals.

    Budget-guarded and capped per run so web-search costs stay bounded. Each
    saved signal carries the web-researched thesis, catalyst and sources.
    """
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.signals import Signal
    from app.services.ai_guard import is_ai_paused, get_daily_spend_usd, _get_daily_budget
    from app.services.market_data_service import MarketDataService

    import redis as _redis
    from app.models.token_usage import TokenUsage

    summary: dict = {"analyzed": 0, "created": 0, "skipped": [], "cost_usd": 0.0}
    if is_ai_paused():
        summary["paused"] = True
        return summary

    # Lock: only one brain-signals run at a time (prevents overlap + double spend).
    lock = _redis.from_url(get_settings().redis_url, socket_connect_timeout=2)
    try:
        got_lock = lock.set("meridian:brain_signals:lock", "1", nx=True, ex=1200)
    except Exception:
        got_lock = True  # if Redis is down, don't block the run
    if not got_lock:
        summary["locked"] = True
        return summary

    try:
        budget = _get_daily_budget()
        spent = await get_daily_spend_usd()
        md = MarketDataService()
        done = 0

        async with AsyncSessionLocal() as db:
            for base in _BRAIN_WATCHLIST:
                if done >= max_assets:
                    break
                if budget > 0 and (spent + summary["cost_usd"]) >= budget:
                    summary["budget_hit"] = True
                    break
                # Cooldown: skip assets that already have a pending signal.
                exists = (await db.execute(
                    select(Signal).where(Signal.asset == base, Signal.status == "pending").limit(1)
                )).scalar_one_or_none()
                if exists:
                    continue

                try:
                    candles = await md.get_candles(f"{base}/USD", "15Min", 1)
                    price = float(candles[-1].close) if candles else None
                except Exception:
                    price = None

                dec = await conviction_signal(base, price)
                summary["analyzed"] += 1
                summary["cost_usd"] += dec.get("cost_usd", 0.0)
                done += 1

                # Record spend so the daily budget guard accounts for it.
                us = dec.get("_usage", {}) or {}
                db.add(TokenUsage(
                    model=dec.get("model", "claude-sonnet-4-6"), call_type="brain_signal",
                    input_tokens=us.get("input", 0), output_tokens=us.get("output", 0),
                    cache_read_tokens=us.get("cache_read", 0), cache_creation_tokens=us.get("cache_creation", 0),
                    estimated_cost_usd=dec.get("cost_usd", 0.0),
                ))

                if dec.get("direction") == "buy" and int(dec.get("confidence") or 0) >= min_confidence:
                    db.add(Signal(
                        asset=base, direction="buy", timeframe="swing",
                        reason=dec.get("thesis"),
                        confidence=int(dec.get("confidence") or 0) / 100.0,
                        suggested_entry=dec.get("suggested_entry"),
                        suggested_stop=dec.get("suggested_stop"),
                        suggested_take_profit=dec.get("suggested_take_profit"),
                        risk_reward=dec.get("risk_reward"),
                        status="pending",
                        ai_analysis={
                            "engine": "meridian_brain",
                            "conviction": dec.get("confidence"),
                            "catalyst": dec.get("catalyst"),
                            "key_risk": dec.get("key_risk"),
                            "sources": dec.get("sources"),
                            "model": dec.get("model"),
                        },
                        expires_at=datetime.now(timezone.utc) + timedelta(hours=4),
                    ))
                    summary["created"] += 1
                else:
                    summary["skipped"].append(base)
                await db.commit()  # incremental: persist cost + signal per asset
    finally:
        try:
            lock.delete("meridian:brain_signals:lock")
        except Exception:
            pass

    summary["cost_usd"] = round(summary["cost_usd"], 4)
    return summary


def _cost(model: str, usage) -> float:
    pin, pout = _PRICES.get(model, _PRICES["claude-sonnet-4-6"])
    g = lambda a: getattr(usage, a, 0) or 0
    return round((g("input_tokens") * pin + g("cache_creation_input_tokens") * pin * 1.25
                  + g("cache_read_input_tokens") * pin * 0.1 + g("output_tokens") * pout) / 1e6, 6)


async def gamble_stream(asset: str, price: float | None, bankroll_eur: float) -> AsyncIterator[dict]:
    """Stream the brain's reasoning for a speculative bet on `asset`.

    Yields events: {phase}, {type:'thinking'|'text', text}, {type:'search', query},
    {type:'sources', items}, {type:'decision', ...}, {type:'cost', usd}, {type:'error'}.
    """
    s = get_settings()
    if not s.anthropic_api_key:
        yield {"type": "error", "message": "Geen Anthropic API key"}
        return

    client = anthropic.AsyncAnthropic(api_key=s.anthropic_api_key)
    model = "claude-sonnet-4-6"
    dossier = (
        f"GOK-KANS: {asset}\n"
        f"Huidige prijs: {price if price is not None else 'zoek zelf op'}\n"
        f"Gok-bankroll: €{bankroll_eur:.2f}\n\n"
        f"Onderzoek of er nú een asymmetrische korte-termijn gok in {asset} zit. "
        f"Zoek vers nieuws/geruchten/katalysatoren. Beslis bet of pass, en kies bij "
        f"bet zelf de inzet (% bankroll), stop en target."
    )
    sources: list[dict] = []
    decision: dict | None = None

    try:
        yield {"phase": "research", "asset": asset}
        async with client.messages.stream(
            model=model,
            max_tokens=6000,
            system=[{"type": "text", "text": GAMBLE_DOCTRINE, "cache_control": {"type": "ephemeral"}}],
            tools=[_WEB_SEARCH, _WEB_FETCH, SUBMIT_BET_TOOL],
            thinking={"type": "adaptive", "display": "summarized"},
            messages=[{"role": "user", "content": dossier}],
        ) as stream:
            async for event in stream:
                et = getattr(event, "type", "")
                if et == "content_block_start":
                    cb = getattr(event, "content_block", None)
                    cbt = getattr(cb, "type", "")
                    if cbt == "server_tool_use" and getattr(cb, "name", "") == "web_search":
                        q = (getattr(cb, "input", {}) or {}).get("query", "")
                        yield {"type": "search", "query": q}
                elif et == "content_block_delta":
                    d = getattr(event, "delta", None)
                    dt = getattr(d, "type", "")
                    if dt == "thinking_delta":
                        yield {"type": "thinking", "text": getattr(d, "thinking", "")}
                    elif dt == "text_delta":
                        yield {"type": "text", "text": getattr(d, "text", "")}

            final = await stream.get_final_message()

        # Extract web-search citations + the submit_bet decision from the final message.
        for block in final.content:
            bt = getattr(block, "type", "")
            if bt == "web_search_tool_result":
                for r in (getattr(block, "content", None) or []):
                    url = getattr(r, "url", None)
                    if url:
                        sources.append({"url": url, "title": getattr(r, "title", "") or ""})
            elif bt == "tool_use" and getattr(block, "name", "") == "submit_bet":
                decision = dict(block.input)

        if sources:
            yield {"type": "sources", "items": sources[:8]}

        cost = _cost(model, final.usage)
        if decision is None:
            decision = {"action": "pass", "conviction": 0, "thesis": "Geen beslissing teruggegeven.", "key_risk": "n/a"}

        # Translate stake_pct → concrete euro stake, capped at 35%.
        stake_pct = decision.get("stake_pct")
        if decision.get("action") == "bet" and stake_pct:
            stake_pct = max(0.0, min(35.0, float(stake_pct)))
            decision["stake_pct"] = stake_pct
            decision["stake_eur"] = round(bankroll_eur * stake_pct / 100.0, 2)

        yield {"type": "decision", "asset": asset, "price": price, **decision, "cost_usd": cost}
        yield {"type": "cost", "usd": cost}
    except Exception as exc:
        logger.exception("gamble_stream fout: %s", exc)
        yield {"type": "error", "message": str(exc)[:300]}
