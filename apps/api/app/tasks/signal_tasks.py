import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.signal_tasks.generate_signals")
def generate_signals():
    logger.info("Signal generatie gestart")
    return {"status": "ok"}
