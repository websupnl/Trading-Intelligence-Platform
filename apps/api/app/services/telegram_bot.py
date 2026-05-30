import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx

from app.config import get_settings
from app.services.runtime_state import get_runtime_value, set_runtime_value

logger = logging.getLogger(__name__)

BOT_COMMANDS = [
    ("start",       "Welkom + overzicht"),
    ("help",        "Alle beschikbare commands"),
    ("status",      "Systeem status"),
    ("portfolio",   "Account & equity overzicht"),
    ("posities",    "Open posities"),
    ("signalen",    "Actieve signalen"),
    ("pnl",         "P&L overzicht"),
    ("trades",      "Laatste trades"),
    ("stats",       "Performance statistieken"),
    ("outcomes",    "Signal outcome resultaten"),
    ("nieuws",      "Recent impactvol nieuws"),
    ("geruchten",   "Markt geruchten"),
    ("pauze",       "AI trading pauzeren"),
    ("hervatten",   "AI trading hervatten"),
    ("killswitch",  "Kill switch aan/uitzetten"),
    ("samenvatting","Dagelijkse samenvatting nu"),
]

COMMAND_MAP = {
    "/start":       "cmd_start",
    "/help":        "cmd_help",
    "/status":      "cmd_status",
    "/portfolio":   "cmd_portfolio",
    "/posities":    "cmd_posities",
    "/signalen":    "cmd_signalen",
    "/pnl":         "cmd_pnl",
    "/trades":      "cmd_trades",
    "/stats":       "cmd_stats",
    "/outcomes":    "cmd_outcomes",
    "/nieuws":      "cmd_nieuws",
    "/geruchten":   "cmd_geruchten",
    "/pauze":       "cmd_pauze",
    "/hervatten":   "cmd_hervatten",
    "/killswitch":  "cmd_killswitch",
    "/samenvatting":"cmd_samenvatting",
}


def _fmt_money(value: float | None) -> str:
    if value is None:
        return "n/b"
    sign = "+" if value >= 0 else ""
    return f"{sign}${value:,.2f}"


def _fmt_pct(value: float | None) -> str:
    if value is None:
        return "n/b"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value:.1f}%"


def _fmt_date(dt: datetime | None) -> str:
    if not dt:
        return "—"
    return dt.strftime("%-d %b %H:%M")


