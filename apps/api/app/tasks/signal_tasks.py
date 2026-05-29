import asyncio
import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.signal_tasks.generate_signals")
def generate_signals():
    """Generate trading signals from analyzed news + social + TA.
    If new signals are created, immediately triggers auto_trade for instant execution."""
    from app.services.signal_generator import SignalGeneratorService
    from app.services.crypto_session import crypto_session_allows_autonomy
    from app.services.market_session import us_market_open
    try:
        svc = SignalGeneratorService()
        crypto_mode = crypto_session_allows_autonomy()
        market_open = us_market_open()
        # During US market hours: always scan the full watchlist (equities + crypto).
        # 24/7 mode only means crypto trades are auto-executed — not that equities are ignored.
        # Outside market hours: crypto-only mode when session/24/7 is active.
        effective_crypto_mode = crypto_mode and not market_open
        lookback = 24 if effective_crypto_mode else 8
        count = asyncio.run(svc.generate_signals(lookback_hours=lookback, crypto_session_mode=effective_crypto_mode))
        logger.info(f"Signal generatie: {count} nieuwe signalen")
        # Fire auto_trade immediately when new signals exist — no need to wait for 5-min cycle
        if count > 0:
            celery_app.send_task("app.tasks.analysis_tasks.auto_trade")
            logger.info(f"Auto-trade getriggerd voor {count} nieuwe signalen")
        return {"status": "ok", "signals_generated": count, "crypto_session_mode": effective_crypto_mode, "market_open": market_open}
    except Exception as e:
        logger.error(f"Signal generatie fout: {e}")
        return {"status": "error", "message": str(e)}
