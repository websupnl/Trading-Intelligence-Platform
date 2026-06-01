import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
import anthropic
from sqlalchemy import select, func, desc
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.memory import MemoryEntry
from app.models.trades import Trade
from app.models.candles import Candle
from app.models.news import NewsItem
from app.services.token_tracker import usage_record, flush_usage
from app.services.runtime_state import get_runtime_value

logger = logging.getLogger(__name__)

ORACLE_MORNING_BRIEF_PROMPT = """Je bent ORACLE, een ervaren portfolio manager op een hedgefonds.
Je analyseert elke ochtend de markten en maakt een dagplan. Vandaag is {datum}.

MARKT REGIME:
{regime_data}

OPEN POSITIES ({open_count}):
{open_trades}

GISTEREN GESLOTEN TRADES:
{closed_trades}
Gerealiseerde P&L gisteren: {pnl_gisteren}

RECENTE GEHEUGEN / GELEERDE LESSEN:
{memories}

NIEUWS OVERNACHT:
{headlines}

Voer je morning brief uit. Denk als een professionele trader die zichzelf voorbereidt op de dag.

1. REGIME BEVESTIGING: Is het regime veranderd? Wat betekent dit voor vandaag?
2. THESIS EVALUATIE: Welke theses worden sterker/zwakker op basis van het nieuws?
3. KANSEN VANDAAG: Benoem 1-3 concrete setups die je vandaag wil monitoren.
4. RISICO-BUDGET: Hoeveel % van normaal budget zet je in (0-100%)? Waarom?
5. STEMMING: agressief / neutraal / defensief — en waarom.
6. OPEN POSITIES: Zijn er posities die je wil sluiten of bijsturen?

Geef eerst een vrije tekst morning brief (2-3 paragrafen, conversational, als een trader die hardop denkt).
Dan een JSON blok met gestructureerde output.

JSON formaat (na de tekst, omsloten door ```json ... ```):
{{
  "regime": "risk_on|risk_off|chop|crisis",
  "mood": "agressief|neutraal|defensief",
  "risk_budget_pct": 75,
  "kansen": [
    {{"asset": "BTC", "setup": "Bullish breakout boven $70k", "conviction": 0.7, "actie": "monitor"}},
  ],
  "posities_actie": [
    {{"symbol": "ETH", "actie": "hold|close|reduce", "reden": "..."}}
  ],
  "key_risks": ["VIX stijgt richting 25", "..."],
  "focus_assets": ["BTC", "ETH"]
}}"""

ORACLE_EOD_REVIEW_PROMPT = """Je bent ORACLE. Het is einde van de handelsdag ({datum}).

VANDAAG GESLOTEN TRADES:
{closed_today}
Totale P&L vandaag: {pnl_today}

OPEN POSITIES EINDE DAG ({open_count}):
{open_trades}

MORNING BRIEF VAN VANOCHTEND:
{morning_brief}

Evalueer de dag:
1. Wat ging goed? Wat ging fout?
2. Klopte de morning brief voorspelling?
3. Welke les schrijf je op in je geheugen?
4. Hoe bereid je je voor op morgen?

Schrijf een kort EOD review (1-2 paragrafen) en een JSON les voor je geheugen.

JSON formaat:
```json
{{
  "dag_rating": 7,
  "pnl_today": {pnl_today_raw},
  "les": "Korte beschrijving van de belangrijkste les van vandaag",
  "pattern": "winning|losing|neutral",
  "morgen_focus": ["asset1", "asset2"],
  "memory_importance": 0.6
}}```"""


