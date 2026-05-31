"""
Gok Sessie — AI-driven speculative one-shot trading.

The user triggers a "gok" (bet) from the dashboard. The AI scans all speculative
assets for the single best opportunity right now: trending news, social spikes,
rumours, momentum breakouts. It returns a recommendation; the user confirms.

One active gok position at a time. Dedicated budget separate from auto-trading.
TP: +10-20%, SL: -5%, max hold 4 hours.
"""

import json
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, func

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.signals import Signal
from app.models.trades import Trade
from app.models.news import NewsItem
from app.models.social import SocialPost
from app.services.asset_universe import CRYPTO_SPECULATIVE, CRYPTO_CORE
from app.services.market_data_service import MarketDataService
from app.services.technical_analysis import analyze as ta_analyze
from app.services.runtime_state import get_runtime_value

logger = logging.getLogger(__name__)

GOK_ASSETS = sorted(CRYPTO_SPECULATIVE | CRYPTO_CORE)
GOK_TP_PCT = 0.15       # 15% take profit
GOK_SL_PCT = 0.05       # 5% stop loss
GOK_MAX_HOLD_H = 4      # max 4 hours
GOK_MAX_DAILY = 2       # max 2 gok sessies per dag


class GokSessionService:
    def __init__(self):
        self.settings = get_settings()
        self.market = MarketDataService()

    async def can_start_gok(self) -> tuple[bool, str]:
        """Check if a new gok sessie can start."""
        if get_runtime_value("kill_switch_enabled", self.settings.kill_switch_enabled):
            return False, "Kill switch is actief"

        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        async with AsyncSessionLocal() as db:
            # Check daily limit
            count = (await db.execute(
                select(func.count()).where(
                    Trade.mode == "gok",
                    Trade.opened_at >= today,
                )
            )).scalar() or 0
            if count >= GOK_MAX_DAILY:
                return False, f"Dagelijks limiet bereikt ({GOK_MAX_DAILY} gok sessies/dag)"

            # Check already open gok position
            open_gok = (await db.execute(
                select(Trade).where(Trade.mode == "gok", Trade.status == "open").limit(1)
            )).scalar_one_or_none()
            if open_gok:
                return False, f"Er is al een open gok positie: {open_gok.symbol}"

        return True, "ok"

    async def scan_best_opportunity(self, budget_eur: float = 100.0) -> dict:
        """
        AI-free scan: find the single best speculative asset right now.
        Ranks by: recent news impact + social hype + technical momentum.
        Returns a recommendation dict.
        """
        since = datetime.now(timezone.utc) - timedelta(hours=4)
        scores: dict[str, float] = {asset: 0.0 for asset in GOK_ASSETS}

        async with AsyncSessionLocal() as db:
            # News impact scores (last 4h)
            news_rows = (await db.execute(
                select(NewsItem.tickers, NewsItem.impact_score, NewsItem.sentiment)
                .where(NewsItem.ai_analyzed == True, NewsItem.published_at >= since)
                .order_by(NewsItem.impact_score.desc()).limit(50)
            )).all()

            for row in news_rows:
                for ticker in (row.tickers or []):
                    base = ticker.upper().split("/")[0]
                    if base in scores:
                        sentiment_bonus = 0.5 if row.sentiment == "positive" else 0.0
                        scores[base] += float(row.impact_score or 0) * (1 + sentiment_bonus)

            # Social hype scores (last 4h)
            social_rows = (await db.execute(
                select(SocialPost.tickers, SocialPost.hype_score, SocialPost.score)
                .where(SocialPost.ai_analyzed == True, SocialPost.posted_at >= since)
                .order_by(SocialPost.hype_score.desc()).limit(100)
            )).all()

            for row in social_rows:
                for ticker in (row.tickers or []):
                    base = ticker.upper().split("/")[0]
                    if base in scores:
                        scores[base] += float(row.hype_score or 0) * 2  # social hype weighted higher

        # Add TA momentum score
        for asset in list(scores.keys()):
            try:
                candles = await self.market.get_candles(asset, "15Min", 40)
                if len(candles) >= 20:
                    ta = ta_analyze(candles)
                    if ta:
                        # RSI momentum: oversold bounces and strong momentum both score
                        if ta.rsi is not None:
                            if ta.rsi < 38:
                                scores[asset] += 3.0   # oversold bounce potential
                            elif 45 <= ta.rsi <= 62:
                                scores[asset] += 2.0   # momentum zone
                        if ta.score is not None and ta.score > 0.2:
                            scores[asset] += ta.score * 5
            except Exception:
                pass

        # Pick winner
        best_asset = max(scores, key=lambda k: scores[k])
        best_score = scores[best_asset]

        if best_score < 1.0:
            return {
                "status": "no_opportunity",
                "message": "Geen sterke gok kans gevonden op dit moment. Probeer later.",
            }

        # Get current price and build trade plan
        price = await self.market.get_latest_price(best_asset)
        if not price:
            return {"status": "no_price", "message": f"Prijs niet beschikbaar voor {best_asset}"}

        tp = round(price * (1 + GOK_TP_PCT), 6)
        sl = round(price * (1 - GOK_SL_PCT), 6)
        qty_estimate = round(budget_eur / price, 6)

        # Build reason from what drove the score
        reason_parts = []
        async with AsyncSessionLocal() as db:
            recent_news = (await db.execute(
                select(NewsItem.title, NewsItem.impact_score)
                .where(NewsItem.tickers.contains([best_asset]), NewsItem.published_at >= since)
                .order_by(NewsItem.impact_score.desc()).limit(2)
            )).all()
            for n in recent_news:
                reason_parts.append(f"📰 {n.title[:80]}")

        reason = " | ".join(reason_parts) if reason_parts else f"Technische setup + hype score {best_score:.1f}"

        return {
            "status": "opportunity_found",
            "asset": best_asset,
            "price": price,
            "suggested_entry": price,
            "take_profit": tp,
            "stop_loss": sl,
            "tp_pct": GOK_TP_PCT * 100,
            "sl_pct": GOK_SL_PCT * 100,
            "max_hold_hours": GOK_MAX_HOLD_H,
            "budget_eur": budget_eur,
            "estimated_qty": qty_estimate,
            "score": round(best_score, 2),
            "reason": reason,
            "all_scores": {k: round(v, 2) for k, v in sorted(scores.items(), key=lambda x: x[1], reverse=True)[:8]},
        }

    async def execute_gok(self, asset: str, budget_eur: float, price: float) -> dict:
        """Execute the gok trade — stores as mode='gok' for separate tracking."""
        from app.services.ccxt_broker import CCXTBroker
        from app.services.alpaca_broker import AlpacaBroker
        from app.models.trades import Trade
        from app.models.audit import AuditLog
        from app.services.asset_universe import prefers_bitvavo

        mode = get_runtime_value("trading_mode", self.settings.trading_mode)
        tp = round(price * (1 + GOK_TP_PCT), 6)
        sl = round(price * (1 - GOK_SL_PCT), 6)

        broker = CCXTBroker() if prefers_bitvavo(asset) else AlpacaBroker()

        try:
            order = await broker.submit_order(symbol=asset, side="buy", notional=round(budget_eur, 2))
        except Exception as e:
            return {"status": "error", "message": str(e)}

        fill_qty = float(order.get("filled_qty") or order.get("qty") or 0)
        if fill_qty == 0 and budget_eur and price:
            fill_qty = round(budget_eur / price, 8)

        fill_price = float(order.get("filled_avg_price") or price)
        now = datetime.now(timezone.utc)

        async with AsyncSessionLocal() as db:
            trade = Trade(
                symbol=asset,
                side="buy",
                quantity=fill_qty,
                entry_price=fill_price,
                stop_loss=sl,
                take_profit=tp,
                mode="gok",
                status="open",
                entry_reason=f"Gok sessie: {asset} @ €{fill_price:.4f} | TP +{GOK_TP_PCT*100:.0f}% SL -{GOK_SL_PCT*100:.0f}%",
                opened_at=now,
                alpaca_order_id=order.get("id"),
            )
            db.add(trade)
            db.add(AuditLog(
                action="gok_sessie_gestart",
                actor="gok_session",
                entity_type="trade",
                status="success",
                details={"asset": asset, "budget": budget_eur, "price": fill_price, "tp": tp, "sl": sl, "mode": mode},
                message=f"🎲 Gok: {asset} €{budget_eur:.0f} @ €{fill_price:.4f} | TP €{tp:.4f} | SL €{sl:.4f}",
                created_at=now,
                updated_at=now,
            ))
            await db.commit()

        logger.info(f"Gok sessie gestart: {asset} €{budget_eur:.0f} @ {fill_price:.4f} TP={tp:.4f} SL={sl:.4f}")
        return {
            "status": "executed",
            "trade_id": trade.id,
            "asset": asset,
            "entry_price": fill_price,
            "quantity": fill_qty,
            "take_profit": tp,
            "stop_loss": sl,
            "mode": mode,
        }
