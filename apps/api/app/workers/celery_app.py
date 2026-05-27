from celery import Celery
from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "trading_os",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "app.tasks.news_tasks",
        "app.tasks.signal_tasks",
        "app.tasks.social_tasks",
        "app.tasks.analysis_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        # Data collection
        "ingest-news-every-15min": {
            "task": "app.tasks.news_tasks.ingest_news",
            "schedule": 900.0,
        },
        "fetch-reddit-every-30min": {
            "task": "app.tasks.social_tasks.fetch_reddit",
            "schedule": 1800.0,
        },
        # Analysis (Claude)
        "analyze-content-every-5min": {
            "task": "app.tasks.analysis_tasks.analyze_news",
            "schedule": 300.0,
        },
        "detect-rumours-every-30min": {
            "task": "app.tasks.analysis_tasks.detect_rumours",
            "schedule": 1800.0,
        },
        # Market data
        "fetch-market-data-hourly": {
            "task": "app.tasks.analysis_tasks.fetch_market_data",
            "schedule": 3600.0,
        },
        # Signal generation & execution
        "generate-signals-every-15min": {
            "task": "app.tasks.signal_tasks.generate_signals",
            "schedule": 900.0,
        },
        "auto-trade-every-5min": {
            "task": "app.tasks.analysis_tasks.auto_trade",
            "schedule": 300.0,
        },
    },
)
