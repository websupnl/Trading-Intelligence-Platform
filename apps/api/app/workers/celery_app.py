from celery import Celery
from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "trading_os",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks.news_tasks", "app.tasks.signal_tasks", "app.tasks.social_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "ingest-news-every-15min": {
            "task": "app.tasks.news_tasks.ingest_news",
            "schedule": 900.0,
        },
        "fetch-reddit-every-30min": {
            "task": "app.tasks.social_tasks.fetch_reddit",
            "schedule": 1800.0,
        },
    },
)
