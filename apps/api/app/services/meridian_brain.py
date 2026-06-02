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
