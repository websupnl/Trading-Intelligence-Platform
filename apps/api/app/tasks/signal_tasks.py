import asyncio
import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.signal_tasks.generate_signals")
def generate_signals():
    """Generate trading signals from analyzed news + social + TA."""
    from app.services.signal_generator import SignalGeneratorService
    try:
        svc = SignalGeneratorService()
        count = asyncio.run(svc.generate_signals(lookback_hours=8))
        logger.info(f"Signal generatie: {count} nieuwe signalen")
        return {"status": "ok", "signals_generated": count}
    except Exception as e:
        logger.error(f"Signal generatie fout: {e}")
        return {"status": "error", "message": str(e)}