class OracleBrainService:
    def __init__(self):
        self.settings = get_settings()

    async def _get_regime_data(self) -> str:
        cached = get_runtime_value("oracle_regime_state", None)
        if cached:
            try:
                r = json.loads(cached) if isinstance(cached, str) else cached
                return (
                    f"Regime: {r.get('regime', 'unknown').upper()} "
                    f"(confidence: {r.get('confidence', 0):.0%})\n"
                    f"VIX: {r.get('vix', 'N/A')} | "
                    f"BTC Dominance: {r.get('btc_dominance', 'N/A')} | "
                    f"Dollar trend: {r.get('dollar_trend', 'N/A')}\n"
                    f"Notes: {r.get('notes', '')}"
                )
            except Exception:
                pass
        return "Regime: onbekend (geen data beschikbaar)"

    async def _get_open_trades(self) -> tuple[list, str]:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Trade).where(Trade.status == "open").limit(20)
            )
            trades = result.scalars().all()
        if not trades:
            return [], "Geen open posities."
        lines = []
        for t in trades:
            pnl_str = f"P&L: ${t.pnl:.2f}" if t.pnl else ""
            lines.append(
                f"- {t.symbol} {t.side} @ ${t.entry_price:.4f} "
                f"| Stop: ${t.stop_loss:.4f} | TP: ${t.take_profit:.4f} {pnl_str}"
            )
        return trades, "\n".join(lines)

    async def _get_closed_trades_yesterday(self) -> tuple[float, str]:
        yesterday = datetime.now(timezone.utc) - timedelta(hours=24)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Trade)
                .where(Trade.status == "closed")
                .where(Trade.updated_at >= yesterday)
                .order_by(desc(Trade.updated_at))
                .limit(10)
            )
            trades = result.scalars().all()
            pnl_sum_result = await db.execute(
                select(func.sum(Trade.pnl))
                .where(Trade.status == "closed")
                .where(Trade.updated_at >= yesterday)
            )
            total_pnl = float(pnl_sum_result.scalar() or 0)

        if not trades:
            return 0.0, "Geen trades gesloten gisteren."
        lines = []
        for t in trades:
            result_str = "WIN" if (t.pnl or 0) > 0 else "LOSS"
            lines.append(f"- [{result_str}] {t.symbol} P&L: ${(t.pnl or 0):.2f} ({t.exit_reason or 'onbekend'})")
        return total_pnl, "\n".join(lines)

    async def _get_recent_memories(self) -> str:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(MemoryEntry)
                .where(MemoryEntry.status == "active")
                .where(MemoryEntry.memory_type.in_(["trade_lesson", "oracle_morning_brief", "oracle_eod_review"]))
                .order_by(desc(MemoryEntry.created_at))
                .limit(10)
            )
            entries = result.scalars().all()
        if not entries:
            return "Geen eerdere lessen opgeslagen."
        lines = []
        for e in entries[:5]:
            lines.append(f"- [{e.memory_type}] {e.title}")
        return "\n".join(lines)

    async def _get_headlines(self) -> str:
        since = datetime.now(timezone.utc) - timedelta(hours=12)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(NewsItem)
                .where(NewsItem.published_at >= since)
                .order_by(desc(NewsItem.published_at))
                .limit(8)
            )
            items = result.scalars().all()
        if not items:
            return "Geen recent nieuws beschikbaar."
        lines = [f"- {n.title}" for n in items]
        return "\n".join(lines)

    async def _get_todays_morning_brief(self) -> str:
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(MemoryEntry)
                .where(MemoryEntry.memory_type == "oracle_morning_brief")
                .where(MemoryEntry.created_at >= today)
                .order_by(desc(MemoryEntry.created_at))
                .limit(1)
            )
            entry = result.scalar_one_or_none()
        if not entry:
            return "Geen morning brief beschikbaar voor vandaag."
        try:
            data = json.loads(entry.content)
            return data.get("brief_text", entry.content[:500])
        except Exception:
            return entry.content[:500]

    def _parse_oracle_response(self, text: str) -> dict:
        result = {"brief_text": text, "regime": "unknown", "mood": "neutraal", "risk_budget_pct": 50}
        try:
            import re
            json_match = re.search(r"```json\s*([\s\S]+?)\s*```", text)
            if json_match:
                parsed = json.loads(json_match.group(1))
                result.update(parsed)
                result["brief_text"] = text[:text.find("```json")].strip()
        except Exception as e:
            logger.warning(f"Oracle JSON parse fout: {e}")
        return result

    async def generate_morning_brief(self) -> dict:
        if not self.settings.anthropic_configured:
            return {"error": "Anthropic API niet geconfigureerd", "brief_text": ""}

        regime_data = await self._get_regime_data()
        open_trades, open_text = await self._get_open_trades()
        pnl_gisteren, closed_text = await self._get_closed_trades_yesterday()
        memories = await self._get_recent_memories()
        headlines = await self._get_headlines()

        datum = datetime.now(timezone.utc).strftime("%A %d %B %Y %H:%M UTC")
        prompt = ORACLE_MORNING_BRIEF_PROMPT.format(
            datum=datum,
            regime_data=regime_data,
            open_count=len(open_trades),
            open_trades=open_text,
            closed_trades=closed_text,
            pnl_gisteren=f"${pnl_gisteren:.2f}",
            memories=memories,
            headlines=headlines,
        )

        client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
        # Morning brief uses the best available model
        model = "claude-opus-4-8"
        try:
            response = client.messages.create(
                model=model,
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.content[0].text
        except Exception:
            # Fallback to configured model
            try:
                response = client.messages.create(
                    model=self.settings.anthropic_model,
                    max_tokens=2048,
                    messages=[{"role": "user", "content": prompt}],
                )
                text = response.content[0].text
                model = self.settings.anthropic_model
            except Exception as e:
                logger.error(f"Oracle morning brief AI fout: {e}")
                return {"error": str(e), "brief_text": ""}

        parsed = self._parse_oracle_response(text)
        parsed["generated_at"] = datetime.now(timezone.utc).isoformat()
        parsed["model_used"] = model

        async with AsyncSessionLocal() as db:
            await flush_usage(db, [usage_record(model, "oracle_morning_brief", response.usage)])
            db.add(MemoryEntry(
                memory_type="oracle_morning_brief",
                title=f"Oracle Morning Brief {datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
                content=json.dumps(parsed),
                tags=["oracle", "morning_brief"],
                related_symbols=parsed.get("focus_assets", []),
                importance=0.9,
                status="active",
            ))
            await db.commit()

        logger.info(f"Oracle Morning Brief gegenereerd: mood={parsed.get('mood')}, risk_budget={parsed.get('risk_budget_pct')}%")
        return parsed

    async def generate_eod_review(self) -> dict:
        if not self.settings.anthropic_configured:
            return {"error": "Anthropic API niet geconfigureerd"}

        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Trade)
                .where(Trade.status == "closed")
                .where(Trade.updated_at >= today_start)
            )
            closed_today = result.scalars().all()
            pnl_result = await db.execute(
                select(func.sum(Trade.pnl))
                .where(Trade.status == "closed")
                .where(Trade.updated_at >= today_start)
            )
            pnl_today = float(pnl_result.scalar() or 0)

        open_trades, open_text = await self._get_open_trades()
        morning_brief = await self._get_todays_morning_brief()

        if not closed_today:
            closed_text = "Geen trades gesloten vandaag."
        else:
            lines = []
            for t in closed_today:
                r = "WIN" if (t.pnl or 0) > 0 else "LOSS"
                lines.append(f"- [{r}] {t.symbol} P&L: ${(t.pnl or 0):.2f}")
            closed_text = "\n".join(lines)

        datum = datetime.now(timezone.utc).strftime("%A %d %B %Y")
        prompt = ORACLE_EOD_REVIEW_PROMPT.format(
            datum=datum,
            closed_today=closed_text,
            pnl_today=f"${pnl_today:.2f}",
            pnl_today_raw=round(pnl_today, 2),
            open_count=len(open_trades),
            open_trades=open_text,
            morning_brief=morning_brief,
        )

        client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
        model = self.settings.anthropic_model
        try:
            response = client.messages.create(
                model=model,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.content[0].text
        except Exception as e:
            logger.error(f"Oracle EOD review AI fout: {e}")
            return {"error": str(e)}

        parsed = self._parse_oracle_response(text)
        parsed["generated_at"] = datetime.now(timezone.utc).isoformat()

        importance = float(parsed.get("memory_importance", 0.6))
        async with AsyncSessionLocal() as db:
            await flush_usage(db, [usage_record(model, "oracle_eod_review", response.usage)])
            db.add(MemoryEntry(
                memory_type="oracle_eod_review",
                title=f"EOD Review {datetime.now(timezone.utc).strftime('%Y-%m-%d')} P&L: ${pnl_today:.2f}",
                content=json.dumps(parsed),
                tags=["oracle", "eod_review"],
                related_symbols=parsed.get("morgen_focus", []),
                importance=importance,
                status="active",
            ))
            await db.commit()

        logger.info(f"Oracle EOD Review gegenereerd: rating={parsed.get('dag_rating')}, P&L={pnl_today:.2f}")
        return parsed

    @staticmethod
    def brief_to_markdown(brief: dict, brief_type: str = "morning") -> str:
        now = datetime.now(timezone.utc)
        date_str = now.strftime("%d %B %Y")
        time_str = now.strftime("%H:%M UTC")

        if brief_type == "morning":
            header = f"# ORACLE Morning Brief — {date_str}\n*Gegenereerd om {time_str}*\n"
        else:
            header = f"# ORACLE EOD Review — {date_str}\n*Gegenereerd om {time_str}*\n"

        mood_emoji = {"agressief": "🔥", "neutraal": "⚖️", "defensief": "🛡️"}.get(
            brief.get("mood", "neutraal"), "⚖️"
        )
        regime_emoji = {
            "risk_on": "🟢", "risk_off": "🔴", "chop": "🟡", "crisis": "🚨"
        }.get(brief.get("regime", "unknown"), "❓")

        lines = [header]
        lines.append(f"## Status")
        lines.append(f"- Regime: {regime_emoji} **{brief.get('regime', 'onbekend').upper()}**")
        lines.append(f"- Stemming: {mood_emoji} **{brief.get('mood', 'neutraal')}**")
        if "risk_budget_pct" in brief:
            lines.append(f"- Risico budget: **{brief['risk_budget_pct']}%** van normaal")
        if "dag_rating" in brief:
            lines.append(f"- Dag rating: **{brief['dag_rating']}/10**")
        if "pnl_today" in brief:
            pnl = brief["pnl_today"]
            sign = "+" if pnl >= 0 else ""
            lines.append(f"- P&L vandaag: **{sign}${pnl:.2f}**")
        lines.append("")

        if brief.get("brief_text"):
            lines.append("## Oracle Denkt Hardop")
            lines.append(brief["brief_text"])
            lines.append("")

        if brief.get("kansen"):
            lines.append("## Kansen Vandaag")
            for k in brief["kansen"]:
                conv = k.get("conviction", 0)
                lines.append(f"- **{k.get('asset', '?')}** — {k.get('setup', '')} "
                              f"(conviction: {conv:.0%}, actie: {k.get('actie', '?')})")
            lines.append("")

        if brief.get("posities_actie"):
            lines.append("## Positie Acties")
            for p in brief["posities_actie"]:
                lines.append(f"- **{p.get('symbol', '?')}**: {p.get('actie', '?')} — {p.get('reden', '')}")
            lines.append("")

        if brief.get("key_risks"):
            lines.append("## Risico's")
            for r in brief["key_risks"]:
                lines.append(f"- {r}")
            lines.append("")

        if brief.get("les"):
            lines.append("## Les van Vandaag")
            lines.append(f"> {brief['les']}")
            lines.append("")

        if brief.get("morgen_focus"):
            lines.append("## Focus Morgen")
            lines.append(", ".join(f"**{a}**" for a in brief["morgen_focus"]))
            lines.append("")

        model = brief.get("model_used", "")
        if model:
            lines.append(f"---\n*Model: {model}*")

        return "\n".join(lines)