class TelegramBotService:
    def __init__(self):
        self.settings = get_settings()
        self._base = f"https://api.telegram.org/bot{self.settings.telegram_bot_token}"

    # ── Low-level API ──────────────────────────────────────────────────────────

    async def _call(self, method: str, **kwargs: Any) -> dict:
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                resp = await client.post(f"{self._base}/{method}", json=kwargs)
                return resp.json()
        except Exception as exc:
            logger.warning("Telegram API fout (%s): %s", method, exc)
            return {}

    async def send_message(
        self,
        chat_id: str,
        text: str,
        reply_markup: dict | None = None,
        parse_mode: str = "HTML",
    ) -> dict:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text[:4096],
            "parse_mode": parse_mode,
            "disable_web_page_preview": True,
        }
        if reply_markup:
            payload["reply_markup"] = reply_markup
        return await self._call("sendMessage", **payload)

    async def answer_callback_query(self, callback_query_id: str, text: str = "") -> None:
        await self._call("answerCallbackQuery", callback_query_id=callback_query_id, text=text[:200])

    async def get_updates(self, offset: int) -> list[dict]:
        result = await self._call(
            "getUpdates",
            offset=offset,
            timeout=2,
            allowed_updates=["message", "callback_query"],
        )
        return result.get("result", [])

    async def set_my_commands(self) -> bool:
        result = await self._call(
            "setMyCommands",
            commands=[{"command": cmd, "description": desc} for cmd, desc in BOT_COMMANDS],
        )
        return bool(result.get("result", False))

    # ── Offset / polling state ─────────────────────────────────────────────────

    def _get_offset(self) -> int:
        return int(get_runtime_value("telegram_update_offset", 0))

    def _save_offset(self, offset: int) -> None:
        set_runtime_value("telegram_update_offset", offset)

    async def _bootstrap_offset(self) -> int:
        result = await self._call("getUpdates", offset=-1, limit=1)
        updates = result.get("result", [])
        return updates[-1]["update_id"] + 1 if updates else 0

    # ── Main polling loop ──────────────────────────────────────────────────────

    async def poll_and_dispatch(self) -> dict:
        # Overlap protection: skip if another polling is in progress
        lock_val = get_runtime_value("telegram_polling_lock", None)
        if lock_val:
            try:
                if (time.time() - float(lock_val)) < 8:
                    return {"status": "skipped", "reason": "already_running"}
            except (ValueError, TypeError):
                pass
        set_runtime_value("telegram_polling_lock", str(time.time()))

        try:
            offset = self._get_offset()
            if offset == 0:
                offset = await self._bootstrap_offset()
                self._save_offset(offset)
                return {"status": "ok", "processed": 0, "bootstrapped": True}

            updates = await self.get_updates(offset)
            if not updates:
                return {"status": "ok", "processed": 0}

            new_offset = offset
            processed = 0
            for update in updates:
                uid = update["update_id"]
                new_offset = max(new_offset, uid + 1)
                try:
                    await self.handle_update(update)
                    processed += 1
                except Exception as exc:
                    logger.warning("Update %s verwerking mislukt: %s", uid, exc)

            self._save_offset(new_offset)
            return {"status": "ok", "processed": processed, "offset": new_offset}
        finally:
            set_runtime_value("telegram_polling_lock", None)

    # ── Security ───────────────────────────────────────────────────────────────

    def _is_allowed(self, chat_id: Any) -> bool:
        cid = str(chat_id)
        allowed = {c.strip() for c in self.settings.telegram_chat_id.split(",") if c.strip()}
        return cid in allowed

    # ── Update dispatch ────────────────────────────────────────────────────────

    async def handle_update(self, update: dict) -> None:
        if "message" in update:
            await self.handle_message(update["message"])
        elif "callback_query" in update:
            await self.handle_callback_query(update["callback_query"])

    async def handle_message(self, message: dict) -> None:
        chat_id = str(message.get("chat", {}).get("id", ""))
        if not self._is_allowed(chat_id):
            return
        text = (message.get("text") or "").strip()
        if not text:
            return
        await self._route_command(chat_id, text)

    async def handle_callback_query(self, callback: dict) -> None:
        cq_id = callback["id"]
        chat_id = str(callback.get("message", {}).get("chat", {}).get("id", ""))
        if not self._is_allowed(chat_id):
            return
        data = callback.get("data", "")

        if data == "cancel":
            await self.answer_callback_query(cq_id, "Geannuleerd.")
            await self.send_message(chat_id, "Actie geannuleerd.")
        elif data == "confirm_pauze":
            await self.answer_callback_query(cq_id, "AI trading gepauzeerd.")
            await self._execute_pauze(chat_id)
        elif data == "confirm_hervatten":
            await self.answer_callback_query(cq_id, "AI trading hervat.")
            await self._execute_hervatten(chat_id)
        elif data == "confirm_kill_on":
            await self.answer_callback_query(cq_id, "Kill switch geactiveerd.")
            await self._execute_kill_switch(chat_id, enable=True)
        elif data == "confirm_kill_off":
            await self.answer_callback_query(cq_id, "Kill switch uitgeschakeld.")
            await self._execute_kill_switch(chat_id, enable=False)
        elif data.startswith("signal_paper:"):
            signal_id = data.split(":", 1)[1]
            await self.answer_callback_query(cq_id, "Paper trade wordt ingediend...")
            await self._execute_paper_trade(chat_id, signal_id)
        elif data.startswith("signal_reject:"):
            signal_id = data.split(":", 1)[1]
            await self.answer_callback_query(cq_id, "Signaal afgewezen.")
            await self._execute_reject_signal(chat_id, signal_id)
        else:
            await self.answer_callback_query(cq_id)

    # ── Command routing ────────────────────────────────────────────────────────

    async def _route_command(self, chat_id: str, text: str) -> None:
        raw_cmd = text.split()[0].split("@")[0].lower()
        handler_name = COMMAND_MAP.get(raw_cmd)
        if handler_name:
            await getattr(self, handler_name)(chat_id)
        elif raw_cmd.startswith("/"):
            await self.send_message(
                chat_id,
                "Onbekend commando. Gebruik /help voor een overzicht.",
            )

    # ── Command handlers ───────────────────────────────────────────────────────

    async def cmd_start(self, chat_id: str) -> None:
        await self.send_message(
            chat_id,
            "👋 <b>Welkom bij Trading OS</b>\n\n"
            "Ik ben je trading assistent. Gebruik /help voor alle beschikbare commando's.\n\n"
            "Je kunt mij gebruiken om het systeem te monitoren, statistieken op te vragen "
            "en risicobeheer te besturen.",
        )

    async def cmd_help(self, chat_id: str) -> None:
        lines = ["📋 <b>Beschikbare Commando's</b>\n"]
        for cmd, desc in BOT_COMMANDS:
            lines.append(f"/{cmd} — {desc}")
        await self.send_message(chat_id, "\n".join(lines))

    async def cmd_status(self, chat_id: str) -> None:
        from app.services.ai_guard import ai_pause_status
        from app.services.market_session import us_market_open

        ai = ai_pause_status()
        kill = get_runtime_value("kill_switch_enabled", self.settings.kill_switch_enabled)
        mode = get_runtime_value("trading_mode", self.settings.trading_mode)
        live_enabled = get_runtime_value("live_trading_enabled", self.settings.live_trading_enabled)
        market_open = us_market_open()

        if ai["paused"]:
            until_dt = datetime.fromisoformat(ai["until"].replace("Z", "+00:00")) if ai["until"] else None
            until_str = until_dt.strftime("%H:%M UTC") if until_dt else "onbekend"
            ai_line = f"🔴 AI: Gepauzeerd tot {until_str}"
        else:
            ai_line = "🟢 AI: Actief"

        kill_line = "🔴 Kill Switch: <b>AAN — orders geblokkeerd</b>" if kill else "🟢 Kill Switch: Uit"
        mode_line = f"⚙️ Modus: {mode.upper()}" + (" (live ingeschakeld)" if live_enabled else "")
        market_line = "📈 Markt: Open" if market_open else "📉 Markt: Gesloten"

        await self.send_message(
            chat_id,
            f"📊 <b>Systeem Status</b>\n\n{ai_line}\n{kill_line}\n{mode_line}\n{market_line}",
        )

    async def cmd_portfolio(self, chat_id: str) -> None:
        from app.services.alpaca_broker import AlpacaBroker, AlpacaNotConfiguredError, AlpacaAPIError
        try:
            account = await AlpacaBroker().get_account()
            equity = float(account.get("equity", 0))
            last_equity = float(account.get("last_equity", equity))
            cash = float(account.get("cash", 0))
            buying_power = float(account.get("buying_power", 0))
            day_pnl = equity - last_equity

            sign = "🟢" if day_pnl >= 0 else "🔴"
            await self.send_message(
                chat_id,
                f"💼 <b>Portfolio Overzicht</b>\n\n"
                f"Equity: <code>${equity:,.2f}</code>\n"
                f"Cash: <code>${cash:,.2f}</code>\n"
                f"Koopkracht: <code>${buying_power:,.2f}</code>\n"
                f"{sign} Dag P&L: <code>{_fmt_money(day_pnl)}</code>",
            )
        except AlpacaNotConfiguredError:
            await self.send_message(chat_id, "⚠️ Alpaca is niet geconfigureerd.")
        except AlpacaAPIError as exc:
            await self.send_message(chat_id, f"❌ Alpaca fout: {exc}")
        except Exception as exc:
            await self.send_message(chat_id, f"❌ Fout bij ophalen portfolio: {exc}")

    async def cmd_posities(self, chat_id: str) -> None:
        from app.services.alpaca_broker import AlpacaBroker, AlpacaNotConfiguredError, AlpacaAPIError
        try:
            positions = await AlpacaBroker().get_positions()
            if not positions:
                await self.send_message(chat_id, "📂 Geen open posities.")
                return

            lines = [f"📂 <b>Open Posities</b> ({len(positions)})\n"]
            for p in positions[:10]:
                symbol = p.get("symbol", "?")
                qty = float(p.get("qty", 0))
                entry = float(p.get("avg_entry_price", 0))
                unreal_pl = float(p.get("unrealized_pl", 0))
                unreal_plpc = float(p.get("unrealized_plpc", 0)) * 100
                sign = "🟢" if unreal_pl >= 0 else "🔴"
                lines.append(
                    f"{sign} <b>{symbol}</b> — {qty:.4g} @ ${entry:,.2f}\n"
                    f"   P&L: <code>{_fmt_money(unreal_pl)}</code> ({_fmt_pct(unreal_plpc)})"
                )
            if len(positions) > 10:
                lines.append(f"\n…en {len(positions) - 10} meer")
            await self.send_message(chat_id, "\n".join(lines))
        except AlpacaNotConfiguredError:
            await self.send_message(chat_id, "⚠️ Alpaca is niet geconfigureerd.")
        except AlpacaAPIError as exc:
            await self.send_message(chat_id, f"❌ Alpaca fout: {exc}")
        except Exception as exc:
            await self.send_message(chat_id, f"❌ Fout bij ophalen posities: {exc}")

    async def cmd_signalen(self, chat_id: str) -> None:
        from sqlalchemy import select, desc
        from app.database import AsyncSessionLocal
        from app.models.signals import Signal

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Signal)
                .where(Signal.status == "pending")
                .order_by(desc(Signal.created_at))
                .limit(10)
            )
            signals = result.scalars().all()

        if not signals:
            await self.send_message(chat_id, "🔔 Geen actieve signalen.")
            return

        lines = [f"🔔 <b>Actieve Signalen</b> ({len(signals)})\n"]
        for s in signals:
            dir_emoji = "📈" if s.direction == "buy" else "📉"
            entry_str = f"${s.suggested_entry:,.2f}" if s.suggested_entry else "n/b"
            rr_str = f"R/R {s.risk_reward:.1f}" if s.risk_reward else ""
            lines.append(
                f"{dir_emoji} <b>{s.asset}</b> {s.direction.upper()} — "
                f"{s.confidence:.0%} conf — {entry_str}"
                + (f" — {rr_str}" if rr_str else "")
            )
        await self.send_message(chat_id, "\n".join(lines))

    async def cmd_pnl(self, chat_id: str) -> None:
        from sqlalchemy import select, func
        from app.database import AsyncSessionLocal
        from app.models.trades import Trade

        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = now - timedelta(days=7)

        async with AsyncSessionLocal() as db:
            async def _sum(since: datetime | None = None) -> tuple[float, int]:
                q = select(func.sum(Trade.pnl), func.count()).where(Trade.status == "closed")
                if since:
                    q = q.where(Trade.closed_at >= since)
                row = (await db.execute(q)).one()
                return (float(row[0] or 0), int(row[1] or 0))

            day_pnl, day_cnt = await _sum(today_start)
            week_pnl, week_cnt = await _sum(week_start)
            total_pnl, total_cnt = await _sum()

        def _line(label: str, pnl: float, cnt: int) -> str:
            sign = "🟢" if pnl >= 0 else "🔴"
            return f"{sign} {label}: <code>{_fmt_money(pnl)}</code> ({cnt} trades)"

        await self.send_message(
            chat_id,
            f"💰 <b>P&L Overzicht</b>\n\n"
            + _line("Vandaag", day_pnl, day_cnt) + "\n"
            + _line("Week", week_pnl, week_cnt) + "\n"
            + _line("Totaal", total_pnl, total_cnt),
        )

    async def cmd_trades(self, chat_id: str) -> None:
        from sqlalchemy import select, desc, or_
        from app.database import AsyncSessionLocal
        from app.models.trades import Trade

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Trade)
                .order_by(desc(Trade.closed_at), desc(Trade.opened_at))
                .limit(10)
            )
            trades = result.scalars().all()

        if not trades:
            await self.send_message(chat_id, "📋 Nog geen trades.")
            return

        lines = ["📋 <b>Laatste Trades</b>\n"]
        for t in trades:
            dir_emoji = "📈" if t.side == "buy" else "📉"
            status_map = {"closed": "✅", "open": "🔵", "paper_traded": "📄"}
            st = status_map.get(t.status, "⚪")
            pnl_str = f" — <code>{_fmt_money(t.pnl)}</code>" if t.pnl is not None else ""
            date_str = _fmt_date(t.closed_at or t.opened_at)
            lines.append(f"{st}{dir_emoji} <b>{t.symbol}</b> {t.side.upper()}{pnl_str} — {date_str}")

        await self.send_message(chat_id, "\n".join(lines))

    async def cmd_stats(self, chat_id: str) -> None:
        from sqlalchemy import select, func
        from app.database import AsyncSessionLocal
        from app.models.trades import Trade

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Trade.pnl).where(Trade.status == "closed", Trade.pnl.is_not(None))
            )
            pnl_values = [row[0] for row in result.all()]

        if not pnl_values:
            await self.send_message(chat_id, "📈 Nog geen gesloten trades voor statistieken.")
            return

        wins = [p for p in pnl_values if p > 0]
        losses = [p for p in pnl_values if p <= 0]
        total = sum(pnl_values)
        win_rate = len(wins) / len(pnl_values) * 100 if pnl_values else 0
        avg_win = sum(wins) / len(wins) if wins else 0
        avg_loss = sum(losses) / len(losses) if losses else 0
        best = max(pnl_values)
        worst = min(pnl_values)

        await self.send_message(
            chat_id,
            f"📈 <b>Performance Statistieken</b>\n\n"
            f"Gesloten trades: {len(pnl_values)}\n"
            f"Win rate: <code>{win_rate:.1f}%</code> ({len(wins)}W / {len(losses)}L)\n"
            f"Gem. winst: <code>{_fmt_money(avg_win)}</code>\n"
            f"Gem. verlies: <code>{_fmt_money(avg_loss)}</code>\n"
            f"Beste trade: <code>{_fmt_money(best)}</code>\n"
            f"Slechtste trade: <code>{_fmt_money(worst)}</code>\n"
            f"Totaal P&L: <code>{_fmt_money(total)}</code>",
        )

    async def cmd_outcomes(self, chat_id: str) -> None:
        from sqlalchemy import select, func
        from app.database import AsyncSessionLocal
        from app.models.outcomes import SignalOutcome

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(
                    func.count().label("total"),
                    func.avg(SignalOutcome.pnl_1d_pct).label("avg_1d"),
                    func.avg(SignalOutcome.pnl_5d_pct).label("avg_5d"),
                    func.avg(SignalOutcome.excess_return_5d).label("avg_excess"),
                ).where(SignalOutcome.outcome_status == "complete")
            )
            row = result.one()
            total = int(row.total or 0)
            avg_1d = float(row.avg_1d or 0) * 100
            avg_5d = float(row.avg_5d or 0) * 100
            avg_excess = float(row.avg_excess or 0) * 100

            # Win rate 1d
            wins_1d = await db.execute(
                select(func.count()).where(
                    SignalOutcome.outcome_status == "complete",
                    SignalOutcome.pnl_1d_pct > 0,
                )
            )
            win_cnt_1d = int(wins_1d.scalar() or 0)
            win_rate_1d = win_cnt_1d / total * 100 if total else 0

        if total == 0:
            await self.send_message(chat_id, "🎯 Nog geen geëvalueerde signal outcomes.")
            return

        excess_sign = "🟢" if avg_excess >= 0 else "🔴"
        await self.send_message(
            chat_id,
            f"🎯 <b>Signal Outcomes</b>\n\n"
            f"Geëvalueerd: {total} signalen\n"
            f"Win rate (1d): <code>{win_rate_1d:.1f}%</code>\n"
            f"Gem. return 1d: <code>{_fmt_pct(avg_1d)}</code>\n"
            f"Gem. return 5d: <code>{_fmt_pct(avg_5d)}</code>\n"
            f"{excess_sign} vs SPY (5d): <code>{_fmt_pct(avg_excess)}</code> excess",
        )

    async def cmd_nieuws(self, chat_id: str) -> None:
        from sqlalchemy import select, desc
        from app.database import AsyncSessionLocal
        from app.models.news import NewsItem

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(NewsItem)
                .where(NewsItem.ai_analyzed == True, NewsItem.impact_score >= 0.6)
                .order_by(desc(NewsItem.published_at))
                .limit(8)
            )
            items = result.scalars().all()

        if not items:
            await self.send_message(chat_id, "📰 Geen recent impactvol nieuws gevonden.")
            return

        lines = ["📰 <b>Recent Impactvol Nieuws</b>\n"]
        for item in items:
            sentiment_emoji = {"positive": "🟢", "negative": "🔴", "neutral": "⚪"}.get(
                item.sentiment or "neutral", "⚪"
            )
            tickers = ", ".join(item.tickers[:4]) if item.tickers else "—"
            impact = f"{(item.impact_score or 0) * 10:.1f}/10" if item.impact_score else "n/b"
            title = (item.title or "")[:80]
            lines.append(
                f"{sentiment_emoji} <b>{title}</b>\n"
                f"   Impact: {impact} | Tickers: {tickers}"
            )
        await self.send_message(chat_id, "\n".join(lines))

    async def cmd_geruchten(self, chat_id: str) -> None:
        from sqlalchemy import select, desc
        from app.database import AsyncSessionLocal
        from app.models.rumours import Rumour

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Rumour)
                .where(Rumour.status == "active")
                .order_by(desc(Rumour.created_at))
                .limit(8)
            )
            rumours = result.scalars().all()

        if not rumours:
            await self.send_message(chat_id, "🔍 Geen actieve marktgeruchten.")
            return

        lines = ["🔍 <b>Markt Geruchten</b>\n"]
        for r in rumours:
            rec_map = {"buy": "🟢 kopen", "watch": "👁 kijken", "avoid": "🔴 vermijden"}
            rec = rec_map.get(r.recommendation or "watch", r.recommendation or "watch")
            assets = ", ".join((r.related_assets or [])[:3]) or "—"
            manip = r.manipulation_risk or 0
            manip_warn = " ⚠️ manipulatie-risico" if manip > 0.5 else ""
            title = (r.title or "")[:80]
            lines.append(
                f"• <b>{title}</b>\n"
                f"  Conf: {(r.confidence or 0):.0%} | Manip: {manip:.0%}{manip_warn}\n"
                f"  Assets: {assets} | {rec}"
            )
        await self.send_message(chat_id, "\n".join(lines))

    async def cmd_pauze(self, chat_id: str) -> None:
        ai = get_runtime_value("anthropic_disabled_until", None)
        if ai:
            try:
                until = datetime.fromisoformat(str(ai).replace("Z", "+00:00"))
                if until > datetime.now(timezone.utc):
                    await self.send_message(
                        chat_id,
                        f"⚠️ AI trading is al gepauzeerd tot {until.strftime('%H:%M UTC')}.",
                    )
                    return
            except Exception:
                pass

        await self.send_message(
            chat_id,
            "⏸ <b>AI trading pauzeren?</b>\n\nDit stopt het genereren van nieuwe signalen voor 6 uur.",
            reply_markup={
                "inline_keyboard": [[
                    {"text": "✅ Ja, pauzeer AI", "callback_data": "confirm_pauze"},
                    {"text": "❌ Annuleer", "callback_data": "cancel"},
                ]]
            },
        )

    async def cmd_hervatten(self, chat_id: str) -> None:
        ai = get_runtime_value("anthropic_disabled_until", None)
        is_paused = False
        if ai:
            try:
                until = datetime.fromisoformat(str(ai).replace("Z", "+00:00"))
                is_paused = until > datetime.now(timezone.utc)
            except Exception:
                pass

        if not is_paused:
            await self.send_message(chat_id, "ℹ️ AI trading is momenteel niet gepauzeerd.")
            return

        await self.send_message(
            chat_id,
            "▶️ <b>AI trading hervatten?</b>\n\nDit maakt nieuwe signaalanalyse weer mogelijk.",
            reply_markup={
                "inline_keyboard": [[
                    {"text": "✅ Ja, hervatten", "callback_data": "confirm_hervatten"},
                    {"text": "❌ Annuleer", "callback_data": "cancel"},
                ]]
            },
        )

    async def cmd_killswitch(self, chat_id: str) -> None:
        current = get_runtime_value("kill_switch_enabled", self.settings.kill_switch_enabled)
        if current:
            await self.send_message(
                chat_id,
                "🔴 <b>Kill switch is momenteel AAN</b>\nAlle nieuwe orders zijn geblokkeerd.\n\nWil je dit uitschakelen?",
                reply_markup={
                    "inline_keyboard": [[
                        {"text": "✅ Ja, uitschakelen", "callback_data": "confirm_kill_off"},
                        {"text": "❌ Annuleer", "callback_data": "cancel"},
                    ]]
                },
            )
        else:
            await self.send_message(
                chat_id,
                "🟢 <b>Kill switch is momenteel UIT</b>\nOrders worden normaal verwerkt.\n\nWil je alle nieuwe orders blokkeren?",
                reply_markup={
                    "inline_keyboard": [[
                        {"text": "🔴 Ja, activeer kill switch", "callback_data": "confirm_kill_on"},
                        {"text": "❌ Annuleer", "callback_data": "cancel"},
                    ]]
                },
            )

    async def cmd_samenvatting(self, chat_id: str) -> None:
        await self.send_message(chat_id, "📊 Samenvatting wordt gegenereerd en verstuurd...")
        try:
            from app.workers.celery_app import celery_app
            celery_app.send_task("app.tasks.analysis_tasks.send_activity_summary")
        except Exception as exc:
            await self.send_message(chat_id, f"❌ Kon samenvatting niet starten: {exc}")

    # ── Action executors ───────────────────────────────────────────────────────

    async def _execute_pauze(self, chat_id: str) -> None:
        try:
            from app.services.ai_guard import manual_pause_ai
            await manual_pause_ai("telegram", "Handmatig gepauzeerd via Telegram bot", minutes=360)
            await self.send_message(
                chat_id,
                "⏸ AI trading is gepauzeerd voor 6 uur.\nGebruik /hervatten om eerder te hervatten.",
            )
        except Exception as exc:
            await self.send_message(chat_id, f"❌ Pauzeren mislukt: {exc}")

    async def _execute_hervatten(self, chat_id: str) -> None:
        try:
            from app.services.ai_guard import resume_ai
            from app.database import AsyncSessionLocal
            from app.services.audit import AuditLogService

            resume_ai()
            async with AsyncSessionLocal() as db:
                await AuditLogService(db).log(
                    "ai_provider_resumed",
                    actor="telegram",
                    message="AI trading hervat via Telegram bot",
                )
            await self.send_message(chat_id, "▶️ AI trading is hervat.")
        except Exception as exc:
            await self.send_message(chat_id, f"❌ Hervatten mislukt: {exc}")

    async def _execute_kill_switch(self, chat_id: str, enable: bool) -> None:
        try:
            from app.database import AsyncSessionLocal
            from app.services.audit import AuditLogService
            from app.services.settings_store import persist_runtime_setting
            from app.services.notifications import NotificationService

            stored = set_runtime_value("kill_switch_enabled", enable)
            try:
                object.__setattr__(self.settings, "kill_switch_enabled", enable)
            except Exception:
                pass

            async with AsyncSessionLocal() as db:
                await persist_runtime_setting(db, "kill_switch_enabled", enable)
                await AuditLogService(db).log(
                    "kill_switch_enabled" if enable else "kill_switch_disabled",
                    actor="telegram",
                    details={"shared": stored},
                )
                if enable:
                    await NotificationService(db).send(
                        "kill_switch_enabled",
                        "Trading OS - KILL SWITCH ACTIEF",
                        "Nieuwe orders zijn geblokkeerd via Telegram bot.",
                        severity="critical",
                        entity_type="risk",
                    )
                else:
                    await NotificationService(db).send(
                        "kill_switch_disabled",
                        "Trading OS - Kill switch uitgeschakeld",
                        "Nieuwe orders kunnen weer worden verwerkt. Uitgeschakeld via Telegram bot.",
                        severity="warning",
                        entity_type="risk",
                    )

            msg = "🔴 Kill switch is <b>geactiveerd</b>. Alle nieuwe orders zijn geblokkeerd." if enable else \
                  "🟢 Kill switch is <b>uitgeschakeld</b>. Orders worden normaal verwerkt."
            await self.send_message(chat_id, msg)
        except Exception as exc:
            await self.send_message(chat_id, f"❌ Kill switch wijziging mislukt: {exc}")

    async def _execute_paper_trade(self, chat_id: str, signal_id: str) -> None:
        try:
            from sqlalchemy import select
            from app.database import AsyncSessionLocal
            from app.models.signals import Signal
            from app.services.risk_engine import RiskEngine
            from app.services.alpaca_broker import AlpacaBroker, AlpacaNotConfiguredError, AlpacaAPIError
            from app.schemas.risk import RiskCheckRequest
            from app.services.order_recorder import record_submitted_order
            from app.services.notifications import NotificationService

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Signal).where(Signal.id == signal_id))
                signal = result.scalar_one_or_none()
                if not signal:
                    await self.send_message(chat_id, "❌ Signaal niet gevonden.")
                    return
                if signal.status != "pending":
                    await self.send_message(chat_id, f"⚠️ Signaal heeft al status: {signal.status}")
                    return

                risk_req = RiskCheckRequest(
                    symbol=signal.asset,
                    side=signal.direction,
                    quantity=1,
                    confidence=signal.confidence,
                    stop_loss=signal.suggested_stop,
                    mode="paper",
                    estimated_notional=signal.suggested_entry,
                )
                risk_result = await RiskEngine().check_async(risk_req)

                if not risk_result.approved:
                    signal.status = "risk_rejected"
                    await db.commit()
                    await self.send_message(
                        chat_id,
                        f"❌ Risico-check afgewezen: {', '.join(risk_result.reasons[:3])}",
                    )
                    return

                broker = AlpacaBroker()
                order = await broker.submit_order(
                    symbol=signal.asset,
                    qty=1,
                    notional=None,
                    side=signal.direction,
                    stop_price=signal.suggested_stop,
                )
                record_submitted_order(
                    db,
                    symbol=signal.asset,
                    side=signal.direction,
                    quantity=1,
                    notional=None,
                    order_type="market",
                    mode="paper",
                    broker_response=order,
                    signal_id=signal.id,
                    stop_price=signal.suggested_stop,
                    risk_check_result=risk_result.model_dump(),
                )
                signal.status = "paper_traded"
                signal.risk_check_result = risk_result.model_dump()
                await db.commit()
                await NotificationService(db).send(
                    "signal_paper_traded",
                    f"Trading OS - Paper trade: {signal.asset} {signal.direction.upper()}",
                    f"Uitgevoerd via Telegram bot. Confidence: {signal.confidence:.0%}.",
                    severity="warning",
                    entity_type="signal",
                    entity_id=signal.id,
                )
                await self.send_message(
                    chat_id,
                    f"✅ Paper trade ingediend: <b>{signal.asset} {signal.direction.upper()}</b>",
                )
        except Exception as exc:
            logger.warning("Paper trade fout voor signal %s: %s", signal_id, exc)
            await self.send_message(chat_id, f"❌ Paper trade mislukt: {exc}")

    async def _execute_reject_signal(self, chat_id: str, signal_id: str) -> None:
        try:
            from sqlalchemy import select
            from app.database import AsyncSessionLocal
            from app.models.signals import Signal

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Signal).where(Signal.id == signal_id))
                signal = result.scalar_one_or_none()
                if not signal:
                    await self.send_message(chat_id, "❌ Signaal niet gevonden.")
                    return
                signal.status = "rejected"
                await db.commit()
                await self.send_message(
                    chat_id,
                    f"🚫 Signaal <b>{signal.asset}</b> afgewezen.",
                )
        except Exception as exc:
            await self.send_message(chat_id, f"❌ Afwijzen mislukt: {exc}")
