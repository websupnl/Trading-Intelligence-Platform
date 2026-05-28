import asyncio
import logging
from app.workers.celery_app import celery_app
from app.services.market_session import us_market_open

logger = logging.getLogger(__name__)


def _us_market_open() -> bool:
    return us_market_open()


@celery_app.task(name="app.tasks.analysis_tasks.analyze_news")
def analyze_news():
    """Analyze pending news and social posts with Claude."""
    from app.services.news_analyzer import NewsAnalyzerService
    try:
        svc = NewsAnalyzerService()
        news_count = asyncio.run(svc.analyze_pending_news(batch_size=20))
        social_count = asyncio.run(svc.analyze_pending_social(batch_size=30))
        logger.info(f"Analyse klaar: {news_count} nieuws, {social_count} social posts")
        return {"status": "ok", "news": news_count, "social": social_count}
    except Exception as e:
        logger.error(f"Analyse taak fout: {e}")
        return {"status": "error", "message": str(e)}


@celery_app.task(name="app.tasks.analysis_tasks.detect_rumours")
def detect_rumours():
    """Detect rumours from cross-source patterns."""
    from app.services.rumour_detector import RumourDetectorService
    try:
        svc = RumourDetectorService()
        count = asyncio.run(svc.detect_rumours())
        return {"status": "ok", "rumours_detected": count}
    except Exception as e:
        logger.error(f"Rumour detectie fout: {e}")
        return {"status": "error", "message": str(e)}


@celery_app.task(name="app.tasks.analysis_tasks.fetch_market_data")
def fetch_market_data():
    """Fetch market data for tickers. Crypto runs 24/7; stocks only during market hours."""
    from app.services.alpaca_broker import CRYPTO_SYMBOLS as _CRYPTO
    market_open = _us_market_open()
    from app.services.market_data_service import MarketDataService
    from app.database import AsyncSessionLocal
    from app.models.news import NewsItem
    from app.models.signals import Signal
    from sqlalchemy import select
    from datetime import datetime, timezone, timedelta

    async def _run():
        from app.services.signal_generator import DEFAULT_WATCHLIST
        since = datetime.now(timezone.utc) - timedelta(hours=48)
        tickers = set(DEFAULT_WATCHLIST)  # Always fetch for watchlist

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(NewsItem.tickers).where(
                    NewsItem.ai_analyzed == True,
                    NewsItem.published_at >= since,
                ).limit(100)
            )
            for row in result.scalars():
                tickers.update(row or [])

            result = await db.execute(
                select(Signal.asset).where(Signal.created_at >= since - timedelta(days=30))
            )
            for row in result.scalars():
                if row:
                    tickers.add(row)

        valid = [t for t in tickers if 2 <= len(t) <= 5][:30]
        if not market_open:
            valid = [t for t in valid if t in _CRYPTO]
        if not valid:
            return 0

        svc = MarketDataService()
        return await svc.fetch_bars(valid, "1Day", 60)

    try:
        count = asyncio.run(_run())
        logger.info(f"Market data: {count} candles opgeslagen")
        return {"status": "ok", "candles": count}
    except Exception as e:
        logger.error(f"Market data fout: {e}")
        return {"status": "error", "message": str(e)}


@celery_app.task(name="app.tasks.analysis_tasks.evaluate_signal_outcomes")
def evaluate_signal_outcomes():
    """Evaluate generated signals against subsequent daily market bars."""
    from app.database import AsyncSessionLocal
    from app.services.outcome_engine import OutcomeEngine

    async def _run():
        async with AsyncSessionLocal() as db:
            return await OutcomeEngine(db).evaluate_signals()

    try:
        result = asyncio.run(_run())
        logger.info("Signal outcomes bijgewerkt: %s", result)
        return {"status": "ok", **result}
    except Exception as e:
        logger.error(f"Outcome evaluatie fout: {e}")
        return {"status": "error", "message": str(e)}


@celery_app.task(name="app.tasks.analysis_tasks.auto_trade")
def auto_trade():
    """Auto-execute high-confidence signals. Crypto runs 24/7; stocks only during market hours."""
    from app.services.auto_trader import AutoTraderService
    market_open = _us_market_open()
    try:
        svc = AutoTraderService()
        count = asyncio.run(svc.process_pending_signals(crypto_only=not market_open))
        return {"status": "ok", "executed": count, "crypto_only": not market_open}
    except Exception as e:
        logger.error(f"Auto trade fout: {e}")
        return {"status": "error", "message": str(e)}


@celery_app.task(name="app.tasks.analysis_tasks.monitor_positions")
def monitor_positions():
    """Monitor open trades. Crypto runs 24/7; stocks only during market hours."""
    from app.services.position_monitor import PositionMonitorService
    market_open = _us_market_open()
    try:
        svc = PositionMonitorService()
        count = asyncio.run(svc.monitor(crypto_only=not market_open))
        if count:
            logger.info(f"Positie monitor: {count} posities gesloten")
        return {"status": "ok", "closed": count}
    except Exception as e:
        logger.error(f"Positie monitor fout: {e}")
        return {"status": "error", "message": str(e)}


