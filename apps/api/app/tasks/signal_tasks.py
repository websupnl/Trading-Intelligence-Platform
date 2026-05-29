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
    try:
        svc = SignalGeneratorService()
        crypto_mode = crypto_session_allows_autonomy()
        lookback = 24 if crypto_mode else 8
        count = asyncio.run(svc.generate_signals(lookback_hours=lookback, crypto_session_mode=crypto_mode))
        logger.info(f"Signal generatie: {count} nieuwe signalen")
        if count > 0:
            celery_app.send_task("app.tasks.analysis_tasks.auto_trade")
            logger.info(f"Auto-trade getriggerd voor {count} nieuwe signalen")
        return {"status": "ok", "signals_generated": count, "crypto_session_mode": crypto_mode}
    except Exception as e:
        logger.error(f"Signal generatie fout: {e}")
        return {"status": "error", "message": str(e)}


@celery_app.task(name="app.tasks.signal_tasks.generate_signals_crypto_fast")
def generate_signals_crypto_fast():
    """Fast 2-min signal cycle — only executes during an active timed crypto session (not 24/7).
    Narrows to top 5 coins for speed."""
    from app.services.signal_generator import SignalGeneratorService
    from app.services.crypto_session import get_crypto_session
    try:
        session = get_crypto_session()
        if not session.get("active"):
            return {"status": "skipped", "reason": "no_active_session"}
        svc = SignalGeneratorService()
        count = asyncio.run(svc.generate_signals(lookback_hours=24, crypto_session_mode=True))
        logger.info(f"Fast crypto signal generatie: {count} nieuwe signalen")
        if count > 0:
            celery_app.send_task("app.tasks.analysis_tasks.auto_trade")
        return {"status": "ok", "signals_generated": count}
    except Exception as e:
        logger.error(f"Fast crypto signal generatie fout: {e}")
        return {"status": "error", "message": str(e)}
