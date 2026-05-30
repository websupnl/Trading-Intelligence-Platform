import asyncio
import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.signal_tasks.generate_signals")
def generate_signals():
    """Generate trading signals. Crypto 24/7; stocks only during US market hours."""
    from app.services.signal_generator import SignalGeneratorService
    from app.services.crypto_session import crypto_session_allows_autonomy
    from app.tasks.analysis_tasks import _us_market_open
    try:
        svc = SignalGeneratorService()
        crypto_mode = crypto_session_allows_autonomy()
        market_open = _us_market_open()

        # Run crypto signals always; also run stock signals during market hours
        total = 0
        if crypto_mode:
            total += asyncio.run(svc.generate_signals(lookback_hours=24, crypto_session_mode=True))
        if market_open:
            # Stock signals during market hours (not crypto-only)
            stock_count = asyncio.run(svc.generate_signals(lookback_hours=8, crypto_session_mode=False))
            total += stock_count
            if stock_count > 0:
                logger.info(f"Stock signalen tijdens markturen: {stock_count}")
        if not crypto_mode and not market_open:
            # Fallback: still try crypto even without explicit session
            total += asyncio.run(svc.generate_signals(lookback_hours=24, crypto_session_mode=True))

        logger.info(f"Signal generatie: {total} nieuwe signalen (crypto={crypto_mode}, market={market_open})")
        if total > 0:
            celery_app.send_task("app.tasks.analysis_tasks.auto_trade")
        return {"status": "ok", "signals_generated": total, "crypto_session_mode": crypto_mode, "market_open": market_open}
    except Exception as e:
        logger.error(f"Signal generatie fout: {e}")
        return {"status": "error", "message": str(e)}