@celery_app.task(name="app.tasks.analysis_tasks.sync_closed_trades")
def sync_closed_trades():
    """Sync closed trades from Alpaca, compute P&L, write AI reflections."""
    from app.services.trade_tracker import TradeTrackerService
    try:
        svc = TradeTrackerService()
        # First ensure all orders are in DB
        created = asyncio.run(svc.sync_open_trades_from_orders())
        # Then close any that are now closed
        closed = asyncio.run(svc.sync_closed_trades())
        logger.info(f"Trade sync: {created} nieuw aangemaakt, {closed} gesloten met P&L")
        return {"status": "ok", "created": created, "closed": closed}
    except Exception as e:
        logger.error(f"Trade sync fout: {e}")
        return {"status": "error", "message": str(e)}


@celery_app.task(name="app.tasks.analysis_tasks.send_activity_summary")
def send_activity_summary(hours: int = 24):
    """Send daily P&L + actions summary. Focused on results, not noise."""
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import select, func, desc
    from app.database import AsyncSessionLocal
    from app.models.audit import AuditLog
    from app.models.signals import Signal
    from app.models.trades import Trade
    from app.services.ai_guard import ai_pause_status
    from app.services.notifications import NotificationService

    async def _run():
        now = datetime.now(timezone.utc)
        since = now - timedelta(hours=hours)
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)

        async with AsyncSessionLocal() as db:
            open_trades = (await db.execute(
                select(Trade).where(Trade.status == "open").order_by(desc(Trade.opened_at)).limit(10)
            )).scalars().all()

            closed_rows = (await db.execute(
                select(Trade).where(Trade.status == "closed", Trade.closed_at >= today)
                .order_by(desc(Trade.closed_at))
            )).scalars().all()

            signals_today = (await db.execute(
                select(func.count()).where(Signal.created_at >= today)
            )).scalar() or 0

            # Critical errors only (not broker retries)
            critical_errors = (await db.execute(
                select(AuditLog).where(
                    AuditLog.created_at >= since,
                    AuditLog.status == "error",
                    AuditLog.action.in_(["circuit_breaker_triggered", "ai_provider_paused", "position_close_failed"]),
                ).order_by(desc(AuditLog.created_at)).limit(3)
            )).scalars().all()

            ai = ai_pause_status()

            # P&L summary
            total_pnl = sum(t.pnl or 0 for t in closed_rows)
            wins = [t for t in closed_rows if (t.pnl or 0) > 0]
            losses = [t for t in closed_rows if (t.pnl or 0) < 0]
            unrealized = sum(
                ((t.entry_price or 0) * (t.quantity or 0)) * 0  # placeholder, no live price here
                for t in open_trades
            )

            lines = ["📊 Trading OS — Dagelijkse samenvatting", ""]

            # P&L
            pnl_emoji = "🟢" if total_pnl >= 0 else "🔴"
            lines.append(f"{pnl_emoji} Realized P&L vandaag: ${total_pnl:.2f}")
            if closed_rows:
                lines.append(f"   Trades: {len(closed_rows)} gesloten ({len(wins)} winst / {len(losses)} verlies)")
                for t in closed_rows[:5]:
                    emoji = "✅" if (t.pnl or 0) > 0 else "❌"
                    lines.append(f"   {emoji} {t.symbol} {t.side}: ${t.pnl:.2f} ({t.pnl_pct:.1f}%)")
            else:
                lines.append("   Geen gesloten trades vandaag")

            lines.append("")

            # Open positions
            if open_trades:
                lines.append(f"📂 Open posities ({len(open_trades)}):")
                for t in open_trades[:6]:
                    sl = f"SL ${t.stop_loss:.2f}" if t.stop_loss else "geen SL"
                    tp = f"TP ${t.take_profit:.2f}" if t.take_profit else "geen TP"
                    lines.append(f"   {t.symbol} {t.side} — entry ${t.entry_price or 0:.2f} | {sl} | {tp}")
            else:
                lines.append("📂 Geen open posities")

            lines.append("")
            lines.append(f"🤖 AI-signalen vandaag: {signals_today}")
            if ai.get("paused"):
                lines.append(f"⚠️ AI GEPAUZEERD tot {ai.get('until')}")

            if critical_errors:
                lines.append("")
                lines.append("🚨 Kritieke meldingen:")
                for e in critical_errors:
                    lines.append(f"   {e.action}: {(e.message or '')[:120]}")

            message = "\n".join(lines)
            severity = "critical" if critical_errors or ai.get("paused") else ("warning" if losses else "info")

            db.add(AuditLog(
                action="activity_summary_sent",
                actor="scheduler",
                entity_type="system",
                status="success",
                message=f"Dagelijkse samenvatting: P&L ${total_pnl:.2f}, {len(closed_rows)} trades",
                created_at=now,
                updated_at=now,
            ))
            await db.commit()
            await NotificationService(db).send(
                "daily_summary",
                "Trading OS — Dagelijkse samenvatting",
                message,
                severity=severity,
                entity_type="system",
                entity_id="activity_summary",
            )
            return {"status": "ok", "open_trades": len(open_trades), "closed_today": len(closed_rows), "pnl": total_pnl}

    try:
        result = asyncio.run(_run())
        logger.info("Dagelijkse samenvatting verstuurd: %s", result)
        return result
    except Exception as e:
        logger.error(f"Activity summary fout: {e}")
        return {"status": "error", "message": str(e)}
