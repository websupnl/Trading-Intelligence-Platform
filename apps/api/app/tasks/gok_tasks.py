import asyncio
import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.gok_tasks.scan_gok_opportunities")
def scan_gok_opportunities():
    """Scan voor gok kansen over alle strategieën en broadcast via WebSocket."""
    from app.gok.scanner import GokScanner
    from app.gok.ws_manager import gok_ws_manager
    from app.gok.strategies import all_strategies

    async def _run():
        if gok_ws_manager.active_count == 0:
            return {"status": "skip", "reason": "geen actieve WS verbindingen"}

        scanner = GokScanner()
        total = 0
        for strategy in all_strategies():
            try:
                opportunities = await scanner.scan(strategy_name=strategy.name, budget_eur=50.0)
                for opp in opportunities[:2]:  # max 2 per strategie per scan
                    if opp.score >= 0.75:
                        await gok_ws_manager.broadcast("opportunity", {
                            "asset": opp.asset,
                            "strategy": opp.strategy,
                            "score": opp.score,
                            "confidence": opp.confidence,
                            "entry_price": opp.entry_price,
                            "take_profit": opp.take_profit,
                            "stop_loss": opp.stop_loss,
                            "atr": opp.atr,
                            "reason": opp.reason,
                            "news_score": opp.news_score,
                            "social_score": opp.social_score,
                            "ta_score": opp.ta_score,
                            "news_headlines": opp.news_headlines,
                        })
                        total += 1
            except Exception as e:
                logger.error(f"Gok scan fout voor {strategy.name}: {e}")

        return {"status": "ok", "opportunities_broadcast": total}

    try:
        result = asyncio.run(_run())
        logger.info(f"Gok scan klaar: {result}")
        return result
    except Exception as e:
        logger.error(f"Gok scan task fout: {e}")
        return {"status": "error", "message": str(e)}
