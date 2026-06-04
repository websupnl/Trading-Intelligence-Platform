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
        "app.tasks.telegram_tasks",
        "app.tasks.gok_tasks",
        "app.tasks.oracle_tasks",
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
        "fetch-x-every-30min": {
            "task": "app.tasks.social_tasks.fetch_x",
            "schedule": 1800.0,
        },

        # === AI ANALYSIS (Claude) ===
        # 1x per uur max — budget cap in ai_guard voorkomt onbeperkte calls
        "analyze-content-every-hour": {
            "task": "app.tasks.analysis_tasks.analyze_news",
            "schedule": 3600.0,
        },
        "detect-rumours-every-6h": {
            "task": "app.tasks.analysis_tasks.detect_rumours",
            "schedule": 21600.0,
        },

        # === MARKET DATA ===
        # Every 15 min: fresh candles (daily + 4H crypto) for more signals
        "fetch-market-data-every-15min": {
            "task": "app.tasks.analysis_tasks.fetch_market_data",
            "schedule": 900.0,
        },
        "evaluate-outcomes-every-15min": {
            "task": "app.tasks.analysis_tasks.evaluate_signal_outcomes",
            "schedule": 900.0,
        },

        # === SIGNAL GENERATION & EXECUTION ===
        # Every 10 min — balance between freshness and API cost
        "generate-signals-every-10min": {
            "task": "app.tasks.signal_tasks.generate_signals",
            "schedule": 600.0,
        },
        # Brain signals: web-researched conviction per asset, hourly (budget-guarded, capped)
        "generate-brain-signals-hourly": {
            "task": "app.tasks.signal_tasks.generate_brain_signals",
            "schedule": 3600.0,
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
        "sync-closed-trades-every-2min": {
            "task": "app.tasks.analysis_tasks.sync_closed_trades",
            "schedule": 120.0,
        },

        # === MICRO TRADING — disabled (break-even at €1000, not worth it) ===
        # "micro-trader-every-20sec": { ... }  # disabled
        # "micro-monitor-every-10sec": { ... } # disabled

        # === MARKET REGIME ===
        "refresh-regime-every-hour": {
            "task": "app.tasks.analysis_tasks.refresh_market_regime",
            "schedule": 3600.0,
        },
        "refresh-oracle-regime-daily": {
            "task": "app.tasks.analysis_tasks.refresh_oracle_regime",
            "schedule": crontab(hour=6, minute=0),
        },

        # Daily summary at 21:30 UTC (after US market close at ~21:00 UTC)
        "daily-summary-after-close": {
            "task": "app.tasks.analysis_tasks.send_activity_summary",
            "schedule": crontab(hour=21, minute=30),
        },

        # === ORACLE BRAIN ===
        # Morning brief: 06:01 UTC — na regime check (06:00), vóór Europese opening
        "oracle-morning-brief-daily": {
            "task": "app.tasks.oracle_tasks.oracle_morning_brief",
            "schedule": crontab(hour=6, minute=1),
        },
        # EOD review: 22:00 UTC — na US markt close
        "oracle-eod-review-daily": {
            "task": "app.tasks.oracle_tasks.oracle_eod_review",
            "schedule": crontab(hour=22, minute=0),
        },

        # === TELEGRAM BOT ===
        "poll-telegram-every-3sec": {
            "task": "app.tasks.telegram_tasks.poll_telegram",
            "schedule": 3.0,
        },
        # === TELEGRAM CHANNEL MONITOR ===
        "monitor-telegram-channels-every-30min": {
            "task": "app.tasks.telegram_tasks.monitor_telegram_channels",
            "schedule": 1800.0,
        },
        "gok-scan-every-60s": {
            "task": "app.tasks.gok_tasks.scan_gok_opportunities",
            "schedule": 60.0,
        },
    },
)
