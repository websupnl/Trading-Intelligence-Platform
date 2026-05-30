from celery import Celery
from celery.schedules import crontab
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
    # Keep results for 1 hour so pipeline status can read them
    result_expires=3600,
    beat_schedule={
        # === DATA COLLECTION ===
        "ingest-news-every-15min": {
            "task": "app.tasks.news_tasks.ingest_news",
            "schedule": 900.0,
        },
        "fetch-reddit-every-30min": {
            "task": "app.tasks.social_tasks.fetch_reddit",
            "schedule": 1800.0,
        },

        # === AI ANALYSIS (Claude) ===
        # Faster: every 2 min so fresh news gets analyzed quickly
        "analyze-content-every-2min": {
            "task": "app.tasks.analysis_tasks.analyze_news",
            "schedule": 120.0,
        },
        "detect-rumours-every-15min": {
            "task": "app.tasks.analysis_tasks.detect_rumours",
            "schedule": 900.0,
        },

        # === MARKET DATA ===
        # Every 15 min: fresh candles (daily + 4H crypto) for more signals
        "fetch-market-data-every-15min": {
            "task": "app.tasks.analysis_tasks.fetch_market_data",
            "schedule": 900.0,
        },
        "evaluate-outcomes-hourly": {
            "task": "app.tasks.analysis_tasks.evaluate_signal_outcomes",
            "schedule": 3600.0,
        },

        # === SIGNAL GENERATION & EXECUTION ===
        # Every 10 min — balance between freshness and API cost
        "generate-signals-every-10min": {
            "task": "app.tasks.signal_tasks.generate_signals",
            "schedule": 600.0,
        },
        # Every 2 min: fallback sweep for any unexecuted pending signals
        "auto-trade-every-2min": {
            "task": "app.tasks.analysis_tasks.auto_trade",
            "schedule": 120.0,
        },

        # === POSITION MANAGEMENT ===
        "monitor-positions-every-60sec": {
            "task": "app.tasks.analysis_tasks.monitor_positions",
            "schedule": 60.0,
        },

        # === TRADE SYNC & LEARNING ===
        "sync-closed-trades-every-5min": {
            "task": "app.tasks.analysis_tasks.sync_closed_trades",
            "schedule": 300.0,
        },

        # Daily summary at 21:30 UTC (after US market close at ~21:00 UTC)
        "daily-summary-after-close": {
            "task": "app.tasks.analysis_tasks.send_activity_summary",
            "schedule": crontab(hour=21, minute=30),
        },
    },
)
