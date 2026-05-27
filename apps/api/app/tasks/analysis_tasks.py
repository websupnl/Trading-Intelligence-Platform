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
        since = datetime.now(timezone.utc) - timedelta(hours=48)
        tickers = set()

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
                select(Signal.asset).where(Signal.status == "pending")
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
