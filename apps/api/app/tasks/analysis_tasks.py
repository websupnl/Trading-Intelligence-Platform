import asyncio
import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


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
    """Fetch market data for tickers mentioned in recent news/signals."""
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
    """Auto-execute high-confidence signals in paper/live mode."""
    from app.services.auto_trader import AutoTraderService
    try:
        svc = AutoTraderService()
        count = asyncio.run(svc.process_pending_signals())
        return {"status": "ok", "executed": count}
    except Exception as e:
        logger.error(f"Auto trade fout: {e}")
        return {"status": "error", "message": str(e)}


@celery_app.task(name="app.tasks.analysis_tasks.monitor_positions")
def monitor_positions():
    """Monitor open trades and auto-close when stop-loss or take-profit is hit."""
    from app.services.position_monitor import PositionMonitorService
    try:
        svc = PositionMonitorService()
        count = asyncio.run(svc.monitor())
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
def send_activity_summary(hours: int = 4):
    """Send a concise action/risk/P&L summary to app notifications + Telegram."""
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import select, func, desc
    from app.database import AsyncSessionLocal
    from app.models.audit import AuditLog
    from app.models.news import NewsItem
    from app.models.signals import Signal
    from app.models.trades import Trade
    from app.services.ai_guard import ai_pause_status
    from app.services.notifications import NotificationService

    async def _run():
        now = datetime.now(timezone.utc)
        since = now - timedelta(hours=hours)
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        async with AsyncSessionLocal() as db:
            signal_count = (await db.execute(select(func.count()).where(Signal.created_at >= since))).scalar() or 0
            trade_count = (await db.execute(select(func.count()).where(Trade.created_at >= since))).scalar() or 0
            open_trades = (await db.execute(select(Trade).where(Trade.status == "open").order_by(desc(Trade.created_at)).limit(12))).scalars().all()
            closed_today = (await db.execute(select(func.count(), func.coalesce(func.sum(Trade.pnl), 0)).where(Trade.status == "closed", Trade.closed_at >= today))).one()
            errors = (await db.execute(select(AuditLog).where(AuditLog.created_at >= since, AuditLog.status == "error").order_by(desc(AuditLog.created_at)).limit(5))).scalars().all()
            news_count = (await db.execute(select(func.count()).where(NewsItem.created_at >= since))).scalar() or 0
            analyzed_news = (await db.execute(select(func.count()).where(NewsItem.updated_at >= since, NewsItem.ai_analyzed == True))).scalar() or 0

            ai = ai_pause_status()
            lines = [
                f"Periode: laatste {hours} uur",
                f"AI status: {'GEPAUZEERD tot ' + str(ai.get('until')) if ai.get('paused') else 'actief'}",
                f"Nieuwe signalen: {signal_count}",
                f"Nieuwe trades: {trade_count}",
                f"Open trades: {len(open_trades)}",
                f"Vandaag gesloten: {closed_today[0] or 0}, realized P&L: ${float(closed_today[1] or 0):.2f}",
                f"Nieuws opgehaald: {news_count}, AI-geanalyseerd: {analyzed_news}",
            ]
            if open_trades:
                lines.append("Open exposure:")
                for t in open_trades[:8]:
                    lines.append(f"- {t.symbol} {t.side} qty={t.quantity} entry={t.entry_price or 'n/a'} SL={t.stop_loss or 'n/a'} TP={t.take_profit or 'n/a'}")
            if errors:
                lines.append("Recente fouten:")
                for e in errors:
                    lines.append(f"- {e.action}: {(e.message or '')[:140]}")

            message = "\n".join(lines)
            db.add(AuditLog(
                action="activity_summary_sent",
                actor="scheduler",
                entity_type="system",
                status="success",
                message=f"{hours}h activity summary sent",
                created_at=now,
                updated_at=now,
            ))
            await db.commit()
            await NotificationService(db).send(
                "daily_summary",
                "Trading OS - Actie en risico overzicht",
                message,
                severity="warning" if errors or ai.get("paused") else "info",
                entity_type="system",
                entity_id="activity_summary",
            )
            return {"status": "ok", "open_trades": len(open_trades), "errors": len(errors), "ai_paused": ai.get("paused")}

    try:
        result = asyncio.run(_run())
        logger.info("Activity summary verstuurd: %s", result)
        return result
    except Exception as e:
        logger.error(f"Activity summary fout: {e}")
        return {"status": "error", "message": str(e)}
